# game/ — Agent 进化与实战区域（游戏世界）

> 设计方案见 [`doc/Agent进化与实战区域设计方案.md`](../../doc/Agent进化与实战区域设计方案.md)。
> 这是 `web/` 的**第二个 Vite 入口**：同源 iframe 方案，与主控制台共享鉴权、API 封装与 Socket.IO。

## 当前进度（P0 观察者已完成）

- [x] 第二入口接入（`game/index.html`，构建配置见 `web/vite.config.ts` 的 `rollupOptions.input`）
- [x] 像素资产生成器 + 全套基础资产（地形 / 4 固定建筑 / 2 类作坊 / 7 套角色 / 灵魂 / 表情 / 特效）
- [x] 资产清单 `src/assetManifest.ts`（帧布局与动画定义的唯一事实，预览页与 Phaser 共用）
- [x] Phaser 3 世界场景：tilemap 草原 + 4 固定建筑 + 作坊街随 `agent:list` 增减 + 成员锚区游荡
- [x] 数据绑定层 `src/world/store.ts`：复用 `web/src/api/*` + Socket.IO（`ui:join` / `agent:list` / `mcp:status` / `librarian:*`）
- [x] hover tooltip（成员 token 进度条 / 任务 / 模型；建筑统计）+ HUD + 状态气泡（⏳/Zzz/卷轴/⚠）
- [x] 死亡演出：倒地 → 灵魂飞向英灵殿 → 移除；建筑状态动效（图书馆待审批亮灯 / 议事厅翻页 / 作坊开工）
- [x] Dashboard 顶栏入口（地球按钮 → 全屏 iframe 覆盖层，`WorldMapOverlay.vue`）
- [ ] P1：点击设置抽屉 / 拖拽绑定 / 皮肤持久化（WorldActorMeta）/ 派任务动线演出

## 访问

```bash
cd web && npm run dev
# 主控制台  http://localhost:58150/
# 游戏世界  http://localhost:58150/game/        （需先在主控制台登录）
# 资产预览  http://localhost:58150/game/?preview=1
```

世界页是**只读观察者**：数据来自现有 REST 轮询（8s）+ Socket.IO 实时事件；
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
    world/skins.ts  ← 角色→皮肤映射（普通成员按 id 哈希确定性取色）
    ui/overlay.ts   ← DOM 覆盖层：tooltip + HUD
  assets/           ← 生成的 PNG（属于源码，提交进仓库）
    CREDITS.md      ← 资产来源说明
  tools/
    generate_assets.py ← 像素资产生成器（Pillow）
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
