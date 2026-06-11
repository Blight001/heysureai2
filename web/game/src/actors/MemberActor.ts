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
const ARRIVE_EPS = 4

export type EmoteKind = keyof typeof EMOTES | null

export class MemberActor extends Phaser.GameObjects.Container {
  readonly memberId: number
  member: WorldMember
  private sprite: Phaser.GameObjects.Sprite
  private emote: Phaser.GameObjects.Image
  private skin: string
  private zone: Rect
  private target: Point | null = null
  private idleUntil = 0
  private dying = false

  constructor(scene: Phaser.Scene, member: WorldMember, skin: string, zone: Rect) {
    const start = randomPointIn(zone)
    super(scene, start.x, start.y)
    this.memberId = member.id
    this.member = member
    this.skin = skin
    this.zone = zone

    this.sprite = scene.add.sprite(0, -24, skin, 0)
    this.sprite.setOrigin(0.5, 0.5)
    this.add(this.sprite)

    this.emote = scene.add.image(0, -56, 'emotes.png', 0)
    this.emote.setVisible(false)
    this.add(this.emote)

    this.setSize(32, 48)
    // 命中区对齐精灵（容器原点在脚底）
    this.setInteractive(new Phaser.Geom.Rectangle(-16, -48, 32, 48), Phaser.Geom.Rectangle.Contains)
    scene.add.existing(this)
  }

  get isDying(): boolean {
    return this.dying
  }

  setMember(member: WorldMember, skin: string) {
    this.member = member
    if (skin !== this.skin) {
      this.skin = skin
      this.sprite.stop()
      this.sprite.setTexture(skin, 0)
    }
    this.refreshEmote()
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

  setAnchor(zone: Rect) {
    if (zone === this.zone) return
    this.zone = zone
    // 锚区变化：走过去（不瞬移，让调度可见）
    this.target = clampToWorld(randomPointIn(zone))
    this.idleUntil = 0
  }

  private refreshEmote() {
    const m = this.member
    let kind: EmoteKind = null
    if (!m.enabled) kind = 'zzz'
    else if (m.tokenLimit > 0 && m.tokensUsed / m.tokenLimit >= 0.9) kind = 'hourglass'
    else if (m.runtimeStatus === 'running' || m.taskStatus === 'running') kind = 'scroll'
    else if (m.runtimeStatus === 'error') kind = 'alert'
    if (kind === null) {
      this.emote.setVisible(false)
    } else {
      this.emote.setFrame(EMOTES[kind])
      this.emote.setVisible(true)
    }
  }

  /** 每帧推进；返回 false 表示已销毁 */
  tick(time: number, deltaMs: number): boolean {
    if (this.dying) return true
    if (!this.member.enabled) return true

    if (this.target) {
      const dx = this.target.x - this.x
      const dy = this.target.y - this.y
      const dist = Math.hypot(dx, dy)
      if (dist <= ARRIVE_EPS) {
        this.target = null
        this.idleUntil = time + 1800 + Math.random() * 5200
        this.sprite.stop()
        this.sprite.setFrame(0)
      } else {
        const step = (WALK_SPEED * deltaMs) / 1000
        this.x += (dx / dist) * Math.min(step, dist)
        this.y += (dy / dist) * Math.min(step, dist)
        const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up'
        const animKey = `${this.skin}:walk_${dir}`
        if (this.sprite.anims.currentAnim?.key !== animKey || !this.sprite.anims.isPlaying) {
          this.sprite.play(animKey)
        }
      }
    } else if (time >= this.idleUntil) {
      // 区内游荡：挑下一个点
      this.target = clampToWorld(randomPointIn(this.zone))
    }
    this.setDepth(this.y)
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
