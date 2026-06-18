import type Phaser from 'phaser'
import type { WorldWorkshop } from '../world/store'

export interface WorkshopView {
  sprite: Phaser.GameObjects.Sprite
  taskGlow: Phaser.GameObjects.Image
  slot: number
  data: WorldWorkshop
  offlineSince: number | null
  taskActive: boolean
  glowPhase: number
}
