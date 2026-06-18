import type Phaser from 'phaser'
import { SHEETS } from '../assetManifest'
import { sfxUrls, urlForAsset } from '../assets'

export const preloadWorldAssets = (scene: Phaser.Scene) => {
  for (const sheet of SHEETS) {
    scene.load.spritesheet(sheet.file, urlForAsset(sheet.file), {
      frameWidth: sheet.frameWidth,
      frameHeight: sheet.frameHeight,
    })
  }
  for (const [path, url] of Object.entries(sfxUrls)) {
    const key = path.split('/').pop()!.replace('.wav', '')
    scene.load.audio(key, url)
  }
}

export const createWorldAnims = (scene: Phaser.Scene) => {
  for (const sheet of SHEETS) {
    for (const [name, anim] of Object.entries(sheet.anims)) {
      if (anim.frames.length < 2) continue
      scene.anims.create({
        key: `${sheet.file}:${name}`,
        frames: scene.anims.generateFrameNumbers(sheet.file, { frames: anim.frames }),
        frameRate: anim.fps,
        repeat: anim.repeat ? -1 : 0,
      })
    }
  }
}
