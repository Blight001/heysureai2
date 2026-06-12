# 知识与进化工坊（Workshop Agent）

独立的端侧"作坊"进程：把 **知识库（librarian.\*）** 与 **系统进化
（evolution.\*）** 两个 MCP 工具域从服务端内置工具中拆出来，由本进程注册并
提供。**只改这个文件夹，就能控制整个数字社会的知识与进化方向**，服务端无
需改动、无需重启。

## 架构

```
AI 调用 librarian.consult
   │ （前提：该 AI 已在前端绑定本工坊）
   ▼
服务器按"AI ↔ 工坊绑定"把 task:dispatch 发到本进程
   │
   ├─ policy.before_execute()  ← 入参方向钩子
   ├─ 回调 gateway /api/workshop/execute（数据真相源在服务端，
   │   服务端复核：归属 / 工具白名单 / 角色权限 / 绑定关系）
   └─ policy.after_execute()   ← 结果方向钩子（默认附带 direction.md）
   ▼
结果返回给 AI
```

## 文件即控制面

| 文件 | 改它能控制什么 |
| --- | --- |
| `direction.md` | 知识沉淀与进化建议的方向指引；随工具结果实时注入给 AI，保存即生效 |
| `policy.py` | 入参/结果钩子：强制补全字段、过滤检索结果、拒绝偏离方向的建议等 |
| `tools.py` | 工具描述（AI 看到的用法说明）与入参 schema |

## 运行

```bash
pip install -r requirements.txt
cp .env.example .env     # 填 SERVER_URL 与 HEYSURE_TOKEN（网页登录 token）
python workshop_agent.py # 或 ./run.sh / run.bat
```

## 绑定（必须）

工坊上线后，在网页控制台打开某个 AI 的配置弹窗 →「知识工坊」区域勾选绑定。
**未绑定的 AI 看不到也调不了 librarian/evolution 工具**——绑定是唯一门槛，
一个工坊可同时服务多个 AI。

## 安全边界

- 工坊持用户 token 连接，与桌面 agent 同级；服务端不信任工坊的任何声明，
  每次执行都会复核 AI 归属、工具白名单、角色最低权限与绑定关系。
- 服务端只接受 `librarian.` / `evolution.` 命名空间的工具上报，工坊通道
  无法注册桌面执行类工具。
- 知识/进化数据的真相源（数据库 + KnowledgeBase 文件）始终在服务端，
  工坊离线只影响可用性，不会丢数据。
