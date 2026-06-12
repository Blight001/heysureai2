import { get, put } from './http'

/** 游戏世界（社会显示）的表现层元数据：皮肤等，不承载业务。 */

export interface WorldActorMetaItem {
  ai_config_id: number
  skin: string
}

export const listWorldActorMeta = () =>
  get<{ items: WorldActorMetaItem[] }>('/api/world/actors/meta', {
    fallbackError: '世界成员元数据加载失败',
  })

export const setWorldActorSkin = (aiConfigId: number, skin: string) =>
  put<{ ok: boolean; ai_config_id: number; skin: string }>(
    `/api/world/actors/${aiConfigId}/meta`,
    { skin },
    { fallbackError: '皮肤保存失败' },
  )
