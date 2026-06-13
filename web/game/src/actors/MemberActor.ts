/**
 * 数字成员 Actor：精灵 + 头顶表情气泡 + 行为状态机。
 *
 * 状态机（见设计方案 §4.2）：idle ⇄ wander(walkTo)；目标锚区由场景按 §4.3 规则
 * 计算后通过 setAnchor 下发，Actor 只负责"平滑走过去 + 区内游荡"。
 * 死亡：collapse 姿态 → 灵魂精灵飞向英灵殿 → 自毁（由场景驱动）。
 */
import Phaser from 'phaser'
import { EMOTES } from '../assetManifest'
import { VALHALLA_DOOR, clampToWorld, randomPointIn, type Point, type Rect } from '../world/layout'
import type { WorldMember } from '../world/store'

const WALK_SPEED = 42 // px/s
const CONTROL_SPEED = 150 // px/s，玩家操控辅助管理员时的移动速度
const ARRIVE_EPS = 4
const HITBOX_W = 44
const HITBOX_H = 70
const HITBOX_TOP = -68
const TOKEN_BAR_W = 34
const TOKEN_BAR_H = 5
const SPEECH_W = 260

export type EmoteKind = keyof typeof EMOTES | null

/** 外观自定义（WorldActorMeta）：调色 / 体型 / 光环 */
export interface ActorAppearance {
  tint: string
  scale: number
  aura: string
}

const hexToColor = (hex: string): number | null => {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null
  return parseInt(hex.slice(1), 16)
}

const speechPreview = (raw: string): string => {
  const cleaned = String(raw || '')
    .replace(/```[^\n]*\n?/g, '')
    .replace(/<\/?think>/gi, '')
    .replace(/__HS_MCP_STATE__=.*$/s, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return cleaned
}

export class MemberActor extends Phaser.GameObjects.Container {
  readonly memberId: number
  member: WorldMember
  private sprite: Phaser.GameObjects.Sprite
  private tokenBar: Phaser.GameObjects.Graphics
  private emote: Phaser.GameObjects.Image
  private speechBubble: Phaser.GameObjects.Graphics
  private speechText: Phaser.GameObjects.Text
  private aura: Phaser.GameObjects.Image
  private auraOn = false
  private auraPhase = Math.random() * Math.PI * 2
  private skin: string
  private zone: Rect
  private target: Point | null = null
  private via: Point | null = null
  private idleUntil = 0
  private dying = false
  private dragging = false
  /** 玩家接管辅助管理员：停止自治游荡，改由 WSAD 驱动；不显示血条 */
  private controlled = false
  private stationary = false
  private controlVx = 0
  private controlVy = 0
  private controlFacing: 'down' | 'up' | 'left' | 'right' = 'down'

  constructor(scene: Phaser.Scene, member: WorldMember, skin: string, zone: Rect) {
    const start = randomPointIn(zone)
    super(scene, start.x, start.y)
    this.memberId = member.id
    this.member = member
    this.skin = skin
    this.zone = zone

    // 光环垫在角色脚下（ADD 混合），由外观自定义开关
    this.aura = scene.add.image(0, -6, 'glow.png', 0)
    this.aura.setBlendMode(Phaser.BlendModes.ADD)
    this.aura.setVisible(false)
    this.add(this.aura)

    this.sprite = scene.add.sprite(0, -24, skin, 0)
    this.sprite.setOrigin(0.5, 0.5)
    this.add(this.sprite)
    this.applyAppearance(member)

    this.tokenBar = scene.add.graphics()
    this.add(this.tokenBar)

    this.emote = scene.add.image(0, -84, 'emotes.png', 0)
    this.emote.setVisible(false)
    this.add(this.emote)

    this.speechBubble = scene.add.graphics()
    this.speechBubble.setVisible(false)
    this.add(this.speechBubble)

    this.speechText = scene.add.text(0, 0, '', {
      fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
      fontSize: '11px',
      color: '#20242c',
      lineSpacing: 2,
      wordWrap: { width: SPEECH_W - 16, useAdvancedWrap: true },
    })
    this.speechText.setVisible(false)
    this.add(this.speechText)

    this.setSize(HITBOX_W, HITBOX_H)
    // Container 命中测试会把本地坐标加 displayOrigin，hitArea 需使用校正后的坐标。
    this.setInteractive(
      new Phaser.Geom.Rectangle(0, HITBOX_TOP + HITBOX_H / 2, HITBOX_W, HITBOX_H),
      Phaser.Geom.Rectangle.Contains,
    )
    scene.add.existing(this)
  }

  get isDying(): boolean {
    return this.dying
  }

  /** 让成员途经某点后回到锚区（世界事件演出用）。 */
  walkVia(p: Point) {
    if (this.dying || this.dragging) return
    this.via = clampToWorld(p)
    this.target = this.via
    this.idleUntil = 0
  }

  beginDrag() {
    if (this.dying) return
    this.dragging = true
    this.target = null
    this.via = null
    this.sprite.stop()
    this.sprite.setFrame(0)
    this.setAlpha(0.85)
  }

  endDrag() {
    this.dragging = false
    this.setAlpha(this.member.enabled ? 1 : 0.75)
    // 回到锚区（从拖放点走回去，调度可见）
    this.target = clampToWorld(randomPointIn(this.zone))
  }

  get isDragging(): boolean {
    return this.dragging
  }

  /** 玩家接管 / 释放。接管时停止游荡并隐藏血条，释放后回锚区。 */
  setControlled(on: boolean) {
    if (this.controlled === on) return
    this.controlled = on
    this.controlVx = 0
    this.controlVy = 0
    if (on) {
      this.target = null
      this.via = null
      this.sprite.stop()
      this.sprite.setFrame(0)
      this.setAlpha(1)
    } else {
      this.target = clampToWorld(randomPointIn(this.zone))
      this.idleUntil = 0
    }
    this.refreshTokenBar()
  }

  get isControlled(): boolean {
    return this.controlled
  }

  /** 交互或对话期间原地驻足，结束后恢复自治游荡。 */
  setStationary(on: boolean) {
    if (this.stationary === on) return
    this.stationary = on
    if (on) {
      this.target = null
      this.via = null
      this.sprite.stop()
      this.sprite.setFrame(0)
    } else if (!this.controlled && this.member.enabled) {
      this.target = clampToWorld(randomPointIn(this.zone))
      this.idleUntil = 0
    }
  }

  /** WSAD 合成的单位方向（0 = 停） */
  setControlVelocity(dx: number, dy: number) {
    this.controlVx = dx
    this.controlVy = dy
  }

  private isOnScreen(): boolean {
    const view = this.scene.cameras.main.worldView
    return (
      this.x > view.x - 64 && this.x < view.right + 64 &&
      this.y > view.y - 64 && this.y < view.bottom + 64
    )
  }

  setMember(member: WorldMember, skin: string) {
    this.member = member
    if (skin !== this.skin) {
      this.skin = skin
      this.sprite.stop()
      this.sprite.setTexture(skin, 0)
    }
    this.applyAppearance(member)
    this.refreshEmote()
    this.refreshTokenBar()
    this.refreshSpeechBubble()
    // 停用：原地坐下打瞌睡
    if (!member.enabled && !this.dying) {
      this.target = null
      this.sprite.stop()
      this.sprite.setFrame(17) // sit
      this.sprite.setAlpha(0.75)
    } else {
      this.sprite.setAlpha(1)
    }
  }

  /** 应用外观自定义（调色 / 体型 / 光环）；抽屉调参时也用于实时预览 */
  applyAppearance(a: ActorAppearance) {
    const tint = hexToColor(a.tint)
    if (tint !== null) this.sprite.setTint(tint)
    else this.sprite.clearTint()

    const scale = Phaser.Math.Clamp(Number.isFinite(a.scale) && a.scale > 0 ? a.scale : 1, 0.7, 1.4)
    this.sprite.setScale(scale)
    this.sprite.y = -24 * scale // 体型变化时保持脚底贴地

    const auraColor = hexToColor(a.aura)
    this.auraOn = auraColor !== null
    if (auraColor !== null) {
      this.aura.setTint(auraColor)
      this.aura.setScale(1.6 * scale, 0.9 * scale)
      this.aura.setVisible(true)
    } else {
      this.aura.setVisible(false)
    }
  }

  /** 预览皮肤贴图（抽屉换肤未保存时的所见即所得） */
  previewSkin(skin: string) {
    if (skin === this.skin || this.dying) return
    this.skin = skin
    this.sprite.stop()
    this.sprite.setTexture(skin, 0)
  }

  setAnchor(zone: Rect) {
    if (zone === this.zone) return
    this.zone = zone
    // 玩家接管时不被锚区拉走
    if (this.controlled || this.stationary) return
    // 锚区变化：走过去（不瞬移，让调度可见）
    this.target = clampToWorld(randomPointIn(zone))
    this.idleUntil = 0
  }

  private refreshEmote() {
    if (Date.now() < this.emoteOverrideUntil) return
    const m = this.member
    let kind: EmoteKind = null
    if (m.taskStatus === 'running') kind = null
    else if (!m.enabled) kind = 'zzz'
    else if (m.tokenLimit > 0 && m.tokensUsed / m.tokenLimit >= 0.9) kind = 'hourglass'
    else if (m.runtimeStatus === 'running') kind = 'scroll'
    else if (m.runtimeStatus === 'error') kind = 'alert'
    if (kind === null) {
      this.emote.setVisible(false)
    } else {
      this.emote.setFrame(EMOTES[kind])
      this.emote.setVisible(true)
    }
  }

  private refreshTokenBar() {
    const g = this.tokenBar
    g.clear()
    const m = this.member
    // 受控角色或无 token 上限的角色：不显示血条
    if (this.controlled || m.tokenLimit <= 0) return
    const x = -TOKEN_BAR_W / 2
    const y = -66
    g.fillStyle(0x1f2933, 0.86)
    g.fillRect(x - 1, y - 1, TOKEN_BAR_W + 2, TOKEN_BAR_H + 2)

    const usedRatio = Phaser.Math.Clamp(m.tokensUsed / m.tokenLimit, 0, 1)
    const remainingRatio = 1 - usedRatio
    const color = remainingRatio > 0.45 ? 0x45c46f : remainingRatio > 0.18 ? 0xf4b942 : 0xef5b5b
    g.fillStyle(0x0f141b, 0.95)
    g.fillRect(x, y, TOKEN_BAR_W, TOKEN_BAR_H)
    g.fillStyle(color, 0.98)
    g.fillRect(x, y, Math.max(1, TOKEN_BAR_W * remainingRatio), TOKEN_BAR_H)
  }

  private refreshSpeechBubble() {
    const taskRunning = this.member.taskStatus === 'running'
    const text = speechPreview(this.member.latestSpeech)
    const visible = taskRunning && !!text && this.member.enabled && !this.dying
    this.speechBubble.setVisible(visible)
    this.speechText.setVisible(visible)
    if (!visible) return

    this.speechText.setText(text)
    const h = Math.max(28, this.speechText.height + 14)
    const x = -SPEECH_W / 2
    const y = -94 - h
    this.speechText.setPosition(x + 9, y + 7)

    const g = this.speechBubble
    g.clear()
    g.fillStyle(0xffffff, 0.97)
    g.fillRoundedRect(x, y, SPEECH_W, h, 7)
    g.lineStyle(2, 0x6d5bd0, 0.62)
    g.strokeRoundedRect(x, y, SPEECH_W, h, 7)
    g.fillStyle(0xffffff, 0.97)
    g.fillTriangle(-8, y + h - 1, 0, y + h + 10, 8, y + h - 1)
  }

  private emoteOverrideUntil = 0

  /** 临时盖一个表情（信使送达/收信等演出），到期恢复状态表情 */
  flashEmote(kind: keyof typeof EMOTES, durationMs = 2200) {
    if (this.dying) return
    this.emoteOverrideUntil = Date.now() + durationMs
    this.emote.setFrame(EMOTES[kind])
    this.emote.setVisible(true)
    this.scene.time.delayedCall(durationMs + 30, () => {
      if (this.scene) this.refreshEmote()
    })
  }

  private lastDepthY = -1

  /** y 变化超过 1px 才更新 depth，避免每帧触发显示列表重排序 */
  private syncDepth() {
    if (Math.abs(this.y - this.lastDepthY) > 1) {
      this.lastDepthY = this.y
      this.setDepth(this.y)
    }
  }

  /** 每帧推进；返回 false 表示已销毁 */
  tick(time: number, deltaMs: number): boolean {
    // 光环呼吸（独立于行走状态机，停用/拖拽时也生效）
    if (this.auraOn) this.aura.setAlpha(0.42 + 0.16 * Math.sin(time / 420 + this.auraPhase))
    if (this.dying || this.dragging) {
      this.syncDepth()
      return true
    }
    // 玩家接管：用 WSAD 速度移动，跳过自治游荡
    if (this.controlled) {
      if (this.controlVx !== 0 || this.controlVy !== 0) {
        const len = Math.hypot(this.controlVx, this.controlVy) || 1
        const step = (CONTROL_SPEED * deltaMs) / 1000
        const np = clampToWorld({
          x: this.x + (this.controlVx / len) * step,
          y: this.y + (this.controlVy / len) * step,
        })
        this.x = np.x
        this.y = np.y
        this.controlFacing = Math.abs(this.controlVx) > Math.abs(this.controlVy)
          ? (this.controlVx > 0 ? 'right' : 'left')
          : (this.controlVy > 0 ? 'down' : 'up')
        const animKey = `${this.skin}:walk_${this.controlFacing}`
        if (this.sprite.anims.currentAnim?.key !== animKey || !this.sprite.anims.isPlaying) {
          this.sprite.play(animKey)
        }
      } else if (this.sprite.anims.isPlaying) {
        this.sprite.stop()
        this.sprite.setFrame(0)
      }
      this.syncDepth()
      return true
    }
    if (this.stationary) {
      if (this.sprite.anims.isPlaying) {
        this.sprite.stop()
        this.sprite.setFrame(0)
      }
      this.syncDepth()
      return true
    }
    if (!this.member.enabled) return true

    if (this.target) {
      const dx = this.target.x - this.x
      const dy = this.target.y - this.y
      const dist = Math.hypot(dx, dy)
      if (dist <= ARRIVE_EPS) {
        if (this.via && this.target.x === this.via.x && this.target.y === this.via.y) {
          // 到达途经点：短暂停留后回锚区
          this.via = null
          this.target = null
          this.idleUntil = time + 1500
        } else {
          this.target = null
          this.idleUntil = time + 1800 + Math.random() * 5200
        }
        this.sprite.stop()
        this.sprite.setFrame(0)
      } else {
        const step = (WALK_SPEED * deltaMs) / 1000
        this.x += (dx / dist) * Math.min(step, dist)
        this.y += (dy / dist) * Math.min(step, dist)
        // 离屏裁剪：视口外只移动坐标不跑动画（100+ 成员时省 CPU）
        if (this.isOnScreen()) {
          const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up'
          const animKey = `${this.skin}:walk_${dir}`
          if (this.sprite.anims.currentAnim?.key !== animKey || !this.sprite.anims.isPlaying) {
            this.sprite.play(animKey)
          }
        } else if (this.sprite.anims.isPlaying) {
          this.sprite.stop()
          this.sprite.setFrame(0)
        }
      }
    } else if (time >= this.idleUntil) {
      // 区内游荡：挑下一个点
      this.target = clampToWorld(randomPointIn(this.zone))
    }
    this.syncDepth()
    return true
  }

  /** 死亡演出：踉跄倒地 → 灵魂出鞘飞向英灵殿 → 自毁 */
  die(onDone: () => void) {
    if (this.dying) return
    this.dying = true
    this.target = null
    this.emote.setFrame(EMOTES.skull)
    this.emote.setVisible(true)
    this.sprite.stop()
    this.sprite.setFrame(18) // collapse
    const scene = this.scene
    scene.time.delayedCall(700, () => {
      if (!this.scene) return
      this.sprite.setFrame(19) // lying
      const soul = scene.add.sprite(this.x, this.y - 30, 'soul.png', 0)
      soul.play('soul.png:loop')
      soul.setDepth(100000)
      scene.tweens.add({
        targets: soul,
        x: VALHALLA_DOOR.x,
        y: VALHALLA_DOOR.y,
        scale: 0.6,
        alpha: 0.25,
        duration: 2600,
        ease: 'Sine.easeInOut',
        onComplete: () => soul.destroy(),
      })
      scene.tweens.add({
        targets: this,
        alpha: 0,
        delay: 1400,
        duration: 900,
        onComplete: () => {
          this.destroy()
          onDone()
        },
      })
    })
  }
}
