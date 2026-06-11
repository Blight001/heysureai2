# Agent 进化与实战区域 · 设计方案

> 把"数字社会"从卡片列表升级为一张**可看、可玩、可操作**的像素小镇地图。
> 本文是落地导向的设计方案：先给结论（iframe 选型 + 渲染引擎），再给实体映射、交互、数据契约、后端增量与分阶段路线图。
> 阅读前置：[`角色与知识流转.md`](角色与知识流转.md)（角色清单与"叙事层 vs 指令层"对照）。

---

## 0. 目标与定位

| 维度 | 说明 |
| --- | --- |
| 本质 | 数字社会的**实时可视化层 + 空间化操作台**，不是独立游戏 |
| 解决什么 | 现有 Dashboard 是"表格/卡片视角"，看不出成员之间的**关系、流动与生命周期**；复杂操作（设备绑定、派任务、传承、知识审批）分散在多个面板，自由度不足 |
| 设计原则 | ① **可视化只读数据，操作必走既有 REST/MCP 链路**（地图是视图，不是第二个真相源）② 叙事层（英灵殿/出生地）只存在于表现层，数据层全部对应现有表与接口 ③ 每一期都独立可用，不阻塞主控制台 |
| 长远定位 | 未来的"数字社会主入口"：项目分区、Agent 对决（进化竞技场）、多人观战、回放，都在这张地图上长出来 |

---

## 1. 架构选型：要不要 iframe？

**结论：要，但用"同源子页面 iframe"，不是外部独立站点。**

### 1.1 方案对比

| 方案 | 优点 | 缺点 |
| --- | --- | --- |
| A. 直接做成 Dashboard 内的一个 Vue 组件 | 无通信成本，复用 store | 游戏引擎（Phaser）bundle 大、requestAnimationFrame 常驻，会拖累主控制台性能；崩溃互相影响；无法独立全屏/独立演进 |
| B. **同源 iframe：同仓库第二个 Vite 入口（推荐）** | 渲染循环/内存隔离，崩了不连累控制台；可独立全屏、独立路由直达（`/world.html`）；**同源** → 直接复用 `localStorage` 里的 auth token 和 `/api`、`/socket.io`，零鉴权改造；同仓库 → 可以 import 复用 `web/src/api/*`、类型、甚至现有弹窗组件 | 跨 iframe 调主控制台功能需要一层 postMessage 桥（协议见 §7.3） |
| C. 完全独立部署的站点 | 彻底解耦 | 鉴权、CORS、版本同步全要重做，现阶段纯增负担 |

选 B 的关键理由：**iframe 的所有代价（通信、鉴权）在"同源 + 同仓库"前提下几乎归零**，而隔离收益（性能、崩溃、独立全屏）全部保留。等未来真要独立演进，再平滑升级到 C。

### 1.2 渲染引擎

**Phaser 3**（MIT，像素游戏事实标准）：

- 内建 Tilemap（支持 Tiled 编辑器导出的 JSON 地图）、精灵动画、Tween、粒子（灵魂出鞘/烟囱冒烟都靠它）、Arcade 物理（碰撞/寻路够用）。
- `pixelArt: true` 一键关闭抗锯齿，像素风无锯齿放大。
- 对比 PixiJS：Pixi 只是渲染器，地图/动画/输入全要自己搭；本场景没必要。

### 1.3 工程形态

```
web/
  index.html          ← 现有控制台入口
  world.html          ← 新增：游戏世界入口（第二个 Vite 入口）
  src/
    world/            ← 新增：游戏世界代码
      main.ts         ← Phaser 启动 + Vue 覆盖层（UI 面板用 Vue 写，挂在 canvas 之上）
      scenes/         ← Phaser 场景（BootScene / WorldScene / UiScene）
      actors/         ← 成员精灵：状态机、移动、动画
      buildings/      ← 建筑精灵：类型、动效、占用状态
      data/           ← 数据绑定层：复用 src/api/*，订阅 socket，输出响应式世界状态
      bridge/         ← postMessage 协议（与父页面通信）
      assets/         ← 像素资产（tileset / spritesheet / 地图 JSON）
```

- `vite.config.ts` 的 `build.rollupOptions.input` 加 `world.html` 即成多页应用；dev 下 `http://localhost:58150/world.html` 直接调试，prod 下随 `web/dist` 一起被 gateway 静态托管，**后端零部署改动**。
- Dashboard 侧新增 `WorldPanel.vue`（或顶栏入口），内嵌 `<iframe src="/world.html">` + "新窗口全屏打开"按钮。
- **UI 双层结构**：Phaser 只管地图/精灵/动效；悬浮提示、设置抽屉、右键菜单用 **Vue 覆盖层**（absolute 定位在 canvas 上），这样可以直接复用现有组件和 `src/api/*`，避免用游戏引擎画表单。

---

## 2. 世界观 → 数据层映射（本方案的"宪法"）

每个画面元素必须能指回一个真实数据源。**地图上不存在没有数据支撑的实体；反之，数据变化必须在地图上有表现。**

| 画面元素 | 数据源 | 已有获取方式 |
| --- | --- | --- |
| 数字成员（小人） | `AssistantAIConfig` 一行（`server/api/models/ai_config.py`） | `listAiCards()`（`web/src/api/ai.ts`）已含 token_used / lifecycle_status / runtime_status / task 快照 / latest_thinking |
| 作坊（动态建筑 ×n） | 已连接的端侧 agent（桌面/浏览器），`EndpointAgentPresence` + 网关内存注册表 | socket `agent:list` 实时推送 + `listConnectedAgents()` |
| 传承知识库（图书馆） | `KnowledgeEntry` + 待审批 proposals | `librarian.ts` 的 `listEntries` / `listProposals`；socket `librarian:proposal_new` / `librarian:proposal_resolved` |
| 英灵殿 | `ValhallaEntry`（`valhalla_service.py`，纯 DB） | `listValhallaEntries()` |
| 出生地 | 无独立表——"未分配/learning 状态成员"的锚区 + 新成员创建入口 | `listAiCards` 过滤 |
| 议事厅（第 4 座固定建筑，见 §3.2） | task system（任务队列/调度） | `task.ts` + ai cards 的 task 快照 |
| 成员在建筑内干活 | `runtime_status === 'running'` + `taskCurrent` | `listAiCards` 轮询 + socket `mcp:status` 实时 |
| 死亡 → 灵魂飞向英灵殿 | `lifecycle_status → dead` / 新增 `world:event member_died`（§8.2） | 轮询比对 or 服务端推送 |
| 传承重生 | `task.inherit` 自动归档 → 下一代注入（`chat_scheduler`），表现为 generation+1 | ValhallaEntry 新增 + ai card generation 变化 |

> 角色判定沿用 `useDashboardData.ts` 现行逻辑：
> **核心管理员**（用户口中的"数字社会管理员"）= `digital_member_role === 'manager'` 或 `switch_key === 'assistant_default'`；
> **辅助管理员** = `ai_role === 'assistant_admin'`；
> **图书管理员** = `is_librarian === true`；其余为普通数字成员。

---

## 3. 地图与建筑

### 3.1 地图

- **草原 tilemap**：32×32 像素瓦片，初版约 60×40 格（1920×1280 世界，视口可拖拽/滚轮缩放，0.5×–2×）。
- 用 **Tiled** 编辑，导出 JSON 进仓库；图层：地表（草地/小路/河流装饰）、建筑层、装饰层（树/石/花，纯氛围）、**锚区层**（不可见的命名区域：`zone:library`、`zone:spawn`、`zone:workshop-slot-1..N`、`zone:wander`，供成员寻路定位）。
- 昼夜/季节色调留到 P2（一层 tint 即可，不影响地图结构）。

### 3.2 四座固定建筑

| 建筑 | 位置（默认） | 数据/操作 | 常驻动效 | 点击面板 |
| --- | --- | --- | --- | --- |
| **出生地**（泉水/育成所） | 地图西侧 | 未分配项目、`learning` 状态、新创建的成员在此锚定 | 泉水波光；有新成员创建时光柱+小人走出 | "创建新成员"入口（复用现有 AI 创建弹窗）+ 待分配成员名单 |
| **传承知识库**（图书馆） | 地图中部 | KnowledgeEntry 列表 + 待审批 proposals | 烟囱常烟；**有 pending proposal 时屋顶亮灯 + 头顶感叹号气泡（数量角标）** | 知识列表（按 scope 标签）+ 审批入口（复用 `ProposalReviewModal.vue` 的逻辑/接口） |
| **英灵殿** | 地图东北山丘（带台阶，体现"飞升"） | ValhallaEntry | 殿内长明火；新条目入殿时金色粒子 | 逝者名册：姓名/代数/遗言摘要/传承链（第 N 代 → N+1 代连线） |
| **议事厅**（任务大厅） | 图书馆旁 | task system：排程任务、运行中任务总览 | 有任务在排程/运行时门口告示牌翻页动画 | 任务总览（复用 `useTaskManagement` 的数据）+ 快速派任务入口 |

> 用户原话列了"传承知识库、英灵殿、出生地"3 座但要求"4 个建筑"。**第 4 座本方案定为"议事厅"**：它给 task system 一个空间实体（派任务=成员走进议事厅领任务再去作坊，动线完整），同时是核心管理员的"工位"，紧邻图书馆——正好满足"数字社会管理员安排到图书馆附近"。此解释需求方确认，不影响其余设计。

### 3.3 作坊（动态建筑 ×n）

- 地图南侧规划一条"作坊街"，预置 8–12 个建筑插槽（锚区 `zone:workshop-slot-i`），按 agent 接入顺序占位；超出后街道向东延伸（坐标公式化生成，无需改地图）。
- **一个在线端侧 agent = 一座作坊**。外观按类型区分：桌面 agent → 铁匠铺/机械坊（齿轮转动）；浏览器扩展 agent → 占卜屋/瞭望塔（屋顶水晶球发光）。
- 状态表现：
  - `lifecycle: registered/connected` → 建筑正常，门口挂"营业"木牌（绿点逻辑同 `WorkshopPanel.vue` 的 `lifecycleClass`）。
  - `dispatching`（执行任务中） → 烟囱冒烟加速、窗户闪光、门口出现工具音效气泡。
  - `degraded` / `lastError` → 屋顶冒黑烟，挂红色警示牌。
  - **离线** → 不立即拆除：建筑变灰、门板钉木条（保留 60s 供观察，之后移除插槽）。掉线瞬间已绑定成员从作坊走回出生地/原锚区。
- 点击面板 = `WorkshopPanel.vue` 信息的空间化：设备信息、当前绑定成员、**分配/解绑下拉**（走现有 `assignAgentAi`，服务端会广播新 `agent:list`，地图自动刷新）、MCP 权限范围编辑（复用 `AgentMcpScopeEditor.vue`）。

---

## 4. 数字成员（Actor）

### 4.1 皮肤系统（新增属性）

- 每个成员一套像素皮肤：**body（体型/服装）+ 调色板 + 配件（帽子/眼镜/披风）**，组合制，资产量小但组合多。
- 角色有默认皮肤族：核心管理员=长袍+王冠饰、辅助管理员=巡逻披风+提灯、图书管理员=眼镜+书、普通成员=工装系随机；用户可在成员设置里改。
- **存储**：不动 `AssistantAIConfig` 主表，新建 `WorldActorMeta` 表（见 §8.1），字段 `skin_json`（`{"body":"villager_03","palette":"teal","accessory":"hat_01"}`）。未配置时由 `ai_config_id` 哈希出确定性的默认皮肤（同一成员每次进图长相一致）。

### 4.2 行为状态机

```
            ┌──────────── idle（原地小动作：眨眼/张望）
            │                │ 随机计时
            ▼                ▼
  walkTo(target) ◄──── wander（锚区内随机走，A* 或直线+避障）
            │
            ├─ 进建筑 → inBuilding（精灵隐入，建筑开动效，门口显示头像角标）
            ├─ working（建筑外作业：举工具/敲键盘 emote）
            ├─ ritual（传承中：lifecycle=reproducing，原地金色法阵）
            └─ collapse → soulFlight（见 §5.1） → 移出地图
```

驱动：**数据快照（轮询 `listAiCards`，沿用 dashboard 现有节奏）决定"该在哪/该干嘛"（目标态），状态机负责把精灵平滑演到目标态**。socket 事件（`mcp:status`、`agent:list`、P2 的 `world:event`）做即时触发。动画过程纯客户端，不回写服务器。

### 4.3 角色锚区规则（用户需求逐条落位）

| 角色/状态 | 锚区行为 |
| --- | --- |
| 核心管理员（数字社会管理员） | 锚定**图书馆+议事厅之间**的小广场，在该范围踱步；派任务动作发生时走进议事厅 |
| 图书管理员 | 锚定图书馆，多数时间在馆内（门口角标常驻）；有新 proposal 时走到门口举牌 |
| 辅助管理员 | **全图漫步**：在各建筑间巡逻路径随机游走，路过异常作坊（degraded）时停留并冒"🔍"气泡——呼应其只读观测的职责 |
| 绑定了端侧 agent 的成员 | 锚定对应作坊附近；`runtime_status=running` 或 agent `dispatching` 时进入作坊（建筑动效开） |
| 有任务但无端侧绑定的成员 | 锚定议事厅附近；执行中进议事厅 |
| 未分配（无项目、无绑定、learning） | 锚定出生地附近游荡 |
| `enabled === false`（停用） | 原锚区坐下打瞌睡（Zzz 气泡），灰度滤镜 |

锚区优先级自上而下取第一条命中；成员状态变化 → 计算新锚区 → `walkTo` 走过去（不瞬移，让"调度"这件事看得见）。

### 4.4 悬浮与点击（信息 → 操作）

- **hover 任何成员**（建筑同理）：0.3s 后浮出像素风 tooltip 卡：
  名字+角色徽章 / 第 N 代 / **token 进度条（tokensUsed/tokenLimit，>80% 变橙 >95% 变红）** / 当前行为（`current_behavior`）/ 当前任务标题与状态 / 模型 / 所属项目 / 端侧绑定（桌面/浏览器图标）。数据全部来自已有 ai card 字段，零新接口。
- **点击成员**：右侧滑出 Vue 设置抽屉（iframe 内渲染，复用 `web/src/api/ai.ts` 的更新接口）：
  - 基本信息编辑、皮肤选择（写 `WorldActorMeta`）；
  - 快捷操作：启停（`toggleAiRun`）、派任务（task.create 表单）、跳到对话（postMessage 让父页面切聊天，见 §7.3）、绑定到某作坊（`assignAgentAi`）。
- **点击建筑**：对应 §3.2/3.3 的面板。
- P1 加**拖拽**：把成员拖到作坊上 = 绑定该设备；拖到出生地 = 解绑/取消项目（确认弹窗后调既有接口）。

---

## 5. 关键事件演出（叙事层动画 × 指令层事实）

### 5.1 死亡与英灵殿（token 耗尽）

```
事实链（已存在）：session tokens 达阈值 → 系统提示传承 → 成员 task.inherit(summary)
                → 后端自动写 ValhallaEntry → chat_scheduler 给下一代注入传承简报 → generation+1
演出链（本方案）：
 ① 触发：lifecycle_status 变 dead，或检测到 ValhallaEntry 新增（P2 后由 world:event 直推）
 ② 成员原地踉跄 → 倒地（collapse 动画，扬起像素尘土）
 ③ 半透明灵魂精灵从尸体升起，沿贝塞尔曲线飘向英灵殿，殿门金光开启吸入，钟声音效
 ④ 尸体淡出；若发生传承（同 config generation+1 或继任者出现）：出生地光柱，
    新一代小人走出，头顶 "第 N+1 代" 横幅 3 秒——形成"死亡→飞升→重生"完整动线
 ⑤ 英灵殿名册角标 +1
```

> 阈值预警也要可视化：tokensUsed/tokenLimit > 90% 的成员头顶常驻 ⏳ 黄色气泡，给用户"该安排传承了"的空间提醒——这是卡片视图很难传达的信息。

### 5.2 派任务

议事厅告示牌翻页 → 目标成员从锚区走向议事厅 → 门口领"任务卷轴"气泡 → 走向作坊（有端侧绑定）或回工位 → 建筑动效启动。任务完成（`task_recent_completed` 更新 / task:result）→ 成员走出，头顶 ✅，作坊烟囱熄火。

### 5.3 知识沉淀

成员冒 💡 → 走向图书馆投递卷轴（`librarian:proposal_new` 触发）→ 图书馆亮灯+角标。用户审批通过（`librarian:proposal_resolved`）→ 图书馆放一圈绿色涟漪，书本飞入；驳回 → 卷轴弹出变灰飘落。

### 5.4 端侧 agent 接入/掉线

新 agent 注册（`agent:list` 增量）→ 空插槽脚手架快速搭起建筑（建造动画 1.5s）；掉线 → §3.3 的钉木条流程。

---

## 6. "复杂操作配合流程"怎么在地图上做（自由度核心）

网页面板的问题是**操作彼此割裂**；地图的价值是把一条业务流变成一条**空间动线**，让组合操作变直观：

| 业务流 | 地图操作动线 | 背后接口（全部已有） |
| --- | --- | --- |
| 新人入职 | 点出生地 → 创建成员 → 小人诞生 → 拖到某作坊（绑定设备）→ 点小人派任务 | AI create → `assignAgentAi` → task.create |
| 设备换人 | 把作坊门口成员 A 拖回出生地，把成员 B 拖到该作坊 | `assignAgentAi(agent, null)` → `assignAgentAi(agent, B)` |
| 传承接力 | ⏳ 预警成员 → 点击抽屉里"启动传承"（向其会话发 inheritance 提示）→ 观看 §5.1 演出 → 新一代自动回到原作坊 | 既有 system_auto_control / task.inherit 链路 |
| 知识治理 | 图书馆亮灯 → 点建筑 → 审批列表逐条 approve/reject | `librarian_routes` 既有审批接口 |
| 健康巡检 | 跟着辅助管理员的巡逻视角走一圈，黑烟作坊一目了然 → 点建筑看 lastError | `agent:list` 数据 |

> 原则重申：**地图不发明新写接口**。所有写操作 1:1 映射到现有 REST/MCP；服务端广播（`agent:list` 等）天然把结果同步回地图和主控制台两边，不存在状态分叉。

---

## 7. 技术方案细节

### 7.1 数据绑定层（`src/world/data/`）

- 复用 `web/src/api/*`（同仓库直接 import）+ 自己的 Socket.IO 连接（同源，`io('/')` + `ui:join`，与 `useDashboardData.ts` 同款握手）。
- 输出一个 `worldStore`（响应式快照）：`members[]`、`workshops[]`、`valhalla[]`、`knowledge{entries,pending}`、`tasks[]`。Phaser 场景 watch 这个 store 做 diff → 驱动各 Actor/建筑状态机。
- 轮询频率与 dashboard 对齐（避免双倍压力）；P2 引入 `world:event` 后轮询可降频，事件做主驱动。

### 7.2 性能预算

- 100 个成员 + 20 座建筑为设计上限：精灵全部走对象池；视口外 Actor 停动画只挪坐标；随机游走用确定性种子（`ai_config_id + 时间片`），保证刷新/多端打开看到的世界基本一致且无需服务器同步位置。
- 资产用单张 spritesheet + texture atlas，首屏资源 < 2MB。

### 7.3 postMessage 桥（iframe ↔ 父页面）

仅用于"需要父页面接管"的动作，协议刻意小：

```ts
// world → parent
{ type: 'world:open-chat',      aiConfigId: number }   // 跳到该成员对话
{ type: 'world:open-dashboard', panel: 'valhalla' | 'knowledge' | ... }
{ type: 'world:ready' }                                 // 加载完成（父页面隐藏 loading）
// parent → world
{ type: 'world:focus-actor',    aiConfigId: number }   // 控制台点成员 → 地图镜头飞过去
{ type: 'world:theme',          dark: boolean }
```

独立全屏打开（无父页面）时，`open-chat` 等降级为新标签页跳转。

### 7.4 后端增量（很小，全部可选/分期）

| 增量 | 位置 | 期 |
| --- | --- | --- |
| `WorldActorMeta` 表：`ai_config_id`(uniq)、`skin_json`、`pinned_pos_json`(预留)、时间戳 | `server/api/models/`（记得补 `migrations.py`） | P1 |
| `gateway/routers/world.py`：`GET/PUT /api/world/actors/{ai_config_id}/meta`；可选 `GET /api/world/snapshot`（聚合一次拉全量，替代首屏 5 个请求） | gateway | P1 |
| `world:event` socket 广播：在既有钩子处各加一行 emit——valhalla 归档（`member_died`/`inherited`）、task 启停（`task_started/finished`）、agent 注册/掉线已被 `agent:list` 覆盖不必加 | `valhalla_service.py` / `chat_scheduler.py` 等钩子点 | P2 |

> 改 `server/api/` 影响全部 4 个进程；emit 必须 best-effort（try/except），不能让演出广播影响业务链路——参考 `socket_events.py` 里 presence 写入的容错写法。

### 7.5 美术资产规范

- 32×32 瓦片 / 成员精灵 32×48（含 4 方向 × 4 帧行走 + idle/坐/倒地/灵魂态）；建筑 2–4 帧循环动效帧。
- 统一调色板（建议 32 色内），保证组合皮肤不花。
- 初版用 CC0 资产打底（Kenney / itch.io CC0 像素包）+ 少量定制（英灵殿、灵魂、四角色配件）；所有资产来源与许可证记录在 `src/world/assets/CREDITS.md`。**产物目录不进 git 的约定不变，但源资产（png/json）属于源码要进仓库。**

---

## 8. 分阶段路线图

| 期 | 内容 | 验收标准 |
| --- | --- | --- |
| **P0 观察者**（MVP） | world.html 入口 + tilemap 草原 + 4 固定建筑 + 作坊随 `agent:list` 增减 + 成员按 §4.3 锚区站位/游荡 + hover tooltip + token 预警气泡。只读。 | 打开 `/world.html` 能实时反映当前数字社会全貌；dashboard 加 iframe 入口 |
| **P1 操作台** | 点击设置抽屉（成员/建筑面板全套）+ 拖拽绑定 + 皮肤系统（`WorldActorMeta` + 选择器）+ 死亡/传承/派任务/知识沉淀四大演出（轮询触发版） | §6 表格里 5 条业务流全部可在地图内闭环完成 |
| **P2 实时化与氛围** | `world:event` 服务端直推（演出零延迟）+ `/api/world/snapshot` 聚合 + 昼夜色调 + 音效 + 性能达标（100 成员 60fps） | 拔掉轮询提频也不漏演出 |
| **P3 进化与实战**（长远） | ① **项目分区**：每个 project 一片围栏领地，成员住进各自项目区，跨项目协作 = 小人串门（`message.send_to_ai` 可视化为信使奔跑）② **进化竞技场实体化**：地图加"竞技场"建筑，`evolution.input/list/review` 的评审流可视化为成员对决/展示 ③ 多人观战（同 user 多端已天然同步；跨 user 只读分享链接）④ **时间轴回放**：基于 `world:event` 落库重放一天的社会活动 ⑤ 桌面 agent 侧小窗（Electron 里嵌同一 world.html 的精简视口） | 按需立项，每项独立成 PR |

---

## 9. 风险与开放问题

1. **第 4 座建筑**：本方案取"议事厅"，需求方确认（备选：把"进化竞技场"提前到 P0 当第 4 座，但其玩法在 P3 才有内容，会先空置）。
2. **位置无服务器同步**：确定性种子保证多端"基本一致"而非帧级一致；若未来要严格一致（观战/回放），P3 引入服务端 tick 或事件回放即可，不影响现有设计。
3. **资产工作量**是 P1 最大不确定项；用"组合皮肤"压资产量，先 CC0 打底。
4. **lifecycle_status 的 `dead` 触发时机**依赖现有后端逻辑；若实践中发现死亡主要表现为 ValhallaEntry 新增而非状态翻转，演出触发器以 ValhallaEntry 为准（P0 用轮询比对，成本相同）。
5. **iframe 内存**：长驻 dashboard 的 iframe 在不可见时应 `scene.pause()`（监听 visibility / IntersectionObserver），避免后台烧 CPU。

---

## 10. 改动落点速查（实施时对照）

| 改什么 | 位置 |
| --- | --- |
| 游戏入口/场景/精灵 | `web/world.html` + `web/src/world/**`（新增） |
| 多页构建 | `web/vite.config.ts`（rollupOptions.input 加 world.html） |
| Dashboard 嵌入口 | `web/src/components/dashboard/`（新增 WorldPanel.vue / 顶栏按钮） |
| 皮肤元数据表 | `server/api/models/`（新增 world_meta）+ `api/core/migrations.py` |
| world REST | `server/gateway/routers/world.py`（新增） |
| world:event 广播钩子 | `server/api/services/valhalla_service.py`、`server/api/chat_runtime/chat_scheduler.py`（P2，各一行 emit + 容错） |
| 复用的数据接口 | `web/src/api/{ai,agents,valhalla,librarian,task}.ts`（不改，只 import） |
| 复用的操作链路 | `assignAgentAi` / `toggleAiRun` / task.create / librarian 审批（不改） |
