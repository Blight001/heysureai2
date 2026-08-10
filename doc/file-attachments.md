# AI 工作区文件与用户附件

## 能力边界

- 文件存储按当前 `user_id + ai_config_id` 的 AI 工作区隔离；数字成员管理者继续沿用既有的用户根工作区权限。
- 对模型只暴露 `file_ref`、相对工作区路径、文件名、MIME 和大小，不暴露服务器绝对路径。
- 单文件发送上限 30 MB，一次消息最多 5 个附件。
- QQ 与飞书支持图片、视频、音频和普通文件；旧的 `media_url`、`media_path`、`image_*`、`video_*` 参数继续兼容。
- `unregister` 只删除引用元数据，不删除原文件。

## MCP 使用流程

注册已有工作区文件：

```json
{
  "tool": "workspace.file+manage",
  "arguments": {
    "action": "register",
    "workspace_path": "reports/result.pdf"
  }
}
```

保存对话里的图片时，从 `/api/chat/media/{media_id}/{token}` 取出两个参数：

```json
{
  "tool": "workspace.file+manage",
  "arguments": {
    "action": "import_chat_media",
    "media_id": 123,
    "media_token": "..."
  }
}
```

发送一个或多个文件：

```json
{
  "tool": "message.send+to",
  "arguments": {
    "to": "user",
    "text": "任务结果见附件",
    "attachments": [
      {"file_ref": "file_..."}
    ]
  }
}
```

AI-FREE 的 `aifree.browser+screenshot` 默认保存到当前成员的 `Screenshots/` 并返回 `file_ref`，同时按当前机器人绑定发送给用户。传 `send_to_user=false` 只关闭发送，仍会保存；传 `save_to_workspace=false` 才关闭持久化。

## 安全与失败语义

- 注册接口拒绝绝对路径、`..` 越界和软链接逃逸。
- `file_ref` 的元数据包含用户与成员作用域，跨成员引用会失败。
- 常见结构化错误码：`FILE_NOT_FOUND`、`FILE_TOO_LARGE`、`FILE_SCOPE_VIOLATION`、`ABSOLUTE_PATH_REJECTED`、`INVALID_FILE_REF`。
- 多附件顺序发送；若中途失败，返回 `delivered=false`、`partial=true`、`sent_count`，避免把部分成功误报为全部成功或盲目重发已送达附件。
