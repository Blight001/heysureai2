# HeySure 设备大厅、发行与连接体系设计

> 状态：V1 可实施基线  
> 更新：2026-08-20  
> 范围：Web 设备大厅、Gateway 发行目录、官方设备登录、更新发现、设备协议边界

## 1. 重新定义“设备”

HeySure 设备不是 AI Agent，也不是模型运行时。设备是某个用户拥有的**受控能力端点**：

1. 用户从自己的 HeySure 服务器下载官方发行包；
2. 设备使用与网页相同的账号登录该服务器；
3. 登录响应提供 JWT 和 `agent_socket_url`，设备据此建立 Socket.IO 长连接；
4. 设备上报稳定 `deviceId`、类型、版本和工具目录；
5. 用户在网页为设备绑定 AI 成员并授予工具范围；
6. 服务端负责编排，设备只执行已授权任务并回报结果。

因此必须把三个概念分开：

| 概念 | 权威方 | 职责 |
| --- | --- | --- |
| 设备发行包 | Gateway 的 Device Hall | 安装、版本、校验、下载 |
| 设备连接 | Connector Runtime | 登录后的 Socket.IO 注册、在线状态、任务/远控数据面 |
| 设备治理 | Gateway + PostgreSQL | 归属、AI 绑定、MCP 权限、审计 |

## 2. 用户旅程

```text
网页首页/控制台 → 设备大厅 → 选择平台 → 从当前服务器下载
                                      ↓
安装并启动 → 自动带出/填写当前服务器 URL → 同账号登录
                                      ↓
POST /api/auth/login → access_token + agent_socket_url
                                      ↓
Socket.IO device:register → 网页作坊出现设备
                                      ↓
绑定 AI + 授权 MCP → 接收 task:dispatch → 返回 task:result
                                      ↓
每次启动/登录后 GET /api/device-hall/updates/... → 提示下载新版本
```

设备大厅同时服务游客和已登录用户。下载目录是公开信息；设备归属、绑定和执行仍必须登录。

## 3. 服务端发行目录

### 3.1 持久化布局

发行物不进入 Git，不写入 PostgreSQL，统一放在 Gateway 的持久化 `/app/data`：

```text
/app/data/device_releases/
├── catalog.json
└── artifacts/
    ├── windows/HeySure-Device-Setup.exe
    ├── linux/heysure-linux-agent.tar.gz
    ├── browser/heysure-browser-mv3.zip
    └── android/HeySure-Device-arm64.apk
```

代码内 `main/static/device_hall/catalog.json` 是未发布时的展示基线。只要持久化目录存在
`catalog.json`，服务端就以它为权威，不会在容器重建时覆盖。

### 3.2 HTTP 合同

| 接口 | 认证 | 用途 |
| --- | --- | --- |
| `GET /api/device-hall/catalog` | 公开 | Web 获取产品、目标平台、版本、安装步骤和可下载状态 |
| `GET /api/device-hall/download/{product}/{target}` | 公开 | 下载目录中已登记且实际存在的文件 |
| `GET /api/device-hall/updates/{product}/{target}?current_version=x` | 公开 | 官方设备检查当前服务器的更新通道 |

服务端绝不接受请求传入文件路径。下载路由只接收受限 ID，再从目录映射到路径；解析后的
文件必须位于 `artifacts/` 下。API 响应会移除内部 `artifact` 路径。

### 3.3 发布流程

1. 在构建机完成设备构建和平台签名；
2. 计算 SHA-256，记录文件字节数；
3. 先上传到 `artifacts/<platform>/` 临时文件名；
4. 校验 SHA-256 后原子改名为最终文件名；
5. 备份旧 `catalog.json`；
6. 更新版本、说明、SHA-256、强制升级标记，最后原子替换 `catalog.json`；
7. 请求 catalog、update 和 download，核对响应与实际散列；
8. 保留上一稳定版，回滚只需恢复目录和 catalog。

`catalog.json` 的 `external_url` 可用于对象存储/CDN；未设置时由 Gateway 直接提供文件。
不存在的文件必须显示“等待服务器发布”，不得返回虚假下载链接。

## 4. 版本与更新策略

- 产品使用稳定 `product_id`，同一平台发行目标使用稳定 `target_id`；文件名可以变化。
- 版本比较使用数字段，发行版本建议严格使用 SemVer。
- 客户端只向**当前登录服务器**检查更新，不能跳到全局未知服务器。
- Windows 客户端启动已有会话、手动登录或自动恢复登录后检查稳定通道。
- V1 自动完成“发现更新 + 展示说明 + 打开当前服务器设备大厅”；设备端不保存固定官网地址，
  `release_page_url` 始终由当前登录服务器生成，用户再从大厅下载；安装仍需用户确认。
- 后续若启用静默安装，必须先完成平台代码签名、下载 SHA-256 校验、失败回滚和防降级。
- `mandatory=true` 仅表达策略；V1 不锁死客户端，避免错误目录导致全部设备不可用。

## 5. 首次连接与配置

发行包不能写死公网域名。设备应按以下优先级确定服务器：

1. 安装/启动参数或深链带入的服务器地址；
2. 本地已保存的最后一次成功服务器；
3. 发行包的可选构建默认值；
4. 开发环境才回退 `http://127.0.0.1:3000`。

设备输入服务器地址后调用 `/api/auth/login`。必须使用响应中的 `agent_socket_url`，不要
自行把 API 端口当成 Socket.IO 端口。Token 失效时，有“记住登录”且用户明确保存凭据的
设备可重新登录；否则回到登录页。日志不得记录密码、Token 或 Cookie。

## 6. Web 设备大厅信息架构

设备大厅同时从首页和登录后控制台进入，采用“产品列表 + 发行详情”结构：

- 产品卡：Windows、Linux Server、Chrome/Edge、Android；
- 详情：用途、能力标签、平台/架构、通道、版本、大小、发行说明；
- 主动作：可用时下载，不可用时明确显示等待发布；
- 安装步骤：最多四到六步，强调“同账号登录”和“回网页绑定 AI”；
- 当前服务器：展示 `window.location.origin`，避免用户把设备连到错误租户；
- 登录态提示：游客先注册/登录，已登录用户提示复用当前账号。

移动端使用单列滚动，桌面端使用左右分栏。大厅是懒加载模态，不增加控制台首屏包体。

## 7. 安全与可靠性边界

1. 目录公开不等于设备公开：设备注册仍必须用用户 JWT。
2. 发布文件必须经过平台签名；SHA-256 只校验完整性，不能替代签名身份。
3. 更新检查失败不影响设备现有连接和任务执行。
4. 发行目录损坏时 catalog 返回 503，不能退回任意目录扫描。
5. 外部 URL 只应指向受控 HTTPS 对象存储；生产不建议 HTTP 下载。
6. 更新不能改变 `deviceId`，否则会丢失既有绑定与权限。
7. 浏览器扩展与 Android 的商店发行可继续使用同一 catalog，只把下载地址改成商店 URL。

## 8. 验收

### 服务端

- 无持久化 catalog 时能返回内置产品目录，所有缺失包均 `available=false`；
- 放入一个登记文件后 catalog 返回大小和下载链接；
- 下载内容、文件名、SHA-256 与发布记录一致；
- `../`、未知产品、未知目标均无法读取文件；
- 旧版本返回 `update_available=true`，同版/新版返回 false。

### Web

- 游客可从首页打开大厅，登录用户可从控制台顶栏打开；
- 加载、失败、空目录、未发布、可下载状态都有明确反馈；
- 下载来自当前页面所属服务器；移动端无横向溢出。

### Windows

- 使用网页同账号登录成功并注册；
- 启动已有会话、手动登录、自动恢复登录都会检查当前服务器稳定通道；
- 有更新时只提示一次并能在系统浏览器打开下载地址；
- 更新服务不可用时只写警告日志，不阻断连接。

## 9. 与现有文档的关系

- 本文：设备产品、发行、下载、登录和更新的总设计；
- `device/read.md`：第三方设备/服务的 Socket.IO 与 MCP 接入协议；
- `device/windows/README.md`、`device/linux/README.md`：各端具体构建和运行；
- `doc/device-capability-registry-refactoring-plan.md`：工具目录 generation/hash 与治理模型。
