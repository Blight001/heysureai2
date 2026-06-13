/**
 * 总督 Actor：用户操控的角色（玩家化身）。
 *
 * 与数字成员（MemberActor）不同：
 *  - 总督没有 token 上限，因此**不显示血条/ token 条**；
 *  - 总督没有任务安排，不参与调度，纯由用户用 WSAD 操控移动；
 *  - 走到其他 AI 附近时按 F 交互（由 WorldScene 处理）。
 * 头顶有"👑 总督"铭牌与脚下金色光环，便于与核心管理员区分。
 */
import Phaser from 'phaser'
import { WORLD_W, WORLD_H, TILE, type Point } from '../world/layout'

const SPEED = 150 // px/s，比数字成员（42）快得多，操作手感更跟手

export class GovernorActor extends Phaser.GameObjects.Container {
  private sprite: Phaser.GameObjects.Sprite
  private aura: Phaser.GameObjects.Image
  private label: Phaser.GameObjects.Text
  private auraPhase = Math.random() * Math.PI * 2
  private vx = 0
  private vy = 0
  private facing: 'down' | 'up' | 'left' | 'right' = 'down'
  private readonly skin: string

  constructor(scene: Phaser.Scene, start: Point, skin: string) {
    super(scene, start.x, start.y)
    this.skin = skin

    // 金色光环（ADD 混合）——总督的身份标识
    this.aura = scene.add.image(0, -6, 'glow.png', 0)
    this.aura.setBlendMode(Phaser.BlendModes.ADD)
    this.aura.setTint(0xffd700)
    this.aura.setScale(1.9, 1.05)
    this.add(this.aura)

    this.sprite = scene.add.sprite(0, -24, skin, 0)
    this.sprite.setOrigin(0.5, 0.5)
    this.add(this.sprite)

    this.label = scene.add.text(0, -78, '👑 总督', {
      fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
      fontSize: '12px',
      color: '#ffe9a8',
      stroke: '#2a2410',
      strokeThickness: 3,
    })
    this.label.setOrigin(0.5, 1)
    this.add(this.label)

    this.setSize(40, 64)
    scene.add.existing(this)
    this.setDepth(this.y)
  }

  /** 设置移动方向（单位向量由 WorldScene 按 WSAD 合成；0 = 停） */
  setVelocity(dx: number, dy: number) {
    this.vx = dx
    this.vy = dy
  }

  /** 当前是否在移动 */
  get moving(): boolean {
    return this.vx !== 0 || this.vy !== 0
  }

  tick(time: number, deltaMs: number) {
    // 光环呼吸
    this.aura.setAlpha(0.5 + 0.18 * Math.sin(time / 380 + this.auraPhase))

    if (this.vx !== 0 || this.vy !== 0) {
      const len = Math.hypot(this.vx, this.vy) || 1
      const step = (SPEED * deltaMs) / 1000
      this.x = Phaser.Math.Clamp(this.x + (this.vx / len) * step, TILE, WORLD_W - TILE)
      this.y = Phaser.Math.Clamp(this.y + (this.vy / len) * step, TILE * 2, WORLD_H - TILE)
      // 朝向：横向优先
      this.facing = Math.abs(this.vx) > Math.abs(this.vy)
        ? (this.vx > 0 ? 'right' : 'left')
        : (this.vy > 0 ? 'down' : 'up')
      const animKey = `${this.skin}:walk_${this.facing}`
      if (this.sprite.anims.currentAnim?.key !== animKey || !this.sprite.anims.isPlaying) {
        this.sprite.play(animKey)
      }
    } else if (this.sprite.anims.isPlaying) {
      this.sprite.stop()
      this.sprite.setFrame(0)
    }
    this.setDepth(this.y)
  }
}
