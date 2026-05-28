import logging
import os
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status, Header
from sqlmodel import Session, select

from api.auth import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    create_access_token,
    decode_access_token,
    get_password_hash,
    verify_password,
)
from api.core.config import (
    USER_WORKSPACE_SUBFOLDERS,
    WORKSPACE_DIR,
    user_workspace_dir,
)
from api.database import get_session
from api.models import Token, User, UserCreate, UserLogin, UserRead, UserUpdate
from api.models.defaults import DEFAULT_MCP_NAMESPACE_HINTS
from api.services.ai_service import ensure_default_ai_for_user
from api.services.model_presets import model_presets_json


logger = logging.getLogger(__name__)

router = APIRouter()
PREFIX = "/api/auth"


def _parse_bool_setting(value, default: bool = True) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    text = str(value).strip().lower()
    if text in {"0", "false", "off", "no"}:
        return False
    if text in {"1", "true", "on", "yes"}:
        return True
    return default

def ensure_user_workspace(user_id: int) -> None:
    """Ensure the per-user workspace directory and its standard subfolders exist."""
    user_dir = user_workspace_dir(user_id)
    try:
        os.makedirs(WORKSPACE_DIR, exist_ok=True)
        if not os.path.exists(user_dir):
            os.makedirs(user_dir)
            logger.info(f"Created user directory: {user_dir}")
        for folder in USER_WORKSPACE_SUBFOLDERS:
            folder_path = os.path.join(user_dir, folder)
            if not os.path.exists(folder_path):
                os.makedirs(folder_path)
                logger.info(f"Created subfolder: {folder_path}")
    except Exception as exc:
        logger.exception(f"Error ensuring user directories for user {user_id}: {exc}")

def get_current_user_from_token(token: str = Depends(lambda x: x), session: Session = Depends(get_session)):
    # This dependency can be used to get user from Bearer token
    # FastAPI OAuth2PasswordBearer would be better but keeping it simple for now
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return get_current_user(token, session)

def get_current_user(token: str, session: Session = Depends(get_session)):
    try:
        if token.startswith("Bearer "):
            token = token.split(" ")[1]
        payload = decode_access_token(token)
        if payload is None:
             raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Could not validate credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )
        username: str = payload.get("sub")
        if username is None:
             raise HTTPException(status_code=401, detail="Invalid token")
             
        statement = select(User).where(User.account == username)
        user = session.exec(statement).first()
        if user is None:
            raise HTTPException(status_code=404, detail="User not found")
        return user
    except HTTPException:
         raise
    except Exception as e:
         logger.exception(f"Error in get_current_user: {e}")
         raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Could not validate credentials: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"},
        )

@router.post("/register", response_model=UserRead)
async def register(
    user_create: UserCreate,
    session: Session = Depends(get_session)
):
    statement = select(User).where(User.account == user_create.account)
    existing_user = session.exec(statement).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Account already registered")
    
    hashed_password = get_password_hash(user_create.password)
    db_user = User(
        name=user_create.name, 
        account=user_create.account, 
        hashed_password=hashed_password, 
        avatar=user_create.avatar
    )
    session.add(db_user)
    session.commit()
    session.refresh(db_user)

    # 自动在 workspace 目录中创建对应用户的数据库 ID 目录名及其子目录
    ensure_user_workspace(db_user.id)
    ensure_default_ai_for_user(session, db_user.id)

    return db_user

@router.post("/login", response_model=Token)
async def login(user_in: UserLogin, session: Session = Depends(get_session)):
    statement = select(User).where(User.account == user_in.account)
    user = session.exec(statement).first()
    if not user or not verify_password(user_in.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # 登录时检查并确保用户的 workspace 目录存在
    ensure_user_workspace(user.id)
    ensure_default_ai_for_user(session, user.id)
    
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.account, "user_id": user.id}, expires_delta=access_token_expires
    )
    
    return {"access_token": access_token, "token_type": "bearer", "user": user}

@router.put("/profile", response_model=UserRead)
async def update_profile(
    user_update: UserUpdate,
    authorization: str = Header(None),
    session: Session = Depends(get_session)
):
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authentication token")

    user = get_current_user(authorization, session)
    
    update_data = user_update.model_dump(exclude_unset=True)
    if "ui_theme_mode" in update_data:
        raw_theme = str(update_data.get("ui_theme_mode") or "").lower()
        update_data["ui_theme_mode"] = "light" if raw_theme == "light" else "dark"
    if "ui_font_size" in update_data:
        raw_font = str(update_data.get("ui_font_size") or "").lower()
        update_data["ui_font_size"] = raw_font if raw_font in {"sm", "md", "lg"} else "md"
    if "ui_brain_view_mode" in update_data:
        raw_mode = str(update_data.get("ui_brain_view_mode") or "").lower()
        update_data["ui_brain_view_mode"] = raw_mode if raw_mode in {"sections", "all"} else "sections"
    for enabled_key in {
        "ui_thinking_icon_enabled",
        "ui_mcp_success_icon_enabled",
        "ui_mcp_error_icon_enabled",
        "ui_plain_text_output_enabled",
    }:
        if enabled_key in update_data:
            update_data[enabled_key] = _parse_bool_setting(
                update_data.get(enabled_key),
                False if enabled_key == "ui_plain_text_output_enabled" else True,
            )
    for icon_key, fallback in {
        "ui_thinking_icon": "🤔",
        "ui_mcp_icon": "🧰",
        "ui_mcp_success_icon": "🧰",
        "ui_mcp_error_icon": "❌",
    }.items():
        if icon_key in update_data:
            value = str(update_data.get(icon_key) or "").strip()
            update_data[icon_key] = value[:8] if value else fallback
    if "mcp_max_steps" in update_data:
        try:
            update_data["mcp_max_steps"] = max(1, min(999, int(update_data.get("mcp_max_steps") or 48)))
        except Exception:
            update_data["mcp_max_steps"] = 48
    if "ai_message_inquiry_reminder_seconds" in update_data:
        try:
            update_data["ai_message_inquiry_reminder_seconds"] = max(
                0,
                min(3600, int(update_data.get("ai_message_inquiry_reminder_seconds") or 0)),
            )
        except Exception:
            update_data["ai_message_inquiry_reminder_seconds"] = 3
    if "model_presets" in update_data:
        update_data["model_presets"] = model_presets_json(update_data.get("model_presets"), user)
    if "mcp_call_method" in update_data:
        update_data["mcp_call_method"] = "\n".join(
            line for line in str(update_data.get("mcp_call_method") or "").splitlines()
            if "Call exactly one tool per <mcp-call> block; never join two tool names into one name." not in line
        ).strip()
    if "mcp_namespace_hints" in update_data:
        raw_hints = str(update_data.get("mcp_namespace_hints") or "").strip()
        if raw_hints:
            import json
            try:
                parsed = json.loads(raw_hints)
                if not isinstance(parsed, dict):
                    raise ValueError("mcp_namespace_hints must be a JSON object")
                update_data["mcp_namespace_hints"] = json.dumps(
                    {str(k).strip(): str(v).strip() for k, v in parsed.items() if str(k).strip() and str(v).strip()},
                    ensure_ascii=False,
                )
            except Exception:
                raise HTTPException(status_code=400, detail="mcp_namespace_hints must be a JSON object")
        else:
            update_data["mcp_namespace_hints"] = DEFAULT_MCP_NAMESPACE_HINTS
    
    if "password" in update_data:
        password = update_data.pop("password")
        if password:
            user.hashed_password = get_password_hash(password)
            
    for key, value in update_data.items():
        setattr(user, key, value)
        
    session.add(user)
    session.commit()
    session.refresh(user)
    return user

@router.get("/me", response_model=UserRead)
async def read_users_me(authorization: str = Header(None), session: Session = Depends(get_session)):
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authentication token")
    return get_current_user(authorization, session)
