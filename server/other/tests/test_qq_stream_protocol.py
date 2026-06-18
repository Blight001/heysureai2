import os
import threading
from unittest.mock import patch

from connector_runtime.bots.qq import service
from connector_runtime.bots.qq import stream_sender


def _capture_stream_payload(monkeypatch):
    captured = []
    monkeypatch.setattr(service, "_load_qq_config", lambda *_: object())
    monkeypatch.setattr(service, "_message_endpoint", lambda *_: "https://qq.invalid/messages")
    monkeypatch.setattr(
        service,
        "_post_qq_message",
        lambda _cfg, *, endpoint, payload: captured.append(payload) or {"id": "stream-1"},
    )
    return captured


def test_qq_http_session_ignores_environment_proxy_settings():
    service._HTTP_LOCAL.session = None
    with patch.dict(
        os.environ,
        {
            "HTTP_PROXY": "http://127.0.0.1:7897",
            "HTTPS_PROXY": "http://127.0.0.1:7897",
            "ALL_PROXY": "socks5://127.0.0.1:7897",
        },
    ):
        session = service._qq_http_session()
        settings = session.merge_environment_settings(
            service.QQ_TOKEN_URL,
            {},
            None,
            None,
            None,
        )

    assert session.trust_env is False
    assert settings["proxies"] == {}


def test_first_stream_packet_omits_id_and_finishes_with_newline(monkeypatch):
    captured = _capture_stream_payload(monkeypatch)

    service.post_qq_stream_packet(
        1,
        2,
        text="hello",
        target_id="openid",
        target_type="c2c",
        stream_id="",
        stream_index=0,
        stream_state=10,
        msg_id="source-message",
        msg_seq=1,
    )

    payload = captured[0]
    assert "id" not in payload["stream"]
    assert payload["stream"]["index"] == 0
    assert payload["markdown"]["content"] == "hello\n"


def test_followup_stream_packet_reuses_server_id(monkeypatch):
    captured = _capture_stream_payload(monkeypatch)

    service.post_qq_stream_packet(
        1,
        2,
        text=" world",
        target_id="openid",
        target_type="c2c",
        stream_id="stream-1",
        stream_index=1,
        stream_state=1,
    )

    assert captured[0]["stream"]["id"] == "stream-1"
    assert captured[0]["markdown"]["content"] == " world"


def _bare_stream_session():
    stream = stream_sender.QQStreamSession.__new__(stream_sender.QQStreamSession)
    stream.user_id = 1
    stream.ai_config_id = 2
    stream.ai_kind = "core"
    stream.session_id = "qq-test"
    stream.target_id = "openid"
    stream.target_type = "c2c"
    stream.msg_id = "source-message"
    stream.event_id = ""
    stream.markdown_mode = "native"
    stream.template_id = ""
    stream._seq = 1
    stream._index = 0
    stream._lock = threading.Lock()
    stream._stream_id = ""
    stream._started = False
    stream._failed = False
    stream._last_sent_text = ""
    return stream


def test_failed_stream_packet_does_not_consume_passive_reply_sequence(monkeypatch):
    stream = _bare_stream_session()
    monkeypatch.setattr(
        stream_sender,
        "post_qq_stream_packet",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("rejected")),
    )

    stream._send_packet("hello", final=False)

    assert stream._failed is True
    assert stream._seq == 1
    assert stream._index == 0


def test_stream_sends_full_snapshots_and_reuses_passive_reply_sequence(monkeypatch):
    stream = _bare_stream_session()
    calls = []
    monkeypatch.setattr(
        stream_sender,
        "post_qq_stream_packet",
        lambda *args, **kwargs: calls.append(kwargs) or {"id": "stream-1"},
    )
    bumped = []
    monkeypatch.setattr(stream, "_bump_route_sequence", lambda next_seq: bumped.append(next_seq))

    stream._send_packet("hello", final=False)
    stream._send_packet("hello world", final=False)
    stream._send_packet("hello world", final=True, force=True)

    assert [call["text"] for call in calls] == ["hello", "hello world", "hello world"]
    assert [call["stream_index"] for call in calls] == [0, 1, 2]
    assert [call["msg_seq"] for call in calls] == [1, 1, 1]
    assert [call["reset"] for call in calls] == [False, True, True]
    assert calls[-1]["reset"] is True
    assert bumped == [2]


def test_stream_fallback_uses_next_sequence_after_partial_stream(monkeypatch):
    stream = _bare_stream_session()
    stream._started = True
    calls = []
    bumped = []
    monkeypatch.setattr(
        stream_sender,
        "send_qq_markdown_message",
        lambda *args, **kwargs: calls.append(kwargs) or {"message_id": "fallback"},
    )
    monkeypatch.setattr(stream, "_bump_route_sequence", lambda next_seq: bumped.append(next_seq))

    stream._fallback_full_send("complete answer")

    assert calls[0]["msg_seq"] == 2
    assert calls[0]["text"] == "complete answer"
    assert bumped == [3]


def test_finalize_resets_stream_without_thinking_or_mcp_prefix(monkeypatch):
    stream = _bare_stream_session()
    stream._started = True
    stream._last_text = "answer"
    stream._last_sent_text = "answer"
    stream._finished = False
    calls = []
    monkeypatch.setattr(
        stream_sender,
        "post_qq_stream_packet",
        lambda *args, **kwargs: calls.append(kwargs) or {"id": "stream-1"},
    )

    stream._finalize()

    assert calls[0]["text"] == "answer"
    assert calls[0]["stream_state"] == stream_sender._STREAM_STATE_FINISHED
    assert calls[0]["reset"] is True
