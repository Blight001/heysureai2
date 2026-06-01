"""Tests for the skill-card recording + replay-prep pipeline (S2/S4).

Covers the pure processing helpers (no DB) and the DB-backed recording lifecycle
end to end. Run with: ``DATABASE_URL=sqlite:///<tmp> pytest server/tests``.
"""

import os
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# A throwaway sqlite file before importing api.database (engine binds at import).
os.environ.setdefault("DATABASE_URL", "sqlite:///" + tempfile.mktemp(suffix=".db"))


@pytest.fixture(scope="session", autouse=True)
def _bootstrap_db():
    import api.models  # noqa: F401  (populates metadata)
    from api.database import engine
    from sqlmodel import SQLModel
    SQLModel.metadata.create_all(engine)
    yield


# --------------------------------------------------------------------------
# Pure processing — build_card_from_events
# --------------------------------------------------------------------------

def test_noise_filter_keeps_operations_drops_observations():
    from api.services.skill_recording import build_card_from_events
    events = [
        {"tool": "screen.capture", "args": {}, "result": {}},
        {"tool": "mouse.click", "args": {"x": 10, "y": 20}, "result": {}},
        {"tool": "window.list", "args": {}, "result": {}},
        {"tool": "keyboard.type", "args": {"text": "hello world"}, "result": {}},
    ]
    out = build_card_from_events(events)
    acts = [s["act"] for s in out["steps"]]
    assert acts == ["click", "type"]
    assert out["capability"] == ["mouse.click", "keyboard.type"]


def test_move_coalesced_into_following_click():
    from api.services.skill_recording import build_card_from_events
    events = [
        {"tool": "mouse.move", "args": {"x": 100, "y": 200}, "result": {}},
        {"tool": "mouse.click", "args": {}, "result": {}},  # no coords; should inherit
    ]
    out = build_card_from_events(events)
    assert len(out["steps"]) == 1
    step = out["steps"][0]
    assert step["act"] == "click"
    coord = [a for a in step["target"]["anchors"] if a["strategy"] == "coord"][0]
    assert coord["x"] == 100 and coord["y"] == 200


def test_image_anchor_extracted_from_preceding_region_capture():
    from api.services.skill_recording import build_card_from_events
    events = [
        {"tool": "screen.capture_region",
         "args": {"x": 0, "y": 0, "width": 50, "height": 50},
         "result": {"result": {"result": {"path": "Screenshots/save_icon.png"}}}},
        {"tool": "mouse.click", "args": {"x": 25, "y": 25}, "result": {}},
    ]
    out = build_card_from_events(events)
    anchors = out["steps"][0]["target"]["anchors"]
    assert anchors[0]["strategy"] == "image"
    assert anchors[0]["ref"] == "Screenshots/save_icon.png"
    # coord remains as a lower-priority fallback
    assert anchors[-1]["strategy"] == "coord"


def test_coords_stripped_from_args():
    from api.services.skill_recording import build_card_from_events
    events = [{"tool": "mouse.click", "args": {"x": 5, "y": 6, "button": "left"}, "result": {}}]
    step = build_card_from_events(events)["steps"][0]
    assert "x" not in step["args"] and "y" not in step["args"]
    assert step["args"]["button"] == "left"


def test_secret_redaction_auto_high_entropy_token():
    from api.services.skill_recording import build_card_from_events
    token = "sk-AB12cd34EF56gh78IJ90kl"  # high-entropy, no spaces, len>=20
    events = [{"tool": "keyboard.type", "args": {"text": token}, "result": {}}]
    out = build_card_from_events(events)
    step = out["steps"][0]
    assert step["args"]["text"] == "{{secret_1}}"
    assert out["params"] == [{"name": "secret_1", "type": "string", "required": True, "secret": True}]


def test_plain_text_not_redacted():
    from api.services.skill_recording import build_card_from_events
    events = [{"tool": "keyboard.type", "args": {"text": "report final draft"}, "result": {}}]
    step = build_card_from_events(events)["steps"][0]
    assert step["args"]["text"] == "report final draft"


def test_destructive_inference():
    from api.services.skill_recording import build_card_from_events
    events = [
        {"tool": "window.close", "args": {"title": "Dialog"}, "result": {}},
        {"tool": "shell.run", "args": {"command": "rm -rf /tmp/x"}, "result": {}},
        {"tool": "keyboard.press", "args": {"keys": "ctrl+s"}, "result": {}},
    ]
    steps = build_card_from_events(events)["steps"]
    assert steps[0]["destructive"] is True
    assert steps[1]["destructive"] is True
    assert steps[2]["destructive"] is False


def test_teach_annotation_overrides_assert_and_secret():
    from api.services.skill_recording import build_card_from_events
    events = [
        {"tool": "keyboard.type", "args": {"text": "myUsername"}, "result": {}},
        {"tool": "mouse.click", "args": {"x": 1, "y": 2}, "result": {}},
    ]
    annotations = {
        "0": {"secret": True},
        "1": {"assert": {"check": "window_closed", "value": "Login", "timeout_ms": 3000}},
    }
    out = build_card_from_events(events, annotations=annotations)
    assert out["steps"][0]["args"]["text"].startswith("{{secret_")
    assert out["steps"][1]["assert"]["check"] == "window_closed"
    # auto steps get the settle placeholder
    assert out["steps"][0]["assert"]["check"] == "settle"


def test_drop_tail_trims_and_renumbers():
    from api.services.skill_recording import build_card_from_events
    events = [
        {"tool": "mouse.click", "args": {"x": 1, "y": 1}, "result": {}},
        {"tool": "mouse.click", "args": {"x": 2, "y": 2}, "result": {}},
        {"tool": "mouse.click", "args": {"x": 3, "y": 3}, "result": {}},
    ]
    out = build_card_from_events(events, drop_tail=1)
    assert [s["index"] for s in out["steps"]] == [1, 2]


# --------------------------------------------------------------------------
# Capability gate + param resolution (§6.1/§6.2)
# --------------------------------------------------------------------------

def test_capability_gate():
    from mcp_runtime.mcp.tools.skill_card import card_capability_gate
    ok = card_capability_gate(["mouse.click", "keyboard.type"], ["mouse.click", "keyboard.type", "fs.read"])
    assert ok["ok"] and ok["missing"] == []
    bad = card_capability_gate(["shell.run"], ["mouse.click"])
    assert not bad["ok"] and bad["missing"] == ["shell.run"]


def test_resolve_card_steps_substitutes_and_flags_missing():
    from mcp_runtime.mcp.tools.skill_card import resolve_card_steps
    steps = [{"index": 1, "act": "type", "args": {"text": "{{filename}}"}}]
    app_scope = {"process": "QQ.exe", "window_match": "{{contact_name}}"}
    specs = [{"name": "filename", "required": True}, {"name": "contact_name", "required": True}]

    out = resolve_card_steps(steps, app_scope, {"filename": "a.txt", "contact_name": "张三"}, specs)
    assert out["ok"]
    assert out["steps"][0]["args"]["text"] == "a.txt"
    assert out["app_scope"]["window_match"] == "张三"

    miss = resolve_card_steps(steps, app_scope, {"filename": "a.txt"}, specs)
    assert not miss["ok"]
    assert "contact_name" in miss["missing_params"]


def test_resolve_preserves_non_string_whole_slot_type():
    from mcp_runtime.mcp.tools.skill_card import resolve_card_steps
    steps = [{"args": {"count": "{{n}}"}}]
    out = resolve_card_steps(steps, None, {"n": 5}, [])
    assert out["steps"][0]["args"]["count"] == 5  # int preserved, not "5"


# --------------------------------------------------------------------------
# DB lifecycle: start → capture → stop → draft card + prepare_execution
# --------------------------------------------------------------------------

def test_recording_lifecycle_end_to_end():
    from api.services import skill_recording
    from mcp_runtime.mcp.tools.skill_card import (
        _skill_card_create, _skill_card_prepare_execution,
    )

    uid, aid = 4242, 77
    started = skill_recording.start_recording(uid, aid, {
        "name": "保存文件", "surface": "windows", "mode": "auto",
        "app_scope": {"process": "notepad.exe", "window_match": "{{title}}", "on_missing": "halt"},
    })
    assert started["status"] == "recording"

    # observation + operations flow through the chokepoint
    skill_recording.record_endpoint_event(uid, aid, "screen.capture", {}, {})
    skill_recording.record_endpoint_event(uid, aid, "keyboard.press", {"keys": "ctrl+s"}, {"result": {"success": True}})
    skill_recording.record_endpoint_event(uid, aid, "keyboard.type", {"text": "{{filename}}"}, {})

    status = skill_recording.recording_status(uid, aid)
    assert status["recording"] and status["operation_count"] == 2

    stopped = skill_recording.stop_recording(
        uid, aid, create_card=lambda a: _skill_card_create(uid, a, aid),
    )
    assert stopped["created"]
    card = stopped["card"]
    assert card["status"] == "draft"
    assert card["surface"] == "windows"
    assert card["capability"] == ["keyboard.press", "keyboard.type"]
    assert card["app_scope"]["process"] == "notepad.exe"
    cid = card["card_id"]

    # after stop, no active recording remains
    assert skill_recording.recording_status(uid, aid) == {"recording": False}

    # prepare_execution gates capability + resolves params
    refused = _skill_card_prepare_execution(uid, {
        "card_id": cid, "params": {"filename": "x", "title": "t"},
        "available_tools": ["keyboard.press"],  # missing keyboard.type
    }, aid)
    assert not refused["ok"] and refused["reason"] == "missing_capability"
    assert "keyboard.type" in refused["missing"]

    ok = _skill_card_prepare_execution(uid, {
        "card_id": cid,
        "params": {"filename": "report.docx", "title": "Untitled"},
        "available_tools": ["keyboard.press", "keyboard.type"],
    }, aid)
    assert ok["ok"]
    # {{filename}} substituted in the resolved steps
    typed = [s for s in ok["resolved"]["steps"] if s.get("tool") == "keyboard.type"][0]
    assert typed["args"]["text"] == "report.docx"
    assert ok["resolved"]["app_scope"]["window_match"] == "Untitled"


def test_start_replaces_previous_active_recording():
    from api.services import skill_recording
    uid, aid = 5151, 88
    skill_recording.start_recording(uid, aid, {"name": "first"})
    second = skill_recording.start_recording(uid, aid, {"name": "second"})
    assert second["replaced_count"] == 1
    assert skill_recording.recording_status(uid, aid)["name"] == "second"


def test_stop_with_no_operations_creates_no_card():
    from api.services import skill_recording
    uid, aid = 6161, 99
    skill_recording.start_recording(uid, aid, {"name": "empty"})
    skill_recording.record_endpoint_event(uid, aid, "screen.capture", {}, {})  # observation only
    out = skill_recording.stop_recording(uid, aid, create_card=lambda a: {"card": {}})
    assert out["created"] is False
