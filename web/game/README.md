# game/ — Agent 进化与实战区域（游戏世界）

> 设计方案见 [`doc/Agent进化与实战区域设计方案.md`](../../doc/Agent进化与实战区域设计方案.md)。
> 这是 `web/` 的**第二个 Vite 入口**：同源 iframe 方案，与主控制台共享鉴权、API 封装与 Socket.IO。

## 当前进度（P0 起步）

- [x] 第二入口接入（`game/index.html`，构建配置见 `web/vite.config.ts` 的 `rollupOptions.input`）
- [x] 像素资产生成器 + 全套基础资产（地形 / 4 固定建筑 / 2 类作坊 / 7 套角色 / 灵魂 / 表情 / 特效）
- [x] 资产清单 `src/assetManifest.ts`（帧布局与动画定义的唯一事实，预览页与未来 Phaser 共用）
- [x] 资产预览页（零依赖 canvas，跑通 生成器 → manifest → 渲染 链路）
- [ ] 引入 Phaser 3：tilemap 草原 + 建筑摆放 + 成员锚区游荡（替换预览页成为正式场景）
- [ ] 数据绑定层：复用 `web/src/api/*` + Socket.IO（`ui:join` / `agent:list` / `mcp:status`）

## 访问

```bash
cd web && npm run dev
# 主控制台  http://localhost:58150/
# 游戏世界  http://localhost:58150/game/
```

生产构建（`npm run build`）后两个入口都在 `web/dist`，由 gateway 静态托管，后端无需改动。

## 目录

```
game/
  index.html        ← 入口（现为资产预览页，后续替换为 Phaser 场景）
  src/
    main.ts         ← 入口脚本
    assetManifest.ts← 资产清单：每张图的帧尺寸 / 帧数 / 动画名 / 瓦片与表情索引
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
