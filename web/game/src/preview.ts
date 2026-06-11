/**
 * 资产预览页（调试工具）：`/game/?preview=1` 进入。
 *
 * 零依赖 canvas，把 assets/ 下全部素材按 assetManifest 的动画定义跑起来，
 * 用于校验"生成器 → manifest → 渲染"链路；正式世界场景见 scenes/WorldScene.ts。
 */
import { SHEETS, type SheetDef } from './assetManifest'

const assetUrls = import.meta.glob('../assets/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const urlFor = (file: string): string => {
  const url = assetUrls[`../assets/${file}`]
  if (!url) throw new Error(`资产缺失: ${file}（先运行 game/tools/generate_assets.py）`)
  return url
}

const loadImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`加载失败: ${url}`))
    img.src = url
  })

const DISPLAY_SCALE = 3

interface Player {
  ctx: CanvasRenderingContext2D
  sheet: SheetDef
  img: HTMLImageElement
  frames: number[]
  fps: number
  start: number
}

const players: Player[] = []

const frameXY = (sheet: SheetDef, index: number): [number, number] => {
  const col = index % sheet.columns
  const row = Math.floor(index / sheet.columns)
  return [col * sheet.frameWidth, row * sheet.frameHeight]
}

const makeCard = (title: string): HTMLDivElement => {
  const card = document.createElement('div')
  card.className = 'card'
  const label = document.createElement('div')
  label.className = 'card-title'
  label.textContent = title
  card.appendChild(label)
  return card
}

const makeCanvas = (sheet: SheetDef): HTMLCanvasElement => {
  const canvas = document.createElement('canvas')
  canvas.width = sheet.frameWidth * DISPLAY_SCALE
  canvas.height = sheet.frameHeight * DISPLAY_SCALE
  return canvas
}

const addAnimCard = (
  container: HTMLElement,
  sheet: SheetDef,
  img: HTMLImageElement,
  animName: string,
  frames: number[],
  fps: number,
) => {
  const card = makeCard(animName)
  const canvas = makeCanvas(sheet)
  card.appendChild(canvas)
  container.appendChild(card)
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.imageSmoothingEnabled = false
  players.push({ ctx, sheet, img, frames, fps, start: performance.now() })
}

const addTileGrid = (container: HTMLElement, sheet: SheetDef, img: HTMLImageElement) => {
  const total = sheet.columns * sheet.rows
  for (let i = 0; i < total; i++) {
    const card = makeCard(`#${i}`)
    const canvas = makeCanvas(sheet)
    card.appendChild(canvas)
    container.appendChild(card)
    const ctx = canvas.getContext('2d')
    if (!ctx) continue
    ctx.imageSmoothingEnabled = false
    const [sx, sy] = frameXY(sheet, i)
    ctx.drawImage(
      img,
      sx, sy, sheet.frameWidth, sheet.frameHeight,
      0, 0, canvas.width, canvas.height,
    )
  }
}

const tick = () => {
  const now = performance.now()
  for (const p of players) {
    const idx = Math.floor(((now - p.start) / 1000) * p.fps) % p.frames.length
    const [sx, sy] = frameXY(p.sheet, p.frames[idx])
    p.ctx.clearRect(0, 0, p.ctx.canvas.width, p.ctx.canvas.height)
    p.ctx.drawImage(
      p.img,
      sx, sy, p.sheet.frameWidth, p.sheet.frameHeight,
      0, 0, p.ctx.canvas.width, p.ctx.canvas.height,
    )
  }
  requestAnimationFrame(tick)
}

const main = async () => {
  const app = document.getElementById('app')
  if (!app) return

  for (const sheet of SHEETS) {
    const section = document.createElement('section')
    const h2 = document.createElement('h2')
    h2.textContent = `${sheet.label}  ·  ${sheet.file}`
    section.appendChild(h2)
    const grid = document.createElement('div')
    grid.className = 'grid'
    section.appendChild(grid)
    app.appendChild(section)

    const img = await loadImage(urlFor(sheet.file))
    if (sheet.kind === 'tileset' || sheet.kind === 'ui') {
      addTileGrid(grid, sheet, img)
    }
    const anims = Object.entries(sheet.anims)
    for (const [name, anim] of anims) {
      if (sheet.kind === 'tileset' || sheet.kind === 'ui') {
        if (anim.frames.length < 2) continue // 静态瓦片已在网格里展示
      }
      addAnimCard(grid, sheet, img, name, anim.frames, anim.fps)
    }
  }

  requestAnimationFrame(tick)
  const loading = document.getElementById('loading')
  loading?.remove()
}

void main()
