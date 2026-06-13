# 内置知识工坊 Agent

`server/workshop` 提供每个账号自动上线的虚拟知识工坊 Agent。

当前状态：

- 保留 `EndpointAgentPresence` 在线快照与作坊/世界展示。
- 保留 `WorkshopAiBinding` 1:1 专用绑定。
- 保留 `/api/workshop/bindings` 管理接口。
- `tools.py` 当前为空，不注册知识库、进化或审批写入 MCP。
- `engine.execute_tool` 对未注册工具保持拒绝，等待后续重新接入 MCP。

后续添加工具时，在 `tools.py` 声明 schema，并在 `engine.py` 添加明确的
handler 映射。绑定、权限范围和前端展示链路可直接复用。
