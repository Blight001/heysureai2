/**
 * 游戏世界资产清单 —— 生成器（tools/generate_assets.py）输出的唯一事实描述。
 *
 * 预览页（main.ts）按它渲染动画；后续 Phaser 场景按它注册 spritesheet 与 anims，
 * 两边共用，改资产时只改生成器 + 本文件。
 */

export interface SheetAnim {
  /** 帧索引（相对本 sheet，行优先） */
  frames: number[]
  fps: number
  repeat: boolean
}

export interface SheetDef {
  file: string
  label: string
  kind: 'tileset' | 'building' | 'character' | 'effect' | 'ui'
  frameWidth: number
  frameHeight: number
  /** 列数（strip 为帧数；角色图为 4） */
  columns: number
  rows: number
  anims: Record<string, SheetAnim>
}

/** 角色 sheet 帧布局：4 列 x 5 行（行 0-3 走路 下/左/右/上，行 4 姿态） */
const characterAnims: Record<string, SheetAnim> = {
  walk_down: { frames: [0, 1, 2, 3], fps: 6, repeat: true },
  walk_left: { frames: [4, 5, 6, 7], fps: 6, repeat: true },
  walk_right: { frames: [8, 9, 10, 11], fps: 6, repeat: true },
  walk_up: { frames: [12, 13, 14, 15], fps: 6, repeat: true },
  stand: { frames: [0], fps: 1, repeat: false },
  idle_blink: { frames: [0, 16], fps: 2, repeat: true },
  sit: { frames: [17], fps: 1, repeat: false },
  collapse: { frames: [18], fps: 1, repeat: false },
  lying: { frames: [19], fps: 1, repeat: false },
}

const character = (file: string, label: string): SheetDef => ({
  file,
  label,
  kind: 'character',
  frameWidth: 32,
  frameHeight: 48,
  columns: 4,
  rows: 5,
  anims: characterAnims,
})

const strip = (
  file: string,
  label: string,
  kind: SheetDef['kind'],
  frameWidth: number,
  frameHeight: number,
  frames: number,
  fps = 4,
): SheetDef => ({
  file,
  label,
  kind,
  frameWidth,
  frameHeight,
  columns: frames,
  rows: 1,
  anims: frames > 1
    ? { loop: { frames: Array.from({ length: frames }, (_, i) => i), fps, repeat: true } }
    : { still: { frames: [0], fps: 1, repeat: false } },
})

export const SHEETS: SheetDef[] = [
  // ---- 地形 ----
  {
    file: 'tileset.png',
    label: '地形瓦片（草原 / 路 / 水 / 点缀）',
    kind: 'tileset',
    frameWidth: 32,
    frameHeight: 32,
    columns: 8,
    rows: 2,
    anims: { water: { frames: [9, 10], fps: 2, repeat: true } },
  },
  strip('tree.png', '树', 'tileset', 32, 48, 1),

  // ---- 固定建筑 ----
  strip('building_spawn.png', '出生地（泉水）', 'building', 64, 64, 4),
  strip('building_library.png', '传承知识库（图书馆）· 帧1=待审批亮灯', 'building', 96, 96, 2, 2),
  strip('building_valhalla.png', '英灵殿 · 长明火', 'building', 96, 112, 4),
  strip('building_hall.png', '议事厅 · 告示牌翻页', 'building', 80, 80, 2, 2),

  // ---- 动态作坊 ----
  strip('building_workshop_desktop.png', '作坊·机械坊（桌面 agent）', 'building', 64, 64, 4),
  strip('building_workshop_browser.png', '作坊·瞭望塔（浏览器 agent）', 'building', 64, 80, 4),

  // ---- 角色 ----
  character('char_admin.png', '核心管理员（紫袍金冠）'),
  character('char_assistant.png', '辅助管理员（青衣提灯）'),
  character('char_librarian.png', '图书管理员（眼镜持书）'),
  character('char_member_blue.png', '数字成员 · 蓝'),
  character('char_member_red.png', '数字成员 · 红'),
  character('char_member_amber.png', '数字成员 · 黄'),
  character('char_member_slate.png', '数字成员 · 灰'),

  // ---- 灵魂 / 特效 / UI ----
  strip('soul.png', '灵魂（飞向英灵殿）', 'effect', 24, 24, 4, 5),
  strip('envelope.png', '信封（AI 互发消息的信使）', 'effect', 24, 18, 1),
  {
    file: 'emotes.png',
    label: '表情气泡（沙漏/灯泡/对勾/感叹/放大镜/Zzz/卷轴/骷髅）',
    kind: 'ui',
    frameWidth: 16,
    frameHeight: 16,
    columns: 8,
    rows: 1,
    anims: {},
  },
  strip('effect_smoke.png', '烟雾', 'effect', 16, 16, 4, 5),
  strip('effect_sparkle.png', '火花', 'effect', 16, 16, 4, 8),
]

/** 普通成员可选皮肤（值 = spritesheet 注册 key，即文件名） */
export const MEMBER_SKINS = [
  'char_member_blue.png',
  'char_member_red.png',
  'char_member_amber.png',
  'char_member_slate.png',
] as const

/** 角色 → 专属皮肤映射（与 useDashboardData 的角色判定字段对应） */
export const ROLE_SKINS = {
  coreAdmin: 'char_admin.png', // digital_member_role === 'manager' || switch_key === 'assistant_default'
  assistantAdmin: 'char_assistant.png', // ai_role === 'assistant_admin'
  librarian: 'char_librarian.png', // is_librarian === true
} as const

/** tileset 瓦片索引 */
export const TILES = {
  grassA: 0,
  grassB: 1,
  grassC: 2,
  grassDark: 3,
  flowerRed: 4,
  flowerYellow: 5,
  tallGrass: 6,
  path: 7,
  pathEdge: 8,
  waterA: 9,
  waterB: 10,
  stone: 11,
  bush: 12,
} as const

/** emotes.png 图标索引 */
export const EMOTES = {
  hourglass: 0, // token 接近上限预警
  bulb: 1, // 知识沉淀
  check: 2, // 任务完成
  alert: 3, // 异常
  magnifier: 4, // 辅助管理员巡查
  zzz: 5, // 停用打盹
  scroll: 6, // 领任务
  skull: 7, // 死亡标记
} as const
