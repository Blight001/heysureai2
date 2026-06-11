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
import { WorldStore, type WorldMember, type WorldSnapshot, type WorldWorkshop } from '../world/store'
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
  }

  create() {
    this.createAnims()
    this.createGround()
    this.createBuildings()
    this.createCamera()
    this.createDrawer()
    this.wireHover()
    this.wireClickAndDrag()
    this.store.subscribe(snap => this.applySnapshot(snap))
    this.store.start()
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.store.stop())
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
        if (r > 0.92) t = TILES.flowerYellow
        else if (r > 0.86) t = TILES.flowerRed
        else if (r > 0.78) t = TILES.tallGrass
        else if (r > 0.55) t = TILES.grassB
        else if (r > 0.35) t = TILES.grassC
        else if (r > 0.32) t = TILES.bush
        else if (r > 0.30) t = TILES.stone
        row.push(t)
      }
      grid.push(row)
    }
    // 西北角池塘
    for (let y = 5; y <= 9; y++) {
      for (let x = 4; x <= 10; x++) {
        const edge = y === 5 || y === 9 || x === 4 || x === 10
        if (edge && rnd() > 0.6) continue
        grid[y][x] = rnd() > 0.5 ? TILES.waterA : TILES.waterB
      }
    }
    const path = (x0: number, y0: number, x1: number, y1: number) => {
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
          if (y >= 0 && y < MAP_H && x >= 0 && x < MAP_W) grid[y][x] = TILES.path
        }
      }
    }
    path(5, 21, 52, 22) // 主路（东西）
    path(8, 19, 10, 21) // 出生地支路
    path(26, 16, 28, 21) // 图书馆支路
    path(36, 17, 38, 21) // 议事厅支路
    path(47, 10, 49, 21) // 英灵殿山道
    path(6, 32, 52, 33) // 作坊街
    path(29, 22, 31, 32) // 主路 → 作坊街

    const map = this.make.tilemap({ data: grid, tileWidth: TILE, tileHeight: TILE })
    const tiles = map.addTilesetImage('tileset.png', 'tileset.png', TILE, TILE)
    if (tiles) map.createLayer(0, tiles, 0, 0)

    // 沿边与空地点树（避开建筑、道路带）
    const treeRnd = mulberry32(7)
    const blocked: Rect[] = [
      { x: 100, y: 480, w: 400, h: 320 }, // 出生地一带
      { x: 700, y: 250, w: 650, h: 420 }, // 图书馆 + 议事厅
      { x: 1380, y: 60, w: 380, h: 320 }, // 英灵殿
      { x: 100, y: 920, w: 1750, h: 250 }, // 作坊街
      { x: 80, y: 120, w: 320, h: 250 }, // 池塘
    ]
    const inBlocked = (px: number, py: number) =>
      blocked.some(b => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h)
    for (let i = 0; i < 70; i++) {
      const px = 40 + treeRnd() * (WORLD_W - 80)
      const py = 60 + treeRnd() * (WORLD_H - 120)
      const ty = Math.floor(py / TILE)
      const tx = Math.floor(px / TILE)
      if (inBlocked(px, py)) continue
      if (grid[ty]?.[tx] === TILES.path || grid[ty]?.[tx] === TILES.waterA || grid[ty]?.[tx] === TILES.waterB) continue
      const tree = this.add.image(px, py, 'tree.png', 0)
      tree.setOrigin(0.5, 0.92)
      tree.setDepth(py)
    }
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
  }
}
