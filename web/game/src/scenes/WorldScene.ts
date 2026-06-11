/**
 * P0 世界场景：草原 tilemap + 4 固定建筑 + 作坊街（随 agent:list 增减）
 * + 成员按锚区规则站位/游荡 + hover tooltip + 状态气泡。只读。
 */
import Phaser from 'phaser'
import { getAuthToken } from '@/api/http'
import { toggleAiRun } from '@/api/ai'
import { assignAgentAi } from '@/api/agents'
import { triggerTaskForAgent } from '@/api/task'
import { approveProposal, rejectProposal } from '@/api/librarian'
import { setWorldActorSkin } from '@/api/world'
import { SHEETS, TILES } from '../assetManifest'
import { MemberActor } from '../actors/MemberActor'
import {
  FIXED_BUILDINGS,
  MAP_H,
  MAP_W,
  TILE,
  WORKSHOP_SLOTS,
  WORLD_H,
  WORLD_W,
  ZONES,
  mulberry32,
  workshopSlotPos,
  workshopZone,
  type Point,
  type Rect,
} from '../world/layout'
import { skinFor } from '../world/skins'
import { WorldStore, type WorldEvent, type WorldMember, type WorldSnapshot, type WorldWorkshop } from '../world/store'
import { Drawer } from '../ui/drawer'
import type { Overlay, TooltipData } from '../ui/overlay'

/** 议事厅门口（领任务动线的途经点） */
const HALL_DOOR: Point = { x: 1190, y: 510 }
const LIBRARY_DOOR: Point = { x: 880, y: 490 }

const assetUrls = import.meta.glob('../../assets/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const sfxUrls = import.meta.glob('../../assets/sfx/*.wav', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const urlFor = (file: string): string => {
  const url = assetUrls[`../../assets/${file}`]
  if (!url) throw new Error(`资产缺失: ${file}`)
  return url
}

interface WorkshopView {
  sprite: Phaser.GameObjects.Sprite
  slot: number
  data: WorldWorkshop
  offlineSince: number | null
}

const OFFLINE_KEEP_MS = 60000

export class WorldScene extends Phaser.Scene {
  private store!: WorldStore
  private overlay!: Overlay
  private drawer!: Drawer
  private actors = new Map<number, MemberActor>()
  private workshops = new Map<string, WorkshopView>()
  private slotOwner: (string | null)[] = new Array(WORKSHOP_SLOTS).fill(null)
  private buildings = new Map<string, Phaser.GameObjects.Sprite>()
  private snap: WorldSnapshot | null = null
  private hallFlipTimer: Phaser.Time.TimerEvent | null = null
  private draggingActor: MemberActor | null = null
  /** 演出触发用：上一轮快照的任务状态 / 代数 / 待审批数 */
  private prevTaskStatus = new Map<number, string>()
  private prevGeneration = new Map<number, number>()
  private prevPending = 0
  private muted = false
  private nightOverlay: Phaser.GameObjects.Rectangle | null = null
  /** 开场云层（数据就绪后镜头拉近 + 云朵飘散） */
  private clouds: Phaser.GameObjects.Image[] = []
  private introDone = false
  private sceneReadyAt = 0
  /** 装饰与氛围动画 */
  private groundLayer: Phaser.Tilemaps.TilemapLayer | null = null
  private waterTiles: { x: number; y: number }[] = []
  private waterFlip = false
  private lamps: Phaser.GameObjects.Image[] = []
  private butterflies: { sprite: Phaser.GameObjects.Sprite; tx: number; ty: number; phase: number }[] = []

  constructor() {
    super('world')
  }

  init(data: { store: WorldStore; overlay: Overlay }) {
    this.store = data.store
    this.overlay = data.overlay
  }

  preload() {
    for (const sheet of SHEETS) {
      this.load.spritesheet(sheet.file, urlFor(sheet.file), {
        frameWidth: sheet.frameWidth,
        frameHeight: sheet.frameHeight,
      })
    }
    for (const [path, url] of Object.entries(sfxUrls)) {
      const key = path.split('/').pop()!.replace('.wav', '')
      this.load.audio(key, url as string)
    }
  }

  create() {
    this.createAnims()
    this.createGround()
    this.createDecor()
    this.createBuildings()
    this.createCamera()
    this.createDrawer()
    this.createDayNight()
    this.createAudio()
    this.createCloudCurtain()
    this.wireHover()
    this.wireClickAndDrag()
    this.store.subscribe(snap => this.applySnapshot(snap))
    this.store.onEvent(ev => this.handleWorldEvent(ev))
    this.store.start()
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.store.stop())
  }

  // ---------------------------------------------------------------- 开场云层
  /**
   * 加载等待演出：远景 + 云层覆盖（屏幕空间，缓慢漂浮）；
   * 首个有效快照到达后 revealWorld()——镜头由远拉近，云朵向两侧飘散渐隐。
   */
  private createCloudCurtain() {
    const w = this.scale.width
    const h = this.scale.height
    // 远景起点 = 恰好铺满视口的最小缩放（不露世界外黑边），揭幕时再拉近
    const fillZoom = Math.max(w / WORLD_W, h / WORLD_H)
    this.cameras.main.setZoom(fillZoom)
    this.cameras.main.centerOn(WORLD_W / 2, WORLD_H / 2)
    this.sceneReadyAt = this.time.now
    const rnd = mulberry32(42)
    // 网格 + 抖动铺满整个视口（含边缘溢出），保证云层完全遮盖
    const step = 190
    let i = 0
    for (let gy = -60; gy < h + 120; gy += step) {
      for (let gx = -80; gx < w + 160; gx += step) {
        const cloud = this.add.image(
          gx + (rnd() - 0.5) * step * 0.8,
          gy + (rnd() - 0.5) * step * 0.8,
          'cloud.png',
          i++ % 2,
        )
        cloud.setScrollFactor(0)
        cloud.setDepth(400000 + i)
        cloud.setScale(3 + rnd() * 2.4)
        cloud.setAlpha(0.94 + rnd() * 0.06)
        if (rnd() > 0.5) cloud.setFlipX(true)
        // 等待期：缓慢左右漂浮
        this.tweens.add({
          targets: cloud,
          x: cloud.x + 18 + rnd() * 30,
          duration: 2600 + rnd() * 2400,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        })
        this.clouds.push(cloud)
      }
    }
    // 兜底：数据迟迟不来（网络挂起）也要在 10s 后揭幕
    this.time.delayedCall(10000, () => this.revealWorld())
  }

  /** 镜头由远拉近 + 云朵向两侧飘散渐隐 */
  private revealWorld() {
    if (this.introDone) return
    this.introDone = true
    // 保证云层至少展示一小段，避免数据秒回时动画一闪而过
    const elapsed = this.time.now - this.sceneReadyAt
    this.time.delayedCall(Math.max(0, 900 - elapsed), () => {
      const cam = this.cameras.main
      const endZoom = Phaser.Math.Clamp(Math.max(0.9, cam.zoom * 1.3), 0.5, 2)
      cam.pan(960, 620, 2200, 'Sine.easeInOut')
      cam.zoomTo(endZoom, 2200, 'Sine.easeInOut')
      const cx = this.scale.width / 2
      const rnd = mulberry32(7)
      for (const cloud of this.clouds) {
        this.tweens.killTweensOf(cloud)
        const dir = cloud.x >= cx ? 1 : -1
        this.tweens.add({
          targets: cloud,
          x: cloud.x + dir * (this.scale.width * 0.45 + rnd() * 300),
          y: cloud.y - 30 - rnd() * 60,
          alpha: 0,
          scale: cloud.scale * 1.25,
          delay: rnd() * 350,
          duration: 1500 + rnd() * 900,
          ease: 'Sine.easeIn',
          onComplete: () => cloud.destroy(),
        })
      }
      this.clouds = []
    })
  }

  // ---------------------------------------------------------------- P2 氛围
  private createAudio() {
    this.muted = localStorage.getItem('gw-muted') === '1'
    this.overlay.initMuteButton(document.body, this.muted, muted => {
      this.muted = muted
      try {
        localStorage.setItem('gw-muted', muted ? '1' : '0')
      } catch {
        // ignore
      }
    })
  }

  private playSfx(key: string, volume = 0.5) {
    if (this.muted) return
    try {
      this.sound.play(key, { volume })
    } catch {
      // 浏览器自动播放策略：首次手势前播放失败属预期
    }
  }

  /** 昼夜色调：按本地时间给世界盖一层夜色；?hour=22 可调试 */
  private createDayNight() {
    this.nightOverlay = this.add.rectangle(0, 0, WORLD_W, WORLD_H, 0x141c3c, 0)
    this.nightOverlay.setOrigin(0, 0)
    this.nightOverlay.setDepth(150000)
    const apply = () => {
      const debugHour = Number(new URLSearchParams(window.location.search).get('hour'))
      const now = new Date()
      const h = Number.isFinite(debugHour) ? debugHour : now.getHours() + now.getMinutes() / 60
      const MAX = 0.38
      let alpha = 0
      if (h < 5.5 || h >= 20.5) alpha = MAX
      else if (h < 7.5) alpha = MAX * (1 - (h - 5.5) / 2) // 黎明
      else if (h >= 17.5) alpha = MAX * ((h - 17.5) / 3) // 黄昏
      this.nightOverlay?.setFillStyle(0x141c3c, Math.min(MAX, Math.max(0, alpha)))
      // 天黑点灯
      const lit = alpha > 0.12
      for (const lamp of this.lamps) lamp.setFrame(lit ? 1 : 0)
    }
    apply()
    this.time.addEvent({ delay: 60000, loop: true, callback: apply })
  }

  /** 服务端直推事件 → 即时演出（权威状态随后由去抖 refresh 拉取） */
  private handleWorldEvent(ev: WorldEvent) {
    const id = Number(ev.payload?.ai_config_id)
    const actor = Number.isFinite(id) ? this.actors.get(id) : undefined
    switch (ev.type) {
      case 'task_started':
        actor?.walkVia(HALL_DOOR)
        this.playSfx('scroll')
        break
      case 'task_finished':
        if (actor) this.burstSparkle(actor.x, actor.y - 24)
        this.playSfx('success')
        break
      case 'member_inherited':
        // 传承入殿：立即走死亡演出，下一代由 refresh 带回
        if (actor && !actor.isDying) actor.die(() => this.actors.delete(id))
        this.playSfx('bell', 0.45)
        break
      case 'member_completed': {
        const valhalla = this.buildings.get('valhalla')
        if (valhalla) this.burstSparkle(valhalla.x, valhalla.y + 30)
        this.playSfx('bell', 0.35)
        break
      }
      case 'ai_message': {
        const fromId = Number(ev.payload?.from_ai_config_id)
        const toId = Number(ev.payload?.to_ai_config_id)
        this.playMessenger(
          Number.isFinite(fromId) ? this.actors.get(fromId) : undefined,
          Number.isFinite(toId) ? this.actors.get(toId) : undefined,
          String(ev.payload?.kind || 'message'),
        )
        break
      }
    }
  }

  /** AI 互发消息：信封从发信人飞向收信人（弧线），双方头顶表情 + 音效 */
  private playMessenger(from: MemberActor | undefined, to: MemberActor | undefined, kind: string) {
    if (!from || !to || from === to) return
    from.flashEmote('scroll', 1500)
    const envelope = this.add.image(from.x, from.y - 36, 'envelope.png', 0)
    envelope.setDepth(99500)
    this.playSfx('ui_click', 0.3)
    const sx = from.x
    const sy = from.y - 36
    const dist = Phaser.Math.Distance.Between(sx, sy, to.x, to.y - 36)
    const duration = Phaser.Math.Clamp(dist * 1.8, 700, 2600)
    const arc = Phaser.Math.Clamp(dist * 0.25, 40, 160)
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration,
      ease: 'Sine.easeInOut',
      onUpdate: tween => {
        // 收信人可能在走动：每帧重取终点，信会"追着人飞"
        const t = tween.getValue() ?? 0
        const ex = to.x
        const ey = to.y - 36
        envelope.x = sx + (ex - sx) * t
        envelope.y = sy + (ey - sy) * t - Math.sin(Math.PI * t) * arc
        envelope.setFlipX(ex < sx)
      },
      onComplete: () => {
        envelope.destroy()
        if (to.scene) {
          to.flashEmote(kind === 'reply' ? 'check' : 'alert', 2200)
          this.burstSparkle(to.x, to.y - 40)
        }
        this.playSfx('chime', 0.35)
      },
    })
  }

  private createDrawer() {
    const refresh = () => this.store.refreshNow()
    this.drawer = new Drawer(document.body, {
      toggleRun: async id => {
        await toggleAiRun(id)
        await refresh()
        this.reopenMember(id)
      },
      assignAgent: async (agentId, aiConfigId) => {
        await assignAgentAi(agentId, aiConfigId)
        await refresh()
      },
      setSkin: async (id, skin) => {
        await setWorldActorSkin(id, skin)
        await refresh()
        this.reopenMember(id)
      },
      createTask: async (id, title, instruction) => {
        await triggerTaskForAgent(
          id,
          {
            title,
            instruction,
            priority: 5,
            schedule_enabled: false,
            schedule_loop_enabled: false,
            schedule_run_immediately: false,
            schedule_duration_minutes: 30,
            schedule_at: null,
            override_token_limit_enabled: false,
            token_limit_override: 10000,
            override_mcp_tools_enabled: false,
            mcp_tools_override: [],
          },
          getAuthToken(),
        )
        await refresh()
      },
      approveProposal: async memoryId => {
        await approveProposal(getAuthToken(), memoryId)
        await refresh()
        this.drawer.openLibrary(this.snap!)
      },
      rejectProposal: async memoryId => {
        await rejectProposal(getAuthToken(), memoryId)
        await refresh()
        this.drawer.openLibrary(this.snap!)
      },
      openChat: id => {
        if (window.parent !== window) {
          window.parent.postMessage({ type: 'world:open-chat', aiConfigId: id }, window.location.origin)
        } else {
          window.open('/', '_blank', 'noopener')
        }
      },
      focusMember: id => this.focusMember(id),
    })
  }

  /** 操作后抽屉数据已过期：用新快照重开成员面板 */
  private reopenMember(id: number) {
    const m = this.snap?.members.find(x => x.id === id)
    if (m && this.drawer.isOpen) this.drawer.openMember(m, this.snap!)
  }

  private focusMember(id: number) {
    const actor = this.actors.get(id)
    const m = this.snap?.members.find(x => x.id === id)
    if (actor) this.cameras.main.pan(actor.x, actor.y, 400, 'Sine.easeInOut')
    if (m && this.snap) this.drawer.openMember(m, this.snap)
  }

  // ---------------------------------------------------------------- 初始化
  private createAnims() {
    for (const sheet of SHEETS) {
      for (const [name, anim] of Object.entries(sheet.anims)) {
        if (anim.frames.length < 2) continue
        this.anims.create({
          key: `${sheet.file}:${name}`,
          frames: this.anims.generateFrameNumbers(sheet.file, { frames: anim.frames }),
          frameRate: anim.fps,
          repeat: anim.repeat ? -1 : 0,
        })
      }
    }
  }

  private createGround() {
    const rnd = mulberry32(20260611)
    const grid: number[][] = []
    for (let y = 0; y < MAP_H; y++) {
      const row: number[] = []
      for (let x = 0; x < MAP_W; x++) {
        const r = rnd()
        let t: number = TILES.grassA
        if (r > 0.93) t = TILES.flowerYellow
        else if (r > 0.88) t = TILES.flowerRed
        else if (r > 0.8) t = TILES.tallGrass
        else if (r > 0.55) t = TILES.grassB
        else if (r > 0.35) t = TILES.grassC
        else if (r > 0.33) t = TILES.bush
        else if (r > 0.31) t = TILES.stone
        row.push(t)
      }
      grid.push(row)
    }
    // 西北角池塘（不规则岸线，记录水面格子用于波动动画）
    for (let y = 4; y <= 10; y++) {
      for (let x = 3; x <= 11; x++) {
        const edge = y === 4 || y === 10 || x === 3 || x === 11
        if (edge && rnd() > 0.45) continue
        grid[y][x] = rnd() > 0.5 ? TILES.waterA : TILES.waterB
        this.waterTiles.push({ x, y })
      }
    }
    // 英灵殿山丘：暗草丘体 + 零星碎石，体现"高地"
    for (let y = 3; y <= 11; y++) {
      for (let x = 43; x <= 54; x++) {
        const dx = (x - 48.5) / 6
        const dy = (y - 7) / 4.5
        if (dx * dx + dy * dy <= 1) {
          grid[y][x] = rnd() > 0.85 ? TILES.stone : TILES.grassDark
        }
      }
    }
    const path = (x0: number, y0: number, x1: number, y1: number) => {
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
          if (y >= 0 && y < MAP_H && x >= 0 && x < MAP_W) grid[y][x] = TILES.path
        }
      }
    }
    // 道路统一 2 格宽，更贴近小镇尺度
    path(4, 21, 53, 22) // 主路（东西）
    path(8, 19, 9, 21) // 出生地支路
    path(26, 17, 27, 21) // 图书馆支路
    path(36, 17, 37, 21) // 议事厅支路
    path(47, 10, 48, 21) // 英灵殿山道
    path(5, 32, 53, 33) // 作坊街
    path(29, 22, 30, 32) // 主路 → 作坊街
    // 图书馆-议事厅之间的石板广场（核心管理员踱步区）
    for (let y = 15; y <= 19; y++) {
      for (let x = 29; x <= 36; x++) {
        grid[y][x] = rnd() > 0.5 ? TILES.plazaA : TILES.plazaB
      }
    }
    // 作坊街地块：前 8 个插槽脚下铺土场
    for (let i = 0; i < WORKSHOP_SLOTS; i++) {
      const pos = workshopSlotPos(i)
      const tx = Math.floor(pos.x / TILE)
      const ty = Math.floor(pos.y / TILE)
      path(tx - 1, ty - 1, tx + 1, ty)
    }
    // 出生地花圃：泉水周围一圈花
    for (let y = 17; y <= 23; y++) {
      for (let x = 5; x <= 13; x++) {
        const d = Math.hypot(x - 9, (y - 20) * 1.3)
        if (d > 2.2 && d < 3.6 && grid[y][x] !== TILES.path) {
          grid[y][x] = rnd() > 0.5 ? TILES.flowerRed : TILES.flowerYellow
        }
      }
    }

    const map = this.make.tilemap({ data: grid, tileWidth: TILE, tileHeight: TILE })
    const tiles = map.addTilesetImage('tileset.png', 'tileset.png', TILE, TILE)
    // Phaser 4 可能返回 GPU layer；二者 putTileAt/getTileAt 同接口
    if (tiles) this.groundLayer = (map.createLayer(0, tiles, 0, 0) ?? null) as Phaser.Tilemaps.TilemapLayer | null

    // 沿边与空地点树（避开建筑、道路带）
    const treeRnd = mulberry32(7)
    const blocked: Rect[] = [
      { x: 100, y: 480, w: 400, h: 320 }, // 出生地一带
      { x: 700, y: 250, w: 650, h: 420 }, // 图书馆 + 议事厅
      { x: 1330, y: 40, w: 460, h: 360 }, // 英灵殿山丘
      { x: 100, y: 920, w: 1750, h: 250 }, // 作坊街
      { x: 60, y: 90, w: 360, h: 300 }, // 池塘
    ]
    const inBlocked = (px: number, py: number) =>
      blocked.some(b => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h)
    for (let i = 0; i < 80; i++) {
      const px = 40 + treeRnd() * (WORLD_W - 80)
      const py = 60 + treeRnd() * (WORLD_H - 120)
      const ty = Math.floor(py / TILE)
      const tx = Math.floor(px / TILE)
      if (inBlocked(px, py)) continue
      const t = grid[ty]?.[tx]
      if (t === TILES.path || t === TILES.waterA || t === TILES.waterB || t === TILES.plazaA || t === TILES.plazaB) continue
      const tree = this.add.image(px, py, 'tree.png', 0)
      tree.setOrigin(0.5, 0.92)
      tree.setDepth(py)
    }
    // 池塘波动：水面格子周期性换帧
    this.time.addEvent({
      delay: 750,
      loop: true,
      callback: () => {
        this.waterFlip = !this.waterFlip
        for (const { x, y } of this.waterTiles) {
          const current = this.groundLayer?.getTileAt(x, y)
          if (!current) continue
          const isA = current.index === TILES.waterA
          this.groundLayer?.putTileAt(this.waterFlip === isA ? TILES.waterB : TILES.waterA, x, y)
        }
      },
    })
  }

  /** 装饰层：灯柱（夜晚点亮）/ 栅栏 / 长椅 / 路牌 / 蝴蝶 / 烟囱炊烟 */
  private createDecor() {
    const deco = (key: string, x: number, y: number, frame = 0) => {
      const img = this.add.image(x, y, key, frame)
      img.setOrigin(0.5, 0.9)
      img.setDepth(y)
      return img
    }
    // 主路灯柱（夜晚 updateDayNight 统一点亮）
    for (const tx of [12, 22, 32, 42, 50]) {
      this.lamps.push(deco('lamp.png', tx * TILE + 16, 21 * TILE - 2))
    }
    this.lamps.push(deco('lamp.png', 30 * TILE + 16, 31 * TILE)) // 作坊街路口
    // 出生地栅栏（北侧半围）+ 路牌
    for (let x = 160; x <= 416; x += 32) {
      deco('fence.png', x, 548, x === 160 || x === 416 ? 1 : 0)
    }
    deco('signpost.png', 332, 668)
    // 广场与出生地长椅
    deco('bench.png', 944, 504)
    deco('bench.png', 1130, 504)
    deco('bench.png', 230, 700)
    // 蝴蝶：花丛间飞舞
    const tints = [0xffffff, 0xff9ed2, 0x9ed2ff, 0xfff09e]
    const rnd = mulberry32(99)
    for (let i = 0; i < 6; i++) {
      const sprite = this.add.sprite(200 + rnd() * 1500, 200 + rnd() * 900, 'butterfly.png', 0)
      sprite.play('butterfly.png:loop')
      sprite.setTint(tints[i % tints.length])
      sprite.setDepth(95000)
      this.butterflies.push({ sprite, tx: sprite.x, ty: sprite.y, phase: rnd() * Math.PI * 2 })
    }
    // 图书馆烟囱常烟；作坊执行任务时（reconcile 标记 active）也冒烟
    this.time.addEvent({
      delay: 850,
      loop: true,
      callback: () => {
        this.spawnSmoke(906, 376)
        for (const view of this.workshops.values()) {
          if (view.offlineSince === null && view.sprite.anims.isPlaying && view.data.type === 'desktop') {
            this.spawnSmoke(view.sprite.x - 12, view.sprite.y - 32)
          }
        }
      },
    })
  }

  private spawnSmoke(x: number, y: number) {
    if (!this.introDone) return
    const s = this.add.sprite(x, y, 'effect_smoke.png', 0)
    s.setDepth(98000)
    s.play('effect_smoke.png:loop')
    this.tweens.add({ targets: s, y: y - 18, duration: 800, onComplete: () => s.destroy() })
  }

  private createBuildings() {
    for (const def of FIXED_BUILDINGS) {
      const sprite = this.add.sprite(def.pos.x, def.pos.y, def.sheet, 0)
      sprite.setOrigin(0.5, 0.55)
      sprite.setDepth(def.pos.y + sprite.height * 0.4)
      sprite.setInteractive()
      sprite.setData('tooltip', () => this.buildingTooltip(def.key, def.label))
      sprite.setData('buildingKey', def.key)
      this.buildings.set(def.key, sprite)
    }
    this.buildings.get('spawn')?.play('building_spawn.png:loop')
    this.buildings.get('valhalla')?.play('building_valhalla.png:loop')
  }

  private createCamera() {
    const cam = this.cameras.main
    cam.setBounds(0, 0, WORLD_W, WORLD_H)
    cam.setZoom(0.9)
    cam.centerOn(960, 620)
    cam.roundPixels = true

    let dragging = false
    let lastX = 0
    let lastY = 0
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      dragging = true
      lastX = p.x
      lastY = p.y
    })
    this.input.on('pointerup', () => {
      dragging = false
    })
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!dragging || !p.isDown || this.draggingActor) return
      cam.scrollX -= (p.x - lastX) / cam.zoom
      cam.scrollY -= (p.y - lastY) / cam.zoom
      lastX = p.x
      lastY = p.y
    })
    this.input.on(
      'wheel',
      (_p: Phaser.Input.Pointer, _objs: unknown, _dx: number, dy: number) => {
        const next = Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), 0.5, 2)
        cam.setZoom(next)
      },
    )
  }

  private wireHover() {
    this.input.on(
      'gameobjectover',
      (pointer: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject) => {
        const data = this.tooltipFor(obj)
        if (data) {
          const ev = pointer.event as MouseEvent
          this.overlay.showTooltip(data, ev.clientX ?? pointer.x, ev.clientY ?? pointer.y)
        }
      },
    )
    this.input.on(
      'gameobjectmove',
      (pointer: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject) => {
        const data = this.tooltipFor(obj)
        if (data) {
          const ev = pointer.event as MouseEvent
          this.overlay.showTooltip(data, ev.clientX ?? pointer.x, ev.clientY ?? pointer.y)
        }
      },
    )
    this.input.on('gameobjectout', () => this.overlay.hideTooltip())
  }

  private wireClickAndDrag() {
    this.input.dragDistanceThreshold = 8

    // 点击（按下与抬起距离 < 8px）→ 打开对应抽屉
    this.input.on(
      'gameobjectup',
      (pointer: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject) => {
        if (this.draggingActor) return
        const dist = Phaser.Math.Distance.Between(pointer.downX, pointer.downY, pointer.upX, pointer.upY)
        if (dist >= 8 || !this.snap) return
        this.playSfx('ui_click', 0.4)
        if (obj instanceof MemberActor) {
          const m = this.snap.members.find(x => x.id === obj.memberId)
          if (m) this.drawer.openMember(m, this.snap)
          return
        }
        const agentId = obj.getData?.('agentId') as string | undefined
        if (agentId) {
          this.drawer.openWorkshop(agentId, this.snap)
          return
        }
        const key = obj.getData?.('buildingKey') as string | undefined
        if (key === 'library') this.drawer.openLibrary(this.snap)
        else if (key === 'valhalla') this.drawer.openValhalla(this.snap)
        else if (key === 'hall') this.drawer.openHall(this.snap)
        else if (key === 'spawn') this.drawer.openSpawn(this.snap)
      },
    )

    // 拖拽成员 → 放到作坊上绑定 / 放到出生地解绑
    this.input.on('dragstart', (_p: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject) => {
      if (obj instanceof MemberActor && !obj.isDying) {
        this.draggingActor = obj
        obj.beginDrag()
        this.overlay.hideTooltip()
      }
    })
    this.input.on(
      'drag',
      (_p: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject, dragX: number, dragY: number) => {
        if (obj instanceof MemberActor && obj === this.draggingActor) {
          obj.x = dragX
          obj.y = dragY
        }
      },
    )
    this.input.on('dragend', (_p: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject) => {
      if (!(obj instanceof MemberActor) || obj !== this.draggingActor) return
      this.draggingActor = null
      const drop = this.resolveDropTarget(obj.x, obj.y)
      obj.endDrag()
      if (!drop || !this.snap) return
      const m = this.snap.members.find(x => x.id === obj.memberId)
      if (!m) return
      if (drop.kind === 'workshop') {
        const w = this.snap.workshops.find(x => x.agentId === drop.agentId)
        if (!w) return
        if (window.confirm(`把成员「${m.name}」绑定到 ${w.name}？`)) {
          void assignAgentAi(w.agentId, m.id).then(() => this.store.refreshNow()).catch(() => undefined)
        }
      } else if (drop.kind === 'spawn' && m.boundAgentIds.length) {
        if (window.confirm(`把成员「${m.name}」从端侧 agent 上解绑？`)) {
          void Promise.all(m.boundAgentIds.map(id => assignAgentAi(id, null)))
            .then(() => this.store.refreshNow())
            .catch(() => undefined)
        }
      }
    })
  }

  /** 拖放落点 → 作坊 / 出生地 */
  private resolveDropTarget(x: number, y: number): { kind: 'workshop'; agentId: string } | { kind: 'spawn' } | null {
    for (const [agentId, view] of this.workshops) {
      if (view.offlineSince !== null) continue
      if (Phaser.Math.Distance.Between(x, y, view.sprite.x, view.sprite.y) < 70) {
        return { kind: 'workshop', agentId }
      }
    }
    const spawn = this.buildings.get('spawn')
    if (spawn && Phaser.Math.Distance.Between(x, y, spawn.x, spawn.y) < 90) return { kind: 'spawn' }
    return null
  }

  private tooltipFor(obj: Phaser.GameObjects.GameObject): TooltipData | null {
    if (obj instanceof MemberActor) return this.memberTooltip(obj.member)
    const fn = obj.getData?.('tooltip') as (() => TooltipData) | undefined
    return fn ? fn() : null
  }

  // ---------------------------------------------------------------- 快照消费
  private applySnapshot(snap: WorldSnapshot) {
    this.snap = snap
    this.updateHud(snap)
    // 首个有效快照（成功或明确失败）→ 揭幕：镜头拉近 + 云层散开
    if (snap.authOk || snap.lastError) this.revealWorld()
    if (!snap.authOk) return
    this.reconcileWorkshops(snap)
    this.reconcileMembers(snap)
    this.updateBuildingStates(snap)
    // 知识沉淀演出：新申请到达 → 图书管理员去馆门口"收卷轴"
    if (snap.knowledgePending > this.prevPending) {
      const lib = snap.members.find(m => m.role === 'librarian' && m.lifecycle !== 'dead')
      const actor = lib ? this.actors.get(lib.id) : undefined
      actor?.walkVia(LIBRARY_DOOR)
    }
    this.prevPending = snap.knowledgePending
  }

  private reconcileMembers(snap: WorldSnapshot) {
    const seen = new Set<number>()
    for (const m of snap.members) {
      seen.add(m.id)
      const existing = this.actors.get(m.id)
      if (m.lifecycle === 'dead') {
        // 死亡：在场则演出后移除；不在场（进图前已死）不再创建
        if (existing && !existing.isDying) existing.die(() => this.actors.delete(m.id))
        continue
      }
      const skin = skinFor(m.role, m.id, m.skin)
      const zone = this.anchorFor(m)
      let actor = existing
      if (actor) {
        actor.setMember(m, skin)
        actor.setAnchor(zone)
      } else {
        actor = new MemberActor(this, m, skin, zone)
        actor.setMember(m, skin)
        this.input.setDraggable(actor)
        this.actors.set(m.id, actor)
      }
      this.playTransitions(m, actor)
    }
    // 配置被删除的成员：同走灵魂演出
    for (const [id, actor] of this.actors) {
      if (!seen.has(id) && !actor.isDying) actor.die(() => this.actors.delete(id))
    }
  }

  /** 轮询触发版事件演出：领任务动线 / 传承重生光效 */
  private playTransitions(m: WorldMember, actor: MemberActor) {
    const prevStatus = this.prevTaskStatus.get(m.id)
    if (prevStatus !== undefined && prevStatus !== 'running' && m.taskStatus === 'running') {
      // 领任务：先去议事厅门口"领卷轴"，再回锚区
      actor.walkVia(HALL_DOOR)
    }
    this.prevTaskStatus.set(m.id, m.taskStatus)

    const prevGen = this.prevGeneration.get(m.id)
    if (prevGen !== undefined && m.generation > prevGen) {
      // 传承重生：出生地与成员脚下各放一圈火花
      const spawn = this.buildings.get('spawn')
      if (spawn) this.burstSparkle(spawn.x, spawn.y - 20)
      this.burstSparkle(actor.x, actor.y - 24)
    }
    this.prevGeneration.set(m.id, m.generation)
  }

  private burstSparkle(x: number, y: number) {
    for (let i = 0; i < 5; i++) {
      const s = this.add.sprite(x + (Math.random() - 0.5) * 40, y + (Math.random() - 0.5) * 30, 'effect_sparkle.png', 0)
      s.setDepth(99000)
      s.play('effect_sparkle.png:loop')
      this.time.delayedCall(600 + i * 150, () => s.destroy())
    }
  }

  /** §4.3 锚区规则：自上而下取第一条命中 */
  private anchorFor(m: WorldMember): Rect {
    if (m.role === 'core_admin') return ZONES.plaza
    if (m.role === 'librarian') return ZONES.library
    if (m.role === 'assistant_admin') return ZONES.wanderAll
    const boundAgent = m.boundAgentIds.find(id => this.workshops.get(id)?.offlineSince === null)
    if (boundAgent !== undefined) {
      const view = this.workshops.get(boundAgent)
      if (view) return workshopZone(view.slot)
    }
    if (m.hasActiveTask) return ZONES.hall
    if (!m.projectId || m.lifecycle === 'learning') return ZONES.spawn
    return ZONES.hall
  }

  private reconcileWorkshops(snap: WorldSnapshot) {
    const seen = new Set<string>()
    for (const w of snap.workshops) {
      seen.add(w.agentId)
      let view = this.workshops.get(w.agentId)
      if (!view) {
        const slot = this.claimSlot(w.agentId)
        const pos = workshopSlotPos(slot)
        const sheet = w.type === 'desktop' ? 'building_workshop_desktop.png' : 'building_workshop_browser.png'
        const sprite = this.add.sprite(pos.x, pos.y, sheet, 0)
        sprite.setOrigin(0.5, 0.6)
        sprite.setDepth(pos.y)
        sprite.setInteractive()
        view = { sprite, slot, data: w, offlineSince: null }
        const captured = view
        sprite.setData('tooltip', () => this.workshopTooltip(captured))
        sprite.setData('agentId', w.agentId)
        this.workshops.set(w.agentId, view)
      }
      view.data = w
      if (view.offlineSince !== null) {
        view.offlineSince = null
        view.sprite.clearTint()
      }
      // 动效：绑定成员在干活 or agent 正在执行任务
      const boundMember = snap.members.find(m => m.id === w.aiConfigId)
      const active = w.lifecycle === 'dispatching' || boundMember?.runtimeStatus === 'running'
      const animKey = `${view.sprite.texture.key}:loop`
      if (active) {
        if (view.sprite.anims.currentAnim?.key !== animKey || !view.sprite.anims.isPlaying) {
          view.sprite.play(animKey)
        }
      } else {
        view.sprite.stop()
        view.sprite.setFrame(0)
      }
    }
    // 掉线：变灰保留 60s 再拆除
    const now = Date.now()
    for (const [agentId, view] of this.workshops) {
      if (seen.has(agentId)) continue
      if (view.offlineSince === null) {
        view.offlineSince = now
        view.sprite.stop()
        view.sprite.setFrame(0)
        view.sprite.setTint(0x8a8a8a)
      } else if (now - view.offlineSince > OFFLINE_KEEP_MS) {
        view.sprite.destroy()
        this.releaseSlot(agentId)
        this.workshops.delete(agentId)
      }
    }
  }

  private claimSlot(agentId: string): number {
    const free = this.slotOwner.findIndex(o => o === null)
    if (free >= 0) {
      this.slotOwner[free] = agentId
      return free
    }
    // 插槽用尽：街道向东延伸
    this.slotOwner.push(agentId)
    return this.slotOwner.length - 1
  }

  private releaseSlot(agentId: string) {
    const i = this.slotOwner.indexOf(agentId)
    if (i >= 0) this.slotOwner[i] = null
  }

  private updateBuildingStates(snap: WorldSnapshot) {
    // 图书馆：有待审批 → 亮灯帧
    this.buildings.get('library')?.setFrame(snap.knowledgePending > 0 ? 1 : 0)
    // 议事厅：有任务在跑 → 告示牌翻页（两帧交替）
    const hallActive = snap.members.some(m => m.taskStatus === 'running')
    const hall = this.buildings.get('hall')
    if (hall) {
      if (hallActive && !this.hallFlipTimer) {
        this.hallFlipTimer = this.time.addEvent({
          delay: 700,
          loop: true,
          callback: () => hall.setFrame(hall.frame.name === '0' ? 1 : 0),
        })
      } else if (!hallActive && this.hallFlipTimer) {
        this.hallFlipTimer.remove()
        this.hallFlipTimer = null
        hall.setFrame(0)
      }
    }
  }

  // ---------------------------------------------------------------- tooltip / HUD
  private memberTooltip(m: WorldMember): TooltipData {
    const roleLabel: Record<WorldMember['role'], string> = {
      core_admin: '核心管理员',
      assistant_admin: '辅助管理员',
      librarian: '图书管理员',
      member: '数字成员',
    }
    const ratio = m.tokenLimit > 0 ? m.tokensUsed / m.tokenLimit : undefined
    return {
      title: m.name,
      badge: `${roleLabel[m.role]} · 第 ${m.generation} 代`,
      tokenRatio: ratio,
      tokenText: m.tokenLimit > 0 ? `${m.tokensUsed} / ${m.tokenLimit}` : `${m.tokensUsed}（无上限）`,
      rows: [
        { label: '状态', value: m.enabled ? m.lifecycle : '已停用' },
        { label: '行为', value: m.currentBehavior },
        { label: '任务', value: m.taskTitle ? `${m.taskTitle}（${m.taskStatus}）` : '' },
        { label: '工具', value: m.runtimeStatus === 'running' ? m.runtimeTool : '' },
        { label: '项目', value: m.projectName },
        { label: '模型', value: m.model },
        { label: '端侧', value: m.boundAgentIds.join(', ') },
      ],
    }
  }

  private workshopTooltip(view: WorkshopView): TooltipData {
    const w = view.data
    const bound = this.snap?.members.find(m => m.id === w.aiConfigId)
    return {
      title: w.type === 'desktop' ? '机械坊（桌面 Agent）' : '瞭望塔（浏览器 Agent）',
      badge: view.offlineSince !== null ? '离线' : w.lifecycle === 'dispatching' ? '执行中' : '在线',
      rows: [
        { label: '设备', value: `${w.name}（${w.platform || 'unknown'}）` },
        { label: '成员', value: bound ? `${bound.name}（ID ${bound.id}）` : '未分配' },
        { label: '工具', value: `${w.capabilities} 个端侧工具` },
        { label: '错误', value: w.lastError || '' },
      ],
    }
  }

  private buildingTooltip(key: string, label: string): TooltipData {
    const snap = this.snap
    const rows: { label: string; value: string }[] = []
    if (snap) {
      if (key === 'library') {
        rows.push({ label: '知识', value: `${snap.knowledgeActive} 条生效` })
        rows.push({ label: '待审批', value: snap.knowledgePending > 0 ? `${snap.knowledgePending} 条沉淀申请` : '无' })
      } else if (key === 'valhalla') {
        rows.push({ label: '名册', value: `${snap.valhallaCount} 位逝者` })
      } else if (key === 'hall') {
        const running = snap.members.filter(m => m.taskStatus === 'running').length
        rows.push({ label: '任务', value: `${running} 个运行中` })
      } else if (key === 'spawn') {
        const idle = snap.members.filter(
          m => m.lifecycle !== 'dead' && (!m.projectId || m.lifecycle === 'learning'),
        ).length
        rows.push({ label: '待分配', value: `${idle} 位成员` })
      }
    }
    return { title: label, rows }
  }

  private updateHud(snap: WorldSnapshot) {
    if (!snap.authOk) {
      this.overlay.setHud(
        `<div class="h-title">Agent 进化与实战区域</div>` +
        `<div class="h-err">${snap.lastError || '连接中…'}</div>`,
      )
      return
    }
    const alive = snap.members.filter(m => m.lifecycle !== 'dead').length
    const online = snap.workshops.length
    const running = snap.members.filter(m => m.runtimeStatus === 'running' || m.taskStatus === 'running').length
    this.overlay.setHud(
      `<div class="h-title">Agent 进化与实战区域</div>` +
      `<div>存活成员 <b>${alive}</b> · 在线作坊 <b>${online}</b> · 干活中 <b>${running}</b></div>` +
      `<div>英灵殿 <b>${snap.valhallaCount}</b> · 知识 <b>${snap.knowledgeActive}</b>` +
      (snap.knowledgePending > 0 ? ` · <span class="h-err">待审批 ${snap.knowledgePending}</span>` : '') +
      `</div>` +
      `<div class="h-dim">${snap.socketConnected ? '<span class="h-ok">● 实时连接</span>' : '○ 轮询模式'} · 拖拽平移 / 滚轮缩放 / 悬浮看属性</div>`,
    )
  }

  // ---------------------------------------------------------------- 主循环
  update(time: number, delta: number) {
    for (const actor of this.actors.values()) actor.tick(time, delta)
    // 蝴蝶：飘向目标 + 正弦浮动，到达后另选花丛
    for (const b of this.butterflies) {
      const dx = b.tx - b.sprite.x
      const dy = b.ty - b.sprite.y
      const dist = Math.hypot(dx, dy)
      if (dist < 6) {
        b.tx = 120 + Math.random() * (WORLD_W - 240)
        b.ty = 120 + Math.random() * (WORLD_H - 240)
      } else {
        const step = (26 * delta) / 1000
        b.sprite.x += (dx / dist) * step
        b.sprite.y += (dy / dist) * step + Math.sin(time / 260 + b.phase) * 0.45
        b.sprite.setFlipX(dx < 0)
      }
    }
  }
}
