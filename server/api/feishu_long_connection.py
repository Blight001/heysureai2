import json
import threading
from typing import Dict, Set

from sqlmodel import Session, select

from api.database import engine
from api.models import AssistantAIConfig
from api.routers.feishu import handle_feishu_event_payload

_LOCK = threading.Lock()
_STARTED_CONFIG_IDS: Set[int] = set()
_THREADS: Dict[int, threading.Thread] = {}
_LAST_ERRORS: Dict[int, str] = {}


def _run_feishu_ws_client(config_id: int, app_id: str, app_secret: str) -> None:
    try:
        import lark_oapi as lark
    except Exception as exc:
        print(f"[feishu_long_connection] lark-oapi is not installed: {exc}")
        with _LOCK:
            _STARTED_CONFIG_IDS.discard(config_id)
            _LAST_ERRORS[config_id] = f"lark-oapi is not installed: {exc}"
        return

    def do_p2_im_message_receive_v1(data) -> None:
        try:
            raw = lark.JSON.marshal(data)
            payload = raw if isinstance(raw, dict) else json.loads(raw)
            handle_feishu_event_payload(config_id, payload, verify_token=False)
        except Exception as exc:
            print(f"[feishu_long_connection] handle event failed config_id={config_id}: {exc}")

    event_handler = (
        lark.EventDispatcherHandler.builder("", "")
        .register_p2_im_message_receive_v1(do_p2_im_message_receive_v1)
        .build()
    )
    try:
        client = lark.ws.Client(
            app_id,
            app_secret,
            event_handler=event_handler,
            log_level=lark.LogLevel.DEBUG,
            auto_reconnect=True,
        )
    except TypeError:
        client = lark.ws.Client(
            app_id,
            app_secret,
            event_handler=event_handler,
            log_level=lark.LogLevel.DEBUG,
        )
    print(f"[feishu_long_connection] starting config_id={config_id}")
    try:
        client.start()
    except Exception as exc:
        print(f"[feishu_long_connection] stopped config_id={config_id}: {exc}")
        with _LOCK:
            _LAST_ERRORS[config_id] = str(exc)
    finally:
        with _LOCK:
            _STARTED_CONFIG_IDS.discard(config_id)
            _THREADS.pop(config_id, None)


def start_feishu_long_connection_clients() -> int:
    started = 0
    with Session(engine) as session:
        configs = session.exec(
            select(AssistantAIConfig).where(
                AssistantAIConfig.feishu_enabled == True,
                AssistantAIConfig.feishu_app_id != "",
                AssistantAIConfig.feishu_app_secret != "",
            )
        ).all()

    for cfg in configs:
        config_id = int(cfg.id or 0)
        app_id = str(cfg.feishu_app_id or "").strip()
        app_secret = str(cfg.feishu_app_secret or "").strip()
        if not config_id or not app_id or not app_secret:
            continue
        with _LOCK:
            thread = _THREADS.get(config_id)
            if config_id in _STARTED_CONFIG_IDS and thread and thread.is_alive():
                continue
            _STARTED_CONFIG_IDS.add(config_id)
            _LAST_ERRORS.pop(config_id, None)
            thread = threading.Thread(
                target=_run_feishu_ws_client,
                args=(config_id, app_id, app_secret),
                daemon=True,
            )
            _THREADS[config_id] = thread
            thread.start()
            started += 1
    return started


def get_feishu_long_connection_state(config_id: int) -> Dict[str, str]:
    with _LOCK:
        thread = _THREADS.get(config_id)
        is_running = bool(config_id in _STARTED_CONFIG_IDS and thread and thread.is_alive())
        error = _LAST_ERRORS.get(config_id, "")
    if is_running:
        return {"status": "success", "message": "长连接运行中"}
    if error:
        return {"status": "failed", "message": error}
    return {"status": "failed", "message": "长连接未运行"}
