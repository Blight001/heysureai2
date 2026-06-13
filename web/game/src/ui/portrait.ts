/**
 * 头像（上半身）渲染：把角色 / 建筑 spritesheet 的某一帧裁出上半身，
 * 放大画进一个像素风 canvas，供底部信息面板左上角显示。
 *
 * 像素资产很小（角色 32x48 / 建筑 64~96），直接用 canvas drawImage 裁剪 + 整数放大，
 * 关闭平滑保持像素颗粒。图片按 URL 缓存，避免重复解码。
 */
import { SHEETS } from '../assetManifest'

export interface PortraitSpec {
  /** spritesheet 图片 URL */
  url: string
  /** 源裁剪区域（像素） */
  sx: number
  sy: number
  sw: number
  sh: number
}

const imageCache = new Map<string, HTMLImageElement>()

const loadImage = (url: string): HTMLImageElement => {
  const cached = imageCache.get(url)
  if (cached) return cached
  const img = new Image()
  img.src = url
  imageCache.set(url, img)
  return img
}

/**
 * 由 sheet 文件名 + 帧号算出"上半身"裁剪区域。
 * - character：取上 ~64%（头 + 胸腹），略去腿脚。
 * - building：取上 ~62%（屋顶 + 上层立面）。
 */
export const portraitSpecFor = (
  resolveUrl: (file: string) => string,
  sheetFile: string,
  frame: number,
  kind: 'character' | 'building',
): PortraitSpec => {
  const def = SHEETS.find(s => s.file === sheetFile)
  const fw = def?.frameWidth ?? 32
  const fh = def?.frameHeight ?? 48
  const cols = def?.columns ?? 1
  const sx = (frame % cols) * fw
  const sy = Math.floor(frame / cols) * fh
  const bodyFrac = kind === 'character' ? 0.64 : 0.62
  return { url: resolveUrl(sheetFile), sx, sy, sw: fw, sh: Math.max(1, Math.round(fh * bodyFrac)) }
}

/** 渲染一个固定边长的像素头像 canvas（异步：图片就绪后自动绘制）。 */
export const renderPortrait = (spec: PortraitSpec, size = 76): HTMLCanvasElement => {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  ctx.imageSmoothingEnabled = false

  const draw = (img: HTMLImageElement) => {
    ctx.clearRect(0, 0, size, size)
    // 等比缩放裁剪区到画布内，水平居中、顶端对齐（突出头部）
    const scale = Math.min(size / spec.sw, size / spec.sh)
    const dw = spec.sw * scale
    const dh = spec.sh * scale
    const dx = (size - dw) / 2
    const dy = 0
    try {
      ctx.drawImage(img, spec.sx, spec.sy, spec.sw, spec.sh, dx, dy, dw, dh)
    } catch {
      // 图片跨域 / 尚未解码：忽略，待 onload 再绘
    }
  }

  const img = loadImage(spec.url)
  if (img.complete && img.naturalWidth > 0) draw(img)
  else img.addEventListener('load', () => draw(img), { once: true })
  return canvas
}
