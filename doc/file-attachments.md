# AI 工作区文件与用户附件

## 能力边界

- 文件存储按当前 `user_id + ai_config_id` 的 AI 工作区隔离；数字成员管理者继续沿用既有的用户根工作区权限。
- 对模型只暴露 `file_ref`、相对工作区路径、文件名、MIME 和大小，不暴露服务器绝对路径。
- 单文件发送上限 30 MB，一次消息最多 5 个附件。
- QQ 与飞书支持图片、视频、音频和普通文件；旧的 `media_url`、`media_path`、`image_*`、`video_*` 参数继续兼容。
- `unregister` 只删除引用元数据，不删除原文件。

## Web 对话上传

- 输入框支持本机文件选择、拖放和从剪贴板粘贴图片/文件；上传完成前不会允许发送。
- 上传内容立即保存到目标 AI 工作区的 `Uploads/`，即使用户随后从输入框移除附件，也只移除待发送引用，不删除已保存文件。
- 消息正文只保存展示文字；`chatmessageattachment` 表保存消息与 `file_ref` 的关系、文件名、MIME、大小和不可猜测的下载令牌，文件本体不进入 PostgreSQL。
- 历史消息通过 `/api/chat/attachments/{id}/{token}` 展示图片或下载普通文件；令牌错误、引用失效或工作区作用域不匹配统一返回 404/拒绝访问。
- PNG、JPEG、WebP、GIF 且不超过 10 MB 的图片会作为本轮多模态输入提供给模型。其他图片和普通文件只提供工作区相对路径与 `file_ref`，由 AI 使用工作区工具读取。
- 如果上游模型拒绝图片输入，推理循环会移除图片块、加入“当前模型无法看图”的约束并自动重试，不把底层供应商错误直接抛给用户，也不允许 AI 假装看过图片。
- 正在运行的任务也能接收附件：附件作为待注入用户消息保存，在下一个模型步骤边界以相同的路径说明和多模态规则注入。

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
