/**
 * 角色 → 皮肤纹理。普通成员按 ai_config_id 哈希出确定性默认皮肤
 * （同一成员每次进图长相一致）；P1 接 WorldActorMeta 后改为可配置。
 */
import { MEMBER_SKINS, ROLE_SKINS } from '../assetManifest'
import type { MemberRole } from './store'

export const skinFor = (role: MemberRole, aiConfigId: number): string => {
  if (role === 'core_admin') return ROLE_SKINS.coreAdmin
  if (role === 'assistant_admin') return ROLE_SKINS.assistantAdmin
  if (role === 'librarian') return ROLE_SKINS.librarian
  return MEMBER_SKINS[Math.abs(aiConfigId * 2654435761) % MEMBER_SKINS.length]
}
