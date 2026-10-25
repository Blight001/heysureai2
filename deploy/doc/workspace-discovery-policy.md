# 工作区调查可见性策略

对话调查不再默认把整个工作区当作“项目源码目录”。工作区同时保存上传文件、缓存、构建产物、日志和运行时状态，未经筛选的 `dir /s /b` 会制造噪声并把无关路径带入上下文。

## 默认行为

- `workspace.list+files` 是 AI 调查文件的首选入口。
- 默认隐藏：`.git`、`.heysure`、虚拟环境、`node_modules`、缓存、`dist/build`、日志、临时目录、数据库和隐藏配置文件。
- 返回有递归深度和条目数上限，并支持 `path`、`query` 缩小范围。
- `/api/chat/files` 与 `/api/chat/tree` 使用同一策略，避免文件选择器和对话工具看到两套结果。
- 图片不会因列目录自动进入模型；必须显式调用 `workspace.file+manage(action=view_image)`。

## 明确查看生成物

仅当用户明确要求时，调用 `workspace.list+files` 设置 `include_generated=true`；查看隐藏文件再设置 `include_hidden=true`。仍应优先传入具体 `path` 或 `query`，不要恢复全盘递归列举。

## 读取与执行

列表只负责发现路径。发现目标后，再用 `console.execute(target=workspace)` 或兼容的 `workspace.run+command` 读取明确文件；端侧路径使用对应设备 MCP，宝塔主机路径使用 Baota MCP，不能混用工作区路径。
