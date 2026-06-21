import { toggleAiRun } from '@/api/ai'
import { assignDeviceAi, getDeviceMcpScope, setDeviceMcpScope } from '@/api/devices'
import { getAuthToken } from '@/api/http'
import { triggerTaskForAgent } from '@/api/task'
import { setWorldActorMeta } from '@/api/world'
import type { AppearanceDraft, DrawerActions } from './types'

interface DrawerActionDeps {
  refresh(): Promise<void>
  reopenMember(aiConfigId: number): void
  reopenLibrary(): void
  previewAppearance(aiConfigId: number, meta: AppearanceDraft): void
  openChat(aiConfigId: number): void
  focusMember(aiConfigId: number): void
}

const defaultTaskPayload = (title: string, instruction: string) => ({
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
})

export const createDrawerActions = (deps: DrawerActionDeps): DrawerActions => ({
  toggleRun: async id => {
    await toggleAiRun(id)
    await deps.refresh()
    deps.reopenMember(id)
  },
  assignAgent: async (deviceId, aiConfigId) => {
    await assignDeviceAi(deviceId, aiConfigId)
    await deps.refresh()
  },
  loadDeviceMcpScope: deviceId => getDeviceMcpScope(deviceId),
  saveDeviceMcpScope: async (deviceId, tools) => {
    await setDeviceMcpScope(deviceId, tools)
  },
  setAppearance: async (id, meta) => {
    await setWorldActorMeta(id, meta)
    await deps.refresh()
    deps.reopenMember(id)
  },
  previewAppearance: deps.previewAppearance,
  createTask: async (id, title, instruction) => {
    await triggerTaskForAgent(id, defaultTaskPayload(title, instruction), getAuthToken())
    await deps.refresh()
  },
  openChat: deps.openChat,
  focusMember: deps.focusMember,
})
