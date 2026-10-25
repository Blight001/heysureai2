# HeySure Member Transfer Protocol v1

## 目标

`workspace.transfer` 是服务器 AI、端侧 MCP 和控制台之间唯一的媒体/文件传输入口。MCP 只交换小型 JSON 引用，文件字节通过一次性 capability URL 流式传输，因此图片、视频和压缩包不会被编码成 base64，也不会进入对话上下文。

协议不暴露服务器绝对路径，不依赖共享挂载，不要求 AI 知道素材库的本地目录。所有端侧成员应使用这套流程；旧的路径、URL 直传和 base64 方式不属于协议。

## Envelope

```json
{
  "protocol": "heysure.member-transfer",
  "version": 1,
  "transfer_id": "xfer_<32 lowercase hex>",
  "direction": "server_to_device | device_to_server",
  "state": "ready | prepared | uploaded | committed | aborted",
  "object": {
    "ref": "file_<32 lowercase hex>",
    "name": "image.png",
    "mime": "image/png",
    "bytes": 1234,
    "sha256": "..."
  },
  "transport": {
    "method": "GET | PUT",
    "url": "https://.../api/transfers/xfer_.../<opaque-token>",
    "headers": {"Content-Type": "image/png"}
  },
  "expires_at": 0
}
```

`transport` 只在 `prepare_*` 返回时包含 token URL；`status`、`commit` 和 `abort` 不回显 capability。服务端默认有效期 5 分钟，允许范围 60–900 秒，单对象上限 250 MiB。

## 生命周期

### 服务器 → 端侧

1. AI 调用 `workspace.transfer(action="prepare_download", file_ref="file_...")`。若只有工作区相对路径，可传 `workspace_path`，服务端会先登记为 `file_ref`。
2. 端侧 MCP 或 `console.execute(target="device")` 对返回的 `transport.url` 发起流式 `GET`，直接保存到端侧导入目录。
3. 端侧将同一 `object`（尤其是 `sha256`）传给素材库的导入 MCP。端侧不得把服务器路径或 base64 放回对话。

### 端侧 → 服务器

1. AI 调用 `workspace.transfer(action="prepare_upload", file_name, mime_type, folder)`。
2. 端侧/控制台使用返回 URL 发起一次原始字节 `PUT`：

   ```bash
   curl --fail --retry 2 --upload-file ./image.png \
     'https://host/api/transfers/xfer_.../<opaque-token>'
   ```

3. 收到 `uploaded` 后，AI 调用 `workspace.transfer(action="commit", transfer_id, bytes, sha256)`。服务端校验大小和 SHA-256，将对象登记到成员工作区并返回 `file_ref`。
4. 失败或取消时调用 `status` 或 `abort`。过期、校验失败和重复提交均返回结构化错误，不会恢复已终态传输。

## MCP 调用约定

只有 `workspace.transfer` 负责跨成员传输；`workspace.file+manage` 仅用于查看、登记和管理服务器工作区文件，`message.send+to` 只接收已经登记的 `file_ref`。调用方不得传递绝对路径、端侧路径、公网素材 URL 或 base64。

## 安全与效率

- token 只存 SHA-256，明文只出现在一次 `prepare_*` 响应和 URL 中；过期状态和上传临时文件会清理。
- 下载使用 `FileResponse`，上传使用 `Request.stream()`，服务器不会把大文件读入内存。
- `transfer_id`、用户、AI 成员和过期时间绑定；源文件在下载前重新校验大小与 SHA-256。
- `commit` 是幂等边界：只有 `uploaded` 可提交，`committed`、`aborted` 和过期传输不能恢复。
- 协议不新增数据库表，短生命周期状态使用原子替换写入 `data/member_transfers/`。

## Infinite Canvas 端侧

端侧 `canvas_generation_import` 将 `transport.url` 映射为 `reference.url`，并保留 `object.name/mime`。当前受限工作区附带可直接应用的端侧描述补丁：

```text
_release/infinite-canvas-member-transfer.patch
```

它与 `_release/infinite-canvas-remote-import-v2.patch` 配套：后者实现 capability URL 的安全远程拉取、重定向限制、大小限制和媒体校验；前者把端侧 MCP 描述切换到本协议。应用后应在 device 子仓库运行现有资产操作测试，再重启端侧服务使 `tools/list` 刷新。
