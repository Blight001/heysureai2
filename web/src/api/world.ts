import { get, put } from './http'

/** 游戏世界（社会显示）的表现层元数据：皮肤 / 调色 / 体型 / 光环，不承载业务。 */

export interface WorldActorAppearance {
  /** 皮肤 spritesheet key，空 = 默认哈希皮肤 */
  skin: string
  /** 调色 #RRGGBB，空 = 不调色 */
  tint: string
  /** 体型缩放（0.7 - 1.4），1 = 默认 */
  scale: number
  /** 光环颜色 #RRGGBB，空 = 无光环 */
  aura: string
}

export interface WorldActorMetaItem extends WorldActorAppearance {
  ai_config_id: number
}

export const listWorldActorMeta = () =>
  get<{ items: WorldActorMetaItem[] }>('/api/world/actors/meta', {
    fallbackError: '世界成员元数据加载失败',
  })

/** 部分更新：未传字段保持不变（与后端合并语义一致） */
export const setWorldActorMeta = (aiConfigId: number, meta: Partial<WorldActorAppearance>) =>
  put<{ ok: boolean; ai_config_id: number } & WorldActorAppearance>(
    `/api/world/actors/${aiConfigId}/meta`,
    meta,
    { fallbackError: '外观保存失败' },
  )

export const setWorldActorSkin = (aiConfigId: number, skin: string) =>
  setWorldActorMeta(aiConfigId, { skin })
