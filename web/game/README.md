# game/ — Agent 进化与实战区域（游戏世界）

> 设计方案见 [`doc/Agent进化与实战区域设计方案.md`](../../doc/Agent进化与实战区域设计方案.md)。
> 这是 `web/` 的**第二个 Vite 入口**：同源 iframe 方案，与主控制台共享鉴权、API 封装与 Socket.IO。

## 当前进度（P0 观察者 + P1 操作台 + P2 实时化 + P3 信使已完成）

- [x] 第二入口接入（`game/index.html`，构建配置见 `web/vite.config.ts` 的 `rollupOptions.input`）
- [x] 像素资产生成器 + 全套基础资产（地形 / 3 固定建筑 / 2 类作坊 / 7 套角色 / 灵魂 / 表情 / 特效）
- [x] 资产清单 `src/assetManifest.ts`（帧布局与动画定义的唯一事实，预览页与 Phaser 共用）
- [x] Phaser 3 世界场景：tilemap 草原 + 3 固定建筑 + 作坊街随 `agent:list` 增减 + 成员锚区游荡
- [x] 数据绑定层 `src/world/store.ts`：复用 `web/src/api/*` + Socket.IO（`ui:join` / `agent:list` / `mcp:status` / `librarian:*`）
- [x] hover tooltip（成员 token 进度条 / 任务 / 模型；建筑统计）+ HUD + 状态气泡（⏳/Zzz/卷轴/⚠）
- [x] 死亡演出：倒地 → 灵魂飞向英灵殿 → 移除；建筑状态动效（图书馆待审批亮灯 / 作坊开工）
- [x] Dashboard 集成：游戏世界**直接内嵌主控制台中间实战区域**（`WorldArenaPanel.vue`，
      原进化场"项目安排 + 运行中 AI 卡片"按需求移除，顶栏独立打开按钮一并移除，2026-06-11）
- [x] 成员单击直接隔空对话；操作抽屉保留作坊、图书馆、英灵殿与出生地管理功能
- [x] P1 拖拽：拖成员到作坊 = 绑定（确认后走 `assignAgentAi`），拖到出生地 = 解绑
- [x] P1 皮肤持久化：`WorldActorMeta` 表（Alembic 迁移）+ `/api/world/actors/*/meta` + 抽屉换肤
- [x] P1 演出（轮询触发版）：任务卷轴提示 / 知识沉淀图书管理员迎卷轴 / 传承重生火花
- [x] postMessage 桥：抽屉"打开对话" → 父页面关闭覆盖层并打开该成员聊天弹窗
- [x] P2 `world:event` 服务端直推：valhalla 入殿（传承/功成）、任务启动/完成四类事件
      经 socket 直达世界页，演出零延迟（钩子在 `valhalla_service` / `chat_scheduler` / `tasks.py`，
      共享发射器 `api/services/world_events.py`，全部 best-effort）
- [x] P2 `/api/world/snapshot` 聚合接口：首屏 1 个请求替代 6 个；旧后端自动分域回退
- [x] P2 昼夜色调（按本地时间，`?hour=N` 可调试）+ 8-bit 音效（`tools/generate_sfx.py`
      生成 5 个 WAV；左下角静音开关，localStorage 持久化）
- [x] P2 性能：离屏成员不跑动画、depth 仅在位移时更新；100 成员冒烟通过
- [x] P3 信使：`message.send_to_ai` 可视化——信封从发信成员弧线飞向收信成员
      （飞行中追踪移动目标），发信人举卷轴、送达时收信人 ❗（回信 ✅）+ 火花 + 音效；
      钩子在 `communication.py`（新信件与回信两条成功路径均直推 `ai_message` 事件）
- [x] 开场云层加载演出：等待首批数据时云朵铺满视口缓慢漂浮（远景视角），
      数据就绪后镜头由远拉近、云朵向两侧飘散渐隐（兜底 10s 自动揭幕）
- [x] 布局与氛围升级：2 格窄路 / 图书馆石板广场 / 英灵殿暗草山丘 /
      作坊街地块 / 出生地花圃+栅栏+路牌+长椅；新增装饰素材（灯柱/栅栏/长椅/
      路牌/蝴蝶）；持续动画——池塘水面波动、开工作坊烟囱炊烟、
      蝴蝶花间飞舞（tint 四色）、夜晚灯柱自动点亮
- [x] 昼夜系统重做（乘法混合调色）：正午通透 → 黄昏整图暖橙 → 深夜蓝黑；
      夜间光晕系统（灯柱暖光 / 图书馆窗火 / 英灵殿火光 / 泉水冷光，ADD 混合呼吸微闪）；
      萤火虫夜间出没游移闪烁、蝴蝶仅白天活动——三时段画面截然不同
- [x] 世界时间以**北京时间（UTC+8）**为准（不随浏览器时区漂移），HUD 实时显示
      "🕐 北京时间 HH:MM + 时段"；滚轮缩放下限改为动态"恰好铺满视口"，
      视野永远不会超出地图（容器尺寸变化自动校正）；修复 ?hour 缺省时被
      误判为调试 0 点导致昼夜错乱的 bug
- [x] 成员外观自定义（2026-06-12）：点击成员 → 抽屉"外观自定义"面板——皮肤（4 色）、
      调色（预设色板 + 自定义取色器，乘法 tint）、体型（0.7-1.4 缩放滑杆，脚底贴地）、
      光环（脚下 ADD 混合呼吸发光，预设 + 自定义色）；改动即在地图实时预览，
      "保存外观"落库（`WorldActorMeta.skin_json` 扩展为多键 JSON，部分更新合并语义，
      旧数据/旧客户端兼容，无需迁移）
- [x] 图书馆重绘为古典欧风石造馆（2026-06-12）：青石板陡顶 + 金饰尖、石砌错缝墙、
      玫瑰窗、罗马拱窗与拱门双开木门；去掉烟囱与常烟演出（帧 1 待审批
      亮灯改为玫瑰窗 + 拱窗点亮）
- [x] 游戏化交互（2026-06-13）：信息面板由右侧抽屉改为**底部面板**——
      左上角显示被点对象的"上半身"头像（角色/建筑，`ui/portrait.ts` 从 spritesheet
      裁剪上 ~64% 放大成像素头像），内容按**标签页（栏目）**组织，底部高度有限时
      用户切栏查看、列表类栏目多列铺满横向空间，不再被截断
- [x] 总督操控（2026-06-13）：把世界里已有的**核心管理员**（无 token 上限 / 无任务）
      当作玩家化身——左下角"🎮 操控总督"开关（或按 G）进入跟随视角，相机锁定该角色，
      **WSAD** 移动、走到其它 AI 成员附近（≤96px）头顶提示"按 F 交互"、按 **F** 在底部
      面板打开该成员信息；受控期间隐藏血条、暂停自治游荡（释放后回锚区）。
      不再额外生成化身，避免出现"两个总督"；无 token 上限的角色统一不画血条
      （`MemberActor.setControlled` / `refreshTokenBar`）
- [ ] P3 其余项按需：项目分区领地（竞技场 / 时间轴回放 / 多人观战已确认不做，2026-06-11）

## 访问

```bash
cd web && npm install && npm run dev   # 拉取后先 npm install（游戏世界依赖 phaser，lock 文件不入库）
# 主控制台  http://localhost:58150/
# 游戏世界  http://localhost:58150/game/        （需先在主控制台登录）
# 资产预览  http://localhost:58150/game/?preview=1
# 调试夜晚  http://localhost:58150/game/?hour=22
```

数据来自现有 REST 轮询（8s）+ Socket.IO 实时事件；**所有写操作 1:1 走现有接口**
（启停=toggle-run、绑定=agents/bind、审批=librarian、派任务=task-trigger），
外观（皮肤/调色/体型/光环）走 `/api/world/actors/*/meta`（表 `worldactormeta`，纯表现层）。
锚区规则（谁站在哪）见设计方案 §4.3，实现在 `scenes/WorldScene.ts` 的 `anchorFor`。

生产构建（`npm run build`）后两个入口都在 `web/dist`，由 gateway 静态托管，后端无需改动。

## 目录

```
game/
  index.html        ← 入口页（世界 / ?preview=1 资产预览）
  src/
    main.ts         ← 启动：默认 Phaser 世界，?preview=1 进资产预览
    preview.ts      ← 资产预览页（调试工具，零依赖 canvas）
    assetManifest.ts← 资产清单：每张图的帧尺寸 / 帧数 / 动画名 / 瓦片与表情索引
    scenes/WorldScene.ts ← 世界场景：地图生成 / 建筑 / 成员调度 / 相机 / 悬浮
    actors/MemberActor.ts← 成员精灵：行走状态机 / 表情气泡 / 死亡演出
    world/store.ts  ← 数据绑定层（REST 轮询 + Socket.IO → WorldSnapshot，只读）
    world/layout.ts ← 地图尺寸 / 建筑坐标 / 锚区矩形 / 作坊插槽
    world/skins.ts  ← 角色→皮肤映射（普通成员按 id 哈希确定性取色，可被 WorldActorMeta 覆盖）
    ui/overlay.ts   ← DOM 覆盖层：tooltip + HUD
    ui/drawer.ts    ← 右侧操作抽屉：成员/建筑面板 + 全部写操作入口
  assets/           ← 生成的 PNG（属于源码，提交进仓库）
    CREDITS.md      ← 资产来源说明
  tools/
    generate_assets.py ← 像素资产生成器（Pillow）
    generate_sfx.py    ← 8-bit 音效生成器（标准库 wave，输出 assets/sfx/*.wav）
```

## 重新生成资产

```bash
pip install Pillow
python3 game/tools/generate_assets.py
```

生成器是**确定性**的（固定随机种子），重跑产物一致；改外观请改生成器代码而不是手改 PNG。
新增 sheet / 改帧布局时，**同步更新 `src/assetManifest.ts`**。

## 资产规范

- 1x 内部分辨率手绘，NEAREST 放大 2 倍输出；瓦片标准 32px，角色 32x48。
- 角色 sheet：4 列 x 5 行 —— 行 0-3 = 走路 下/左/右/上（第 0 帧兼站立），行 4 = 闭眼 idle / 坐 / 跪倒 / 躺倒。
- 统一描边色 `(34,32,52)`；调色板集中在生成器顶部，新颜色先进调色板。
