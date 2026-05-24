import os
import subprocess
from typing import Any, Dict, List, Optional

import git
from fastapi import HTTPException
from sqlmodel import Session, select

from ...database import engine
from ...models import AIRuntimeStatus, AssistantAIConfig
from ...sio import agents, sio
from ..core import _IGNORED_WORKSPACE_DIRS, generate_file_tree, get_project_root, safe_join
def _list_files(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    project_root = get_project_root(user_id, ai_config_id)
    all_paths: List[str] = []
    for root, dirs, files in os.walk(project_root):
        dirs[:] = [d for d in dirs if d not in _IGNORED_WORKSPACE_DIRS]
        rel_root = os.path.relpath(root, project_root)
        if rel_root == ".":
            rel_root = ""

        for directory in dirs:
            dir_path = os.path.join(rel_root, directory) if rel_root else directory
            all_paths.append(dir_path.replace(os.sep, "/") + "/")

        for filename in files:
            file_path = os.path.join(rel_root, filename) if rel_root else filename
            all_paths.append(file_path.replace(os.sep, "/"))

    return {"paths": sorted(list(set(all_paths)))}

def _parse_int_arg(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except Exception:
        parsed = default
    return max(minimum, min(maximum, parsed))

def _normalize_paths_arg(value: Any) -> List[str]:
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return []
    out: List[str] = []
    seen = set()
    for item in value:
        path = str(item or "").strip()
        if not path or path in seen:
            continue
        seen.add(path)
        out.append(path)
    return out

def _safe_read_file_excerpt(file_path: str, max_bytes: int) -> tuple[str, int, bool]:
    with open(file_path, "rb") as file:
        data = file.read(max_bytes + 1)
    truncated = len(data) > max_bytes
    if truncated:
        data = data[:max_bytes]
    text = data.decode("utf-8", errors="replace")
    return text, len(data), truncated

def _read_files(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    project_root = get_project_root(user_id, ai_config_id)
    paths = _normalize_paths_arg(args.get("paths", []))
    if not paths:
        raise HTTPException(status_code=400, detail="paths is required and must contain at least one file path")

    max_files = _parse_int_arg(args.get("max_files"), 5, 1, 50)
    if len(paths) > max_files:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Too many paths in one call ({len(paths)} > {max_files}). "
                "Please read fewer files each time or use workspace.read_file_by_name for targeted reads."
            ),
        )
    max_total_bytes = _parse_int_arg(args.get("max_total_bytes"), 120000, 4096, 2_000_000)
    max_single_file_bytes = _parse_int_arg(args.get("max_single_file_bytes"), 50000, 1024, max_total_bytes)

    contents: Dict[str, str] = {}
    errors: Dict[str, str] = {}
    truncated_paths: List[str] = []
    skipped_paths: List[str] = []
    total_bytes = 0
    for path in paths:
        try:
            file_path = safe_join(project_root, path)
            if not os.path.exists(file_path):
                errors[path] = "File not found"
                continue
            if os.path.isdir(file_path):
                errors[path] = "Path is a directory; please pass a concrete file path or use workspace.read_file_by_name"
                continue

            remaining_bytes = max_total_bytes - total_bytes
            if remaining_bytes <= 0:
                skipped_paths.append(path)
                continue
            read_budget = min(max_single_file_bytes, remaining_bytes)
            text, consumed, truncated = _safe_read_file_excerpt(file_path, read_budget)
            total_bytes += int(consumed)
            if truncated:
                text = text + "\n...<truncated>"
                truncated_paths.append(path)
            contents[path] = text
        except HTTPException as exc:
            errors[path] = str(exc.detail)
        except Exception as exc:
            errors[path] = f"Error: {str(exc)}"
    return {
        "files": contents,
        "errors": errors,
        "meta": {
            "paths_requested": len(paths),
            "files_read": len(contents),
            "total_bytes": int(total_bytes),
            "max_files": int(max_files),
            "max_total_bytes": int(max_total_bytes),
            "max_single_file_bytes": int(max_single_file_bytes),
            "truncated_paths": truncated_paths,
            "skipped_paths": skipped_paths,
            "limited": bool(truncated_paths or skipped_paths),
        },
    }

def _find_files_by_name(
    project_root: str,
    name: str,
    *,
    case_sensitive: bool = False,
    max_matches: int = 20,
    allow_partial: bool = True,
) -> List[str]:
    target = str(name or "").strip()
    if not target:
        return []

    direct_path = target.replace("\\", "/").strip("/")
    if "/" in direct_path:
        try:
            abs_target = safe_join(project_root, direct_path)
            if os.path.exists(abs_target) and os.path.isfile(abs_target):
                return [direct_path]
        except Exception:
            pass

    normalized_target = target if case_sensitive else target.lower()
    exact_matches: List[str] = []
    partial_matches: List[str] = []
    for root, dirs, files in os.walk(project_root):
        dirs[:] = [d for d in dirs if d not in _IGNORED_WORKSPACE_DIRS]
        for filename in files:
            probe = filename if case_sensitive else filename.lower()
            rel_path = os.path.relpath(os.path.join(root, filename), project_root).replace(os.sep, "/")
            if probe == normalized_target:
                exact_matches.append(rel_path)
                if len(exact_matches) >= max_matches:
                    return exact_matches[:max_matches]
                continue
            if allow_partial and normalized_target in probe:
                partial_matches.append(rel_path)
                if len(partial_matches) >= max_matches:
                    break
        if len(partial_matches) >= max_matches:
            break
    if exact_matches:
        return exact_matches[:max_matches]
    return partial_matches[:max_matches]

def _read_file_by_name(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    project_root = get_project_root(user_id, ai_config_id)
    names_arg = args.get("names")
    if names_arg is None:
        single_name = str(args.get("name") or "").strip()
        names = [single_name] if single_name else []
    elif isinstance(names_arg, str):
        names = [names_arg.strip()] if names_arg.strip() else []
    elif isinstance(names_arg, list):
        names = [str(item or "").strip() for item in names_arg if str(item or "").strip()]
    else:
        names = []

    if not names:
        raise HTTPException(status_code=400, detail="name or names is required for workspace.read_file_by_name")

    max_matches = _parse_int_arg(args.get("max_matches"), 20, 1, 200)
    case_sensitive = bool(args.get("case_sensitive", False))
    allow_partial = bool(args.get("allow_partial", True))
    read_all_matches = bool(args.get("read_all_matches", False))

    matched_paths: Dict[str, List[str]] = {}
    resolved_paths: List[str] = []
    dedup = set()
    for query in names:
        matches = _find_files_by_name(
            project_root,
            query,
            case_sensitive=case_sensitive,
            max_matches=max_matches,
            allow_partial=allow_partial,
        )
        matched_paths[query] = matches
        selected = matches if read_all_matches else (matches[:1] if matches else [])
        for path in selected:
            if path in dedup:
                continue
            dedup.add(path)
            resolved_paths.append(path)

    if not resolved_paths:
        return {
            "files": {},
            "errors": {},
            "queries": names,
            "matched_paths": matched_paths,
            "resolved_paths": [],
            "meta": {"paths_requested": 0, "files_read": 0, "total_bytes": 0, "limited": False},
        }

    read_args = dict(args)
    read_args["paths"] = resolved_paths
    read_result = _read_files(user_id, read_args, ai_config_id)
    read_result["queries"] = names
    read_result["matched_paths"] = matched_paths
    read_result["resolved_paths"] = resolved_paths
    return read_result

def _as_dict(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}

def _pick_first_non_empty_str(*values: Any) -> str:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return ""

def _parse_bool_arg(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        raw = value.strip().lower()
        if raw in {"1", "true", "yes", "on"}:
            return True
        if raw in {"0", "false", "no", "off"}:
            return False
    return default

def _stringify_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return str(value)

def _extract_write_request(args: Dict[str, Any]) -> Dict[str, Any]:
    target = _as_dict(args.get("target"))
    file_block = _as_dict(args.get("file"))
    options = _as_dict(args.get("options"))

    path = _pick_first_non_empty_str(
        args.get("path"),
        target.get("path"),
        file_block.get("path"),
    )
    if not path:
        raise HTTPException(status_code=400, detail="Missing path. Provide path or target.path")

    raw_content = args.get("content")
    if raw_content is None:
        raw_content = file_block.get("content")
    if raw_content is None:
        raw_content = _as_dict(args.get("body")).get("text")
    if isinstance(raw_content, dict):
        raw_content = _pick_first_non_empty_str(
            raw_content.get("text"),
            raw_content.get("value"),
            raw_content.get("raw"),
        )
    content = _stringify_text(raw_content)

    create = _parse_bool_arg(options.get("create", args.get("create", True)), True)
    overwrite = _parse_bool_arg(options.get("overwrite", args.get("overwrite", True)), True)
    create_dirs = _parse_bool_arg(options.get("create_dirs", True), True)

    if_exists = _pick_first_non_empty_str(options.get("if_exists"), args.get("if_exists")).lower()
    if if_exists in {"error", "fail"}:
        overwrite = False
    elif if_exists in {"overwrite", "replace"}:
        overwrite = True
    elif if_exists == "skip":
        overwrite = False

    normalized_path = path.replace("\\", "/").strip("/")
    if not normalized_path:
        raise HTTPException(status_code=400, detail="Invalid path")

    return {
        "path": normalized_path,
        "content": content,
        "create": create,
        "overwrite": overwrite,
        "if_exists": if_exists,
        "create_dirs": create_dirs,
    }

def _extract_edit_operations(args: Dict[str, Any]) -> List[Dict[str, Any]]:
    edits_raw = args.get("edits")
    if edits_raw is None:
        edits_raw = args.get("operations")
    if edits_raw is None:
        search = _stringify_text(args.get("search", ""))
        replace = _stringify_text(args.get("replace", ""))
        if search:
            return [{
                "op": "replace",
                "search": search,
                "replace": replace,
                "replace_all": _parse_bool_arg(args.get("replace_all"), False),
                "allow_missing": False,
            }]
        return [{"op": "set", "content": replace}]

    if isinstance(edits_raw, dict):
        edits_raw = [edits_raw]
    if not isinstance(edits_raw, list) or not edits_raw:
        raise HTTPException(status_code=400, detail="edits must be a non-empty array")

    normalized: List[Dict[str, Any]] = []
    for idx, raw in enumerate(edits_raw):
        if not isinstance(raw, dict):
            raise HTTPException(status_code=400, detail=f"Invalid edit at index {idx}: expected object")
        op = str(raw.get("op") or "").strip().lower()
        if not op:
            op = "replace" if ("search" in raw or "match" in raw or "find" in raw) else "set"

        if op in {"replace", "substitute"}:
            search = _pick_first_non_empty_str(raw.get("search"), raw.get("match"), raw.get("find"))
            if not search:
                raise HTTPException(status_code=400, detail=f"Edit {idx + 1} missing search/match/find")
            normalized.append(
                {
                    "op": "replace",
                    "search": search,
                    "replace": _stringify_text(
                        raw.get("replace")
                        if raw.get("replace") is not None
                        else raw.get("with")
                        if raw.get("with") is not None
                        else raw.get("value")
                        if raw.get("value") is not None
                        else raw.get("content")
                        if raw.get("content") is not None
                        else raw.get("text")
                    ),
                    "replace_all": _parse_bool_arg(
                        raw.get("replace_all")
                        if raw.get("replace_all") is not None
                        else raw.get("all")
                        if raw.get("all") is not None
                        else raw.get("global"),
                        False,
                    ),
                    "allow_missing": _parse_bool_arg(raw.get("allow_missing"), False),
                }
            )
            continue

        if op in {"set", "overwrite"}:
            normalized.append(
                {
                    "op": "set",
                    "content": _stringify_text(
                        raw.get("content")
                        if raw.get("content") is not None
                        else raw.get("text")
                        if raw.get("text") is not None
                        else raw.get("value")
                        if raw.get("value") is not None
                        else raw.get("replace")
                    ),
                }
            )
            continue

        if op in {"append", "prepend"}:
            normalized.append(
                {
                    "op": op,
                    "content": _stringify_text(
                        raw.get("content")
                        if raw.get("content") is not None
                        else raw.get("text")
                        if raw.get("text") is not None
                        else raw.get("value")
                    ),
                }
            )
            continue

        raise HTTPException(status_code=400, detail=f"Unsupported edit op at index {idx}: {op}")
    return normalized

def _apply_edit_operation(content: str, op: Dict[str, Any], index: int) -> tuple[str, Dict[str, Any]]:
    action = str(op.get("op") or "").strip().lower()
    if action == "set":
        next_content = _stringify_text(op.get("content"))
        return next_content, {"index": index, "op": "set", "applied": True}
    if action == "append":
        next_content = content + _stringify_text(op.get("content"))
        return next_content, {"index": index, "op": "append", "applied": True}
    if action == "prepend":
        next_content = _stringify_text(op.get("content")) + content
        return next_content, {"index": index, "op": "prepend", "applied": True}
    if action == "replace":
        search = _stringify_text(op.get("search"))
        replace = _stringify_text(op.get("replace"))
        if search not in content:
            if _parse_bool_arg(op.get("allow_missing"), False):
                return content, {"index": index, "op": "replace", "applied": False, "reason": "search_not_found"}
            raise HTTPException(status_code=400, detail=f"Edit {index + 1} SEARCH block not found in file")
        if _parse_bool_arg(op.get("replace_all"), False):
            count = content.count(search)
            return content.replace(search, replace), {"index": index, "op": "replace", "applied": True, "occurrences": count}
        return content.replace(search, replace, 1), {"index": index, "op": "replace", "applied": True, "occurrences": 1}
    raise HTTPException(status_code=400, detail=f"Unsupported edit op: {action}")

def _write_file(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    request = _extract_write_request(args)
    path = request["path"]
    content = request["content"]
    create = bool(request["create"])
    overwrite = bool(request["overwrite"])
    if_exists = str(request["if_exists"] or "").lower()
    create_dirs = bool(request["create_dirs"])

    project_root = get_project_root(user_id, ai_config_id)
    file_path = safe_join(project_root, path)
    existed = os.path.exists(file_path)

    if existed and os.path.isdir(file_path):
        raise HTTPException(status_code=400, detail="Path is a directory")
    if existed and if_exists == "skip":
        return {
            "path": path,
            "created": False,
            "updated": False,
            "skipped": True,
            "reason": "if_exists=skip",
            "bytes": 0,
            "undo": None,
        }
    if existed and not overwrite:
        raise HTTPException(status_code=400, detail=f"File already exists: {path}")
    if not existed and not create:
        raise HTTPException(status_code=404, detail=f"File not found and create=false: {path}")

    before = None
    if existed:
        with open(file_path, "r", encoding="utf-8") as file:
            before = file.read()
    else:
        parent_dir = os.path.dirname(file_path)
        if parent_dir and not os.path.exists(parent_dir):
            if not create_dirs:
                raise HTTPException(status_code=400, detail=f"Parent directory does not exist: {path}")
            os.makedirs(parent_dir, exist_ok=True)

    with open(file_path, "w", encoding="utf-8") as file:
        file.write(content)

    undo = {"tool": "workspace.delete_path", "arguments": {"path": path}} if not existed else {
        "tool": "workspace.write_file",
        "arguments": {"path": path, "content": before, "create": True, "overwrite": True},
    }
    return {
        "path": path,
        "created": not existed,
        "updated": bool(existed),
        "bytes": len(content.encode("utf-8")),
        "undo": undo,
    }

def _edit_file(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    target = _as_dict(args.get("target"))
    options = _as_dict(args.get("options"))
    path = _pick_first_non_empty_str(args.get("path"), target.get("path"))
    if not path:
        raise HTTPException(status_code=400, detail="Missing path. Provide path or target.path")
    path = path.replace("\\", "/").strip("/")
    if not path:
        raise HTTPException(status_code=400, detail="Invalid path")
    create_if_missing = _parse_bool_arg(options.get("create_if_missing", args.get("create_if_missing", False)), False)
    create_seed = _stringify_text(options.get("create_content", args.get("create_content", "")))
    operations = _extract_edit_operations(args)
    is_legacy_shape = args.get("edits") is None and args.get("operations") is None

    project_root = get_project_root(user_id, ai_config_id)
    file_path = safe_join(project_root, path)
    existed = os.path.exists(file_path)

    if not existed:
        if create_if_missing:
            if is_legacy_shape:
                legacy_content = _stringify_text(args.get("replace", ""))
                return _write_file(
                    user_id,
                    {"path": path, "content": legacy_content, "create": True, "overwrite": False},
                    ai_config_id,
                )
            current_content = create_seed
        else:
            raise HTTPException(status_code=404, detail=f"File not found: {path}")
    else:
        if os.path.isdir(file_path):
            raise HTTPException(status_code=400, detail="Path is a directory")
        with open(file_path, "r", encoding="utf-8") as file:
            current_content = file.read()

    before_content = current_content
    operation_results: List[Dict[str, Any]] = []
    for idx, op in enumerate(operations):
        current_content, result = _apply_edit_operation(current_content, op, idx)
        operation_results.append(result)

    with open(file_path, "w", encoding="utf-8") as file:
        file.write(current_content)

    return {
        "path": path,
        "created": not existed,
        "updated": True,
        "bytes_before": len(before_content.encode("utf-8")),
        "bytes_after": len(current_content.encode("utf-8")),
        "edits_requested": len(operations),
        "edits_applied": sum(1 for item in operation_results if item.get("applied")),
        "edits_skipped": [item for item in operation_results if not item.get("applied")],
        "undo": {
            "tool": "workspace.write_file",
            "arguments": {"path": path, "content": before_content, "create": True, "overwrite": True},
        },
    }

def _delete_path(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    path = args.get("path")
    if not path:
        raise HTTPException(status_code=400, detail="Missing path")

    project_root = get_project_root(user_id, ai_config_id)
    target_path = safe_join(project_root, path)
    if not os.path.exists(target_path):
        raise HTTPException(status_code=404, detail=f"Path not found: {path}")

    if os.path.isdir(target_path):
        raise HTTPException(status_code=400, detail="Directory deletion is not supported via MCP")

    with open(target_path, "r", encoding="utf-8") as file:
        previous_content = file.read()
    os.remove(target_path)

    return {
        "path": path,
        "deleted": True,
        "undo": {
            "tool": "workspace.write_file",
            "arguments": {"path": path, "content": previous_content, "create": True, "overwrite": True},
        },
    }

def _run_command(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    command = args.get("command")
    if not command:
        raise HTTPException(status_code=400, detail="Missing command")

    project_root = get_project_root(user_id, ai_config_id)
    result = subprocess.run(
        command,
        shell=True,
        cwd=project_root,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    output = result.stdout
    if result.stderr:
        output += f"\nError:\n{result.stderr}"

    return {
        "command": command,
        "success": result.returncode == 0,
        "exit_code": result.returncode,
        "output": output,
    }

def _find_dirs_by_name(project_root: str, name: str, case_sensitive: bool = False, max_matches: int = 50) -> List[str]:
    target = (name or "").strip()
    if not target:
        return []
    normalized_target = target if case_sensitive else target.lower()
    results: List[str] = []
    for root, dirs, _files in os.walk(project_root):
        dirs[:] = [d for d in dirs if d not in [".git", "__pycache__", "venv", "node_modules", ".aider"]]
        for d in dirs:
            probe = d if case_sensitive else d.lower()
            if probe != normalized_target:
                continue
            abs_path = os.path.join(root, d)
            rel_path = os.path.relpath(abs_path, project_root).replace(os.sep, "/")
            results.append(rel_path)
            if len(results) >= max_matches:
                return results
    return results

def _get_tree(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    project_root = get_project_root(user_id, ai_config_id)
    target_path = str(args.get("path") or "").strip()
    target_name = str(args.get("name") or "").strip()
    case_sensitive = bool(args.get("case_sensitive", False))
    max_matches = int(args.get("max_matches", 20) or 20)
    max_matches = max(1, min(max_matches, 200))

    if target_path:
        abs_target = safe_join(project_root, target_path)
        if not os.path.exists(abs_target):
            raise HTTPException(status_code=404, detail=f"Path not found: {target_path}")
        if not os.path.isdir(abs_target):
            raise HTTPException(status_code=400, detail=f"Path is not a directory: {target_path}")
        rel = os.path.relpath(abs_target, project_root).replace(os.sep, "/")
        return {
            "root": rel,
            "matched_paths": [rel],
            "tree": generate_file_tree(abs_target),
        }

    if target_name:
        matches = _find_dirs_by_name(project_root, target_name, case_sensitive=case_sensitive, max_matches=max_matches)
        if not matches:
            return {"name": target_name, "matched_paths": [], "tree": ""}
        first = matches[0]
        abs_first = safe_join(project_root, first)
        return {
            "name": target_name,
            "matched_paths": matches,
            "selected_path": first,
            "tree": generate_file_tree(abs_first),
        }

    return {"root": ".", "matched_paths": ["."], "tree": generate_file_tree(project_root)}

def _get_git_diff(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    project_root = get_project_root(user_id, ai_config_id)
    try:
        repo = git.Repo(project_root, search_parent_directories=True)
        changed_files = [item.a_path for item in repo.index.diff(None)]
        untracked_files = repo.untracked_files
        diff = repo.git.diff()
        return {"changed": changed_files + untracked_files, "diff": diff}
    except Exception as exc:
        return {"changed": [], "diff": "", "error": str(exc)}

def _list_connected_socket_agents() -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for item in list(agents.values()):
        row = dict(item) if isinstance(item, dict) else {"value": item}
        row["source"] = "socket"
        row["dispatchable"] = True
        out.append(row)
    return out

def _list_managed_ai_agents(user_id: int) -> List[Dict[str, Any]]:
    with Session(engine) as session:
        cfgs = session.exec(
            select(AssistantAIConfig)
            .where(AssistantAIConfig.user_id == user_id)
            .order_by(AssistantAIConfig.sort_order.asc(), AssistantAIConfig.created_at.asc())
        ).all()
        statuses = session.exec(
            select(AIRuntimeStatus).where(
                AIRuntimeStatus.user_id == user_id,
                AIRuntimeStatus.ai_kind == "assistant",
            )
        ).all()
    status_map = {int(row.ai_config_id): row for row in statuses if row.ai_config_id is not None}
    out: List[Dict[str, Any]] = []
    for cfg in cfgs:
        status = status_map.get(int(cfg.id or 0))
        current_status = str(status.current_status or "").strip() if status else ""
        out.append(
            {
                "id": f"ai_config_{cfg.id}",
                "ai_config_id": cfg.id,
                "name": cfg.name,
                "ai_role": cfg.ai_role,
                "digital_member_role": cfg.digital_member_role,
                "enabled": bool(cfg.enabled),
                "mcp_enabled": bool(cfg.mcp_enabled),
                "runtime_status": current_status or ("idle" if cfg.enabled else "stopped"),
                "runtime_tool": str(status.current_mcp_tool or "").strip() if status else "",
                "source": "ai_config",
                "dispatchable": False,
            }
        )
    return out

def _list_agents(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    connected_agents = _list_connected_socket_agents()
    managed_agents = _list_managed_ai_agents(user_id)
    all_agents = connected_agents + managed_agents
    return {
        "agents": all_agents,
        "agent_count": len(all_agents),
        "connected_agents": connected_agents,
        "connected_agent_count": len(connected_agents),
        "managed_agents": managed_agents,
        "managed_agent_count": len(managed_agents),
        "note": "connected_agents are socket-registered and dispatchable; managed_agents are AI configs for visibility.",
    }

def _get_overview(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    project_root = get_project_root(user_id, ai_config_id)
    cfg_db_uri = None
    if ai_config_id:
        with Session(engine) as session:
            cfg = session.exec(
                select(AssistantAIConfig).where(
                    AssistantAIConfig.user_id == user_id,
                    AssistantAIConfig.id == ai_config_id,
                )
            ).first()
            if cfg:
                cfg_db_uri = cfg.database_uri
    connected_agents = _list_connected_socket_agents()
    managed_agents = _list_managed_ai_agents(user_id)
    all_agents = connected_agents + managed_agents
    return {
        "workspace_root": project_root,
        "workspace_tree": generate_file_tree(project_root),
        "database_uri": cfg_db_uri,
        "agent_count": len(all_agents),
        "agents": all_agents,
        "connected_agent_count": len(connected_agents),
        "managed_agent_count": len(managed_agents),
    }

async def _dispatch_flow(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    agent_id = args.get("agentId")
    flow_data = args.get("flowData")
    if not agent_id or not flow_data:
        raise HTTPException(status_code=400, detail="Missing agentId or flowData")

    target_sid = None
    for sid, agent in agents.items():
        if agent.get("id") == agent_id:
            target_sid = sid
            break

    if not target_sid:
        raise HTTPException(status_code=404, detail="Agent not found")

    await sio.emit("flow:run", flow_data, to=target_sid)
    return {"success": True, "agentId": agent_id, "message": "Flow dispatched"}
