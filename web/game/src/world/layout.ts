/**
 * 世界布局：地图尺寸、固定建筑坐标、锚区矩形、作坊插槽。
 * 全部用世界像素坐标（TILE=32）。P0 用代码生成地图，不依赖 Tiled。
 */

export const TILE = 32
export const MAP_W = 60
export const MAP_H = 40
export const WORLD_W = MAP_W * TILE // 1920
export const WORLD_H = MAP_H * TILE // 1280

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Point {
  x: number
  y: number
}

export interface FixedBuildingDef {
  key: 'spawn' | 'library'
  sheet: string
  label: string
  /** 建筑中心（世界像素） */
  pos: Point
  /** 世界内显示放大倍数（贴图本身已 2x，这里再按建筑体量放大，使其更有"地标感"） */
  scale: number
}

export const FIXED_BUILDINGS: FixedBuildingDef[] = [
  { key: 'spawn', sheet: 'building_spawn.png', label: '出生地', pos: { x: 290, y: 640 }, scale: 1.7 },
  { key: 'library', sheet: 'building_library.png', label: '传承知识库（图书馆）', pos: { x: 880, y: 430 }, scale: 1.55 },
]

/** 动态作坊（机械坊 / 瞭望塔 / 知识工坊）的世界显示放大倍数 */
export const WORKSHOP_SCALE = 1.45

/** 角色锚区（成员在矩形内游荡） */
export const ZONES: Record<string, Rect> = {
  spawn: { x: 150, y: 560, w: 300, h: 230 },
  library: { x: 790, y: 500, w: 210, h: 130 },
  // 图书馆前石板广场：核心管理员踱步区。
  plaza: { x: 790, y: 505, w: 430, h: 150 },
  // 辅助管理员全图漫步（留出边缘与作坊街）
  wanderAll: { x: 120, y: 140, w: WORLD_W - 280, h: WORLD_H - 380 },
}

/** 作坊街：南侧一排插槽 */
export const WORKSHOP_SLOTS = 8
export const WORKSHOP_STREET_Y = 1030

export const workshopSlotPos = (i: number): Point => ({
  x: 280 + i * 200,
  y: WORKSHOP_STREET_Y,
})

/** 作坊附近锚区（绑定该 agent 的成员在门口活动） */
export const workshopZone = (i: number): Rect => {
  const p = workshopSlotPos(i)
  return { x: p.x - 80, y: p.y + 30, w: 160, h: 90 }
}

export const randomPointIn = (zone: Rect, rnd: () => number = Math.random): Point => ({
  x: zone.x + rnd() * zone.w,
  y: zone.y + rnd() * zone.h,
})

export const clampToWorld = (p: Point): Point => ({
  x: Math.min(Math.max(p.x, TILE), WORLD_W - TILE),
  y: Math.min(Math.max(p.y, TILE * 2), WORLD_H - TILE),
})

/** 确定性 PRNG（地图生成 / 成员默认皮肤都用它，保证多端一致） */
export const mulberry32 = (seed: number) => {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
