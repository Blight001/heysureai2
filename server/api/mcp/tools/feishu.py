from typing import Optional

from ...integrations.feishu.service import send_feishu_text_message


def _feishu_send_message(user_id: int, args: dict, ai_config_id: Optional[int] = None):
    text = str(args.get("text") or args.get("content") or args.get("message") or "").strip()
    receive_id = str(args.get("receive_id") or args.get("chat_id") or args.get("open_id") or "").strip()
    receive_id_type = str(args.get("receive_id_type") or ("open_id" if args.get("open_id") else "")).strip()
    return send_feishu_text_message(
        user_id,
        ai_config_id,
        text=text,
        receive_id=receive_id,
        receive_id_type=receive_id_type,
    )
