<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getMcpToolZhLabel, groupMcpToolsBySource } from '@/utils/mcpTools'
import { fetchWorkshopBindings, setWorkshopBinding, type WorkshopAgentItem } from '@/api/workshop'
import type { ModelPreset } from '@/types'
import type { ConnectedAgent } from '@/composables/dashboard/useDashboardData'
import AgentMcpScopeEditor from './AgentMcpScopeEditor.vue'

type SettingsSection = 'mcp' | 'auto' | 'bot'

interface Props {
  show: boolean
  mode: 'create' | 'edit'
  form: any | null
  deleteConfirm: boolean
  settingsSection: SettingsSection | ''
  availableMcpTools: string[]
  connectedAgents?: ConnectedAgent[]
  modelPresets: ModelPreset[]
  onClose: () => void
  onToggleSettingsSection: (section: SettingsSection) => void
  onToolCheckboxChange: (tool: string, event: Event) => void
  onToggleRun: () => void
  onToggleDeleteConfirm: () => void
  onSave: () => void
  onDelete: () => void
}

const props = defineProps<Props>()
const promptDetailOpen = ref(false)

const settingsSectionTitle: Record<SettingsSection, string> = {
  mcp: 'MCP 工具权限',
  bot: '机器人配置',
  auto: '系统自动控制',
}

const openSettingsSection = (section: SettingsSection) => {
  props.onToggleSettingsSection(section)
}

const closeSettingsSection = () => {
  if (!props.settingsSection) return
  props.onToggleSettingsSection(props.settingsSection)
}

const openPromptDetail = () => {
  promptDetailOpen.value = true
}

const closePromptDetail = () => {
  promptDetailOpen.value = false
}

const groupedAvailableMcpTools = computed(() => groupMcpToolsBySource(props.availableMcpTools))

// Connected endpoint agents bound to the AI being edited. Their endpoint MCP
// tools are governed per-agent (not via mcp_tools), so they get their own
// permission editor here. Disconnected agents simply don't appear.
const boundEndpointAgents = computed<ConnectedAgent[]>(() => {
  const cfgId = Number(props.form?.id)
  if (!Number.isFinite(cfgId) || cfgId <= 0) return []
  return (props.connectedAgents || []).filter((agent) => {
    if (Number(agent.aiConfigId) !== cfgId) return false
    const platform = String(agent.platform || '').toLowerCase()
    return !!agent.isWindowsDesktop || !!agent.isBrowserExtension
      || platform.includes('desktop') || platform.includes('windows') || platform.includes('browser')
  })
})
const selectedBotName = computed(() => props.form?.bot_channel === 'qq' ? 'QQ机器人' : '飞书机器人')
const selectedModelPreset = computed(() => {
  const selectedId = String(props.form?.model_preset_id || '')
  return (props.modelPresets || []).find(item => item.id === selectedId) || null
})
const selectedBotEnabled = computed(() => {
  const channel = props.form?.bot_channel === 'qq' ? 'qq' : 'feishu'
  return !!props.form?.bot_configs?.[channel]?.enabled
})
const isToolSelected = (tool: string) => Array.isArray(props.form?.mcp_tools) && props.form.mcp_tools.includes(tool)
const selectedAvailableMcpToolCount = computed(() => props.availableMcpTools.filter(tool => isToolSelected(tool)).length)
const toolsAllSelected = (tools: string[]) => tools.length > 0 && tools.every(tool => isToolSelected(tool))
const emitToolSelection = (tool: string, checked: boolean) => {
  props.onToolCheckboxChange(tool, { target: { checked } } as unknown as Event)
}
const onToolGroupChange = (tools: string[], event: Event) => {
  const target = event.target as HTMLInputElement | null
  const checked = !!target?.checked
  tools.forEach(tool => emitToolSelection(tool, checked))
}

const onModelPresetChange = () => {
  if (!props.form) return
  const preset = selectedModelPreset.value
  props.form.model = preset?.model || ''
}

// ---------- 知识与进化工坊绑定 ----------
// 工坊 agent（agent/workshop/）服务多个 AI；在这里为当前 AI 单独绑定/解绑。
// 绑定是该 AI 调用 librarian.* / evolution.* 工具的唯一门槛。
const workshopAgents = ref<WorkshopAgentItem[]>([])
const workshopLoading = ref(false)
const workshopError = ref('')

const editingConfigId = computed(() => {
  const cfgId = Number(props.form?.id)
  return Number.isFinite(cfgId) && cfgId > 0 ? cfgId : 0
})

const loadWorkshopAgents = async () => {
  const cfgId = editingConfigId.value
  if (!cfgId) {
    workshopAgents.value = []
    return
  }
  workshopLoading.value = true
  workshopError.value = ''
  try {
    const data = await fetchWorkshopBindings(cfgId)
    workshopAgents.value = Array.isArray(data.agents) ? data.agents : []
  } catch (err: any) {
    workshopError.value = err?.message || '知识工坊列表加载失败'
  } finally {
    workshopLoading.value = false
  }
}

watch(
  () => [props.show, editingConfigId.value],
  ([show, cfgId]) => {
    if (show && cfgId) void loadWorkshopAgents()
  },
  { immediate: true },
)

const toggleWorkshopBinding = async (agent: WorkshopAgentItem, event: Event) => {
  const target = event.target as HTMLInputElement | null
  const next = !!target?.checked
  const cfgId = editingConfigId.value
  if (!cfgId) return
  // 1:1 绑定：勾选会替换工坊当前绑定的成员，先确认
  if (next && agent.bound_ai_config_id && agent.bound_ai_config_id !== cfgId) {
    const ok = window.confirm(
      `「${agent.name}」当前绑定的是「${agent.bound_ai_name}」。知识工坊只能绑定一个 AI 数字成员，继续将替换为本 AI？`,
    )
    if (!ok) {
      if (target) target.checked = agent.bound
      return
    }
  }
  try {
    await setWorkshopBinding(cfgId, agent.agent_id, next)
    await loadWorkshopAgents()
  } catch (err: any) {
    workshopError.value = err?.message || '更新知识工坊绑定失败'
    if (target) target.checked = agent.bound
  }
}
</script>

<template>
  <Transition name="fade">
    <div v-if="show && form" class="fixed inset-0 z-[95] bg-black/45 flex items-center justify-center p-4" @click="onClose">
      <div class="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-700 shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-5" @click.stop>
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            {{ mode === 'create' ? '新建 AI 配置' : `AI 配置 - ${form.name}` }}
          </h3>
          <button class="text-xs px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-300" @click="onClose">关闭</button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div>
            <label class="block text-xs text-zinc-500 mb-1">名称</label>
            <input v-model="form.name" class="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100" />
          </div>
          <div>
            <label class="block text-xs text-zinc-500 mb-1">AI 类型</label>
            <!-- 角色扁平化：辅助管理员由系统默认创建（每用户一个），不再支持
                 新建或切换；除它之外所有 AI 都按数字生命成员对待。 -->
            <div
              v-if="form.ai_role_group === 'assistant_admin'"
              class="w-full px-3 py-2 rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-500 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-400"
            >
              辅助管理员（系统默认，不可新增）
            </div>
            <select
              v-else
              v-model="form.ai_role_group"
              class="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100"
            >
              <option value="digital_member">数字生命成员</option>
            </select>
          </div>
          <div v-if="form.ai_role_group === 'digital_member'">
            <label class="block text-xs text-zinc-500 mb-1">成员身份</label>
            <select v-model="form.digital_member_role" class="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100">
              <option value="manager">管理员</option>
              <option value="member">普通成员</option>
            </select>
          </div>
          <div>
            <label class="block text-xs text-zinc-500 mb-1">平台</label>
            <input v-model="form.platform" class="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100" />
          </div>
          <div>
            <label class="block text-xs text-zinc-500 mb-1">模型</label>
            <select
              v-model="form.model_preset_id"
              class="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100"
              @change="onModelPresetChange"
            >
              <option value="">请选择服务器模型</option>
              <option v-for="preset in modelPresets" :key="preset.id" :value="preset.id">
                {{ preset.name || preset.model }}（{{ preset.model }}）
              </option>
            </select>
            <div v-if="selectedModelPreset" class="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
              {{ selectedModelPreset.base_url }}
            </div>
            <div v-else class="mt-1 text-[11px] text-amber-600 dark:text-amber-300">
              请先在系统设置中保存服务器模型。
            </div>
          </div>
          <div>
            <label class="block text-xs text-zinc-500 mb-1">Token 上限</label>
            <input
              v-if="form.ai_role_group !== 'assistant_admin'"
              v-model.number="form.token_limit"
              type="number"
              min="1"
              class="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100"
            />
            <div
              v-else
              class="w-full px-3 py-2 rounded-lg border border-zinc-200 text-xs text-zinc-500 bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-300"
            >
              辅助管理员无 Token 上限（仅用于与用户对话）
            </div>
          </div>
          <div class="md:col-span-2">
            <div class="mb-1 flex items-center justify-between gap-2">
              <label class="block text-xs text-zinc-500">Prompt</label>
              <button
                type="button"
                class="text-[11px] px-2 py-1 rounded border border-zinc-200 text-zinc-600 hover:border-indigo-300 hover:text-indigo-600 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-indigo-500/50 dark:hover:text-indigo-300"
                @click="openPromptDetail"
              >
                详情
              </button>
            </div>
            <textarea v-model="form.prompt" rows="3" class="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100"></textarea>
          </div>
        </div>

        <div class="mt-4 p-3 rounded-lg border border-zinc-200 dark:border-zinc-700">
          <div class="text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-2">权限及其系统设置</div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
            <button
              type="button"
              class="text-left px-3 py-2.5 rounded-lg border border-zinc-200 bg-zinc-50/70 hover:border-indigo-300 hover:bg-white dark:border-zinc-700 dark:bg-zinc-800/40 dark:hover:border-indigo-500/50 dark:hover:bg-zinc-800"
              @click="openSettingsSection('mcp')"
            >
              <span class="block text-xs font-medium text-zinc-700 dark:text-zinc-200">MCP 工具权限</span>
              <span class="mt-1 block text-[11px] text-zinc-500 dark:text-zinc-400">
                已选 {{ selectedAvailableMcpToolCount }} / 可用 {{ availableMcpTools.length }}，{{ form.mcp_auto_approve ? '无需确认' : '调用需确认' }}
              </span>
            </button>
            <button
              type="button"
              class="text-left px-3 py-2.5 rounded-lg border border-zinc-200 bg-zinc-50/70 hover:border-indigo-300 hover:bg-white dark:border-zinc-700 dark:bg-zinc-800/40 dark:hover:border-indigo-500/50 dark:hover:bg-zinc-800"
              @click="openSettingsSection('bot')"
            >
              <span class="block text-xs font-medium text-zinc-700 dark:text-zinc-200">机器人配置</span>
              <span class="mt-1 block text-[11px] text-zinc-500 dark:text-zinc-400">
                {{ selectedBotName }}，{{ selectedBotEnabled ? '已启用' : '未启用' }}
              </span>
            </button>
            <button
              v-if="form.ai_role_group === 'digital_member'"
              type="button"
              class="text-left px-3 py-2.5 rounded-lg border border-zinc-200 bg-zinc-50/70 hover:border-indigo-300 hover:bg-white dark:border-zinc-700 dark:bg-zinc-800/40 dark:hover:border-indigo-500/50 dark:hover:bg-zinc-800"
              @click="openSettingsSection('auto')"
            >
              <span class="block text-xs font-medium text-zinc-700 dark:text-zinc-200">系统自动控制</span>
              <span class="mt-1 block text-[11px] text-zinc-500 dark:text-zinc-400">
                {{ form.system_auto_control.enabled ? '已启用' : '未启用' }}
              </span>
            </button>
          </div>
        </div>

        <div class="mt-5 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <button
              v-if="mode === 'edit'"
              class="text-xs px-3 py-1.5 rounded border"
              :class="form.enabled
                ? 'text-red-600 border-red-200 bg-red-50 dark:text-red-300 dark:border-red-500/30 dark:bg-red-900/20'
                : 'text-emerald-600 border-emerald-200 bg-emerald-50 dark:text-emerald-300 dark:border-emerald-500/30 dark:bg-emerald-900/20'"
              @click="onToggleRun"
            >
              {{ form.enabled ? '停止 AI' : '启动 AI' }}
            </button>
            <button
              v-if="mode === 'edit'"
              class="text-xs px-3 py-1.5 rounded border border-red-200 text-red-600 bg-red-50 dark:border-red-500/30 dark:bg-red-900/20 dark:text-red-300"
              @click="onToggleDeleteConfirm"
            >
              删除 AI
            </button>
          </div>
          <div class="flex items-center gap-2">
            <button class="text-xs px-3 py-1.5 rounded border border-zinc-200 dark:border-zinc-700" @click="onClose">取消</button>
            <button class="text-xs px-3 py-1.5 rounded bg-indigo-600 text-white" @click="onSave">保存配置</button>
          </div>
        </div>

        <div v-if="deleteConfirm" class="mt-3 p-3 rounded-lg border border-red-200 bg-red-50 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-900/20 dark:text-red-300">
          <div class="mb-2">确认删除该 AI？删除后无法恢复。</div>
          <div class="flex justify-end">
            <button class="px-2 py-1 rounded bg-red-600 text-white" @click="onDelete">确认删除</button>
          </div>
        </div>
      </div>

      <Transition name="fade">
        <div
          v-if="settingsSection && (settingsSection !== 'auto' || form.ai_role_group === 'digital_member')"
          class="fixed inset-0 z-[105] bg-black/35 flex items-center justify-center p-4"
          @click.stop="closeSettingsSection"
        >
          <div class="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-700 shadow-xl w-full max-w-2xl max-h-[82vh] flex flex-col" @click.stop>
            <div class="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
              <h4 class="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{{ settingsSectionTitle[settingsSection] }}</h4>
              <button class="text-xs px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-300" @click="closeSettingsSection">关闭</button>
            </div>

            <div class="p-4 overflow-y-auto">
              <div v-if="settingsSection === 'mcp'">
                <label class="mb-3 flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-300 px-2 py-2 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/60">
                  <span>MCP 调用无需确认</span>
                  <input type="checkbox" v-model="form.mcp_auto_approve" />
                </label>
                <p class="mb-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                  仅显示当前角色（{{ form.ai_role_group === 'assistant_admin' ? '辅助管理员' : (form.digital_member_role === 'manager' ? '数字成员·管理者' : '数字成员·普通成员') }}）允许的 MCP 工具，可在“系统设置 → 工作区与 MCP → MCP 角色权限”中调整各角色范围。
                </p>

                <!-- Endpoint agents bound to this AI: per-agent MCP permission.
                     These tools come from the connected device, not from the
                     server MCP list, and only show while the device is online. -->
                <div v-if="boundEndpointAgents.length" class="mb-3 space-y-2">
                  <div class="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">已连接 Agent 的 MCP 权限</div>
                  <AgentMcpScopeEditor
                    v-for="agent in boundEndpointAgents"
                    :key="`ai-config-agent-scope-${agent.id}`"
                    :agent-id="agent.id"
                    :refresh-key="`${agent.aiConfigId ?? ''}-${settingsSection}`"
                  />
                </div>

                <!-- 知识与进化工坊（server/workshop/，服务端内置）：1:1 绑定。
                     绑定后该 AI 才能看到并调用 librarian.* / evolution.* 工具。 -->
                <div
                  v-if="editingConfigId && form.ai_role_group !== 'assistant_admin'"
                  class="mb-3 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 dark:border-indigo-500/30 dark:bg-indigo-500/5"
                >
                  <div class="flex items-center justify-between">
                    <div class="text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">知识与进化工坊</div>
                    <button
                      class="text-[10px] px-1.5 py-0.5 rounded border border-indigo-200 text-indigo-600 dark:border-indigo-500/40 dark:text-indigo-300"
                      @click="loadWorkshopAgents"
                    >刷新</button>
                  </div>
                  <p class="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
                    工坊由服务端内置、每个账号自动上线（无需运行任何程序）。绑定后本 AI 才能调用知识库（librarian.*）与进化（evolution.*）工具；工坊只能绑定一个 AI 数字成员，绑定新成员会替换旧绑定。
                  </p>
                  <div v-if="workshopLoading" class="mt-2 text-[11px] text-zinc-400">加载中…</div>
                  <div v-else-if="workshopError" class="mt-2 text-[11px] text-rose-500">{{ workshopError }}</div>
                  <div v-else-if="workshopAgents.length === 0" class="mt-2 text-[11px] text-zinc-400">
                    工坊暂不可用，请刷新重试（正常情况下内置工坊会自动上线）。
                  </div>
                  <label
                    v-for="agent in workshopAgents"
                    :key="`workshop-${agent.agent_id}`"
                    class="mt-2 flex items-center justify-between gap-2 rounded border border-zinc-200 bg-white/70 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900/50"
                  >
                    <span class="flex items-center gap-2 min-w-0">
                      <span
                        class="h-1.5 w-1.5 shrink-0 rounded-full"
                        :class="agent.online ? 'bg-emerald-500' : 'bg-zinc-400'"
                      ></span>
                      <span class="truncate text-zinc-700 dark:text-zinc-200">{{ agent.name }}</span>
                      <span class="shrink-0 text-[10px] text-zinc-400">
                        {{ agent.online ? `${agent.tools.length} 个工具` : '离线' }} ·
                        {{ agent.bound_ai_config_id ? `已绑定：${agent.bound_ai_name}` : '未绑定' }}
                      </span>
                    </span>
                    <input type="checkbox" :checked="agent.bound" @change="toggleWorkshopBinding(agent, $event)" />
                  </label>
                </div>

                <div class="space-y-3 max-h-[46vh] overflow-y-auto pr-1">
                  <details
                    v-for="source in groupedAvailableMcpTools"
                    :key="`ai-config-mcp-source-${source.source}`"
                    open
                    class="rounded-lg border border-zinc-200 bg-white/80 dark:border-zinc-700 dark:bg-zinc-900/60"
                  >
                    <summary class="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-zinc-700 dark:text-zinc-200 flex items-center justify-between gap-3">
                      <span>{{ source.title }}</span>
                      <span class="flex items-center gap-3">
                        <span class="text-[10px] font-normal text-zinc-400 dark:text-zinc-500">
                          {{ source.tools.filter(tool => form.mcp_tools.includes(tool)).length }} / {{ source.tools.length }}
                        </span>
                        <span class="flex items-center gap-1 text-[10px] font-normal text-zinc-500 dark:text-zinc-400" @click.stop>
                          <input
                            type="checkbox"
                            :checked="toolsAllSelected(source.tools)"
                            @click.stop
                            @change.stop="onToolGroupChange(source.tools, $event)"
                          />
                          <span>全选</span>
                        </span>
                      </span>
                    </summary>
                    <div class="px-2 pb-2">
                      <details
                        v-for="parent in source.parentGroups"
                        :key="`ai-config-mcp-${source.source}-parent-${parent.title}`"
                        class="mb-2 rounded-lg border border-zinc-200 bg-zinc-50/70 last:mb-0 dark:border-zinc-700 dark:bg-zinc-800/40"
                      >
                        <summary class="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-zinc-700 dark:text-zinc-200 flex items-center justify-between gap-3">
                          <span>{{ parent.title }}</span>
                          <span class="flex items-center gap-3">
                            <span class="text-[10px] font-normal text-zinc-400 dark:text-zinc-500">
                              {{ parent.tools.filter(tool => form.mcp_tools.includes(tool)).length }} / {{ parent.tools.length }}
                            </span>
                            <span class="flex items-center gap-1 text-[10px] font-normal text-zinc-500 dark:text-zinc-400" @click.stop>
                              <input
                                type="checkbox"
                                :checked="toolsAllSelected(parent.tools)"
                                @click.stop
                                @change.stop="onToolGroupChange(parent.tools, $event)"
                              />
                              <span>全选</span>
                            </span>
                          </span>
                        </summary>
                        <div class="space-y-2 px-2 pb-2">
                          <div
                            v-if="parent.groups.length === 1"
                            class="grid grid-cols-1 md:grid-cols-2 gap-2"
                          >
                            <label v-for="tool in parent.groups[0].tools" :key="tool" class="text-xs text-zinc-600 dark:text-zinc-300 flex items-start gap-2 px-2 py-1.5 rounded border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
                              <input
                                type="checkbox"
                                class="mt-0.5"
                                :checked="form.mcp_tools.includes(tool)"
                                @change="onToolCheckboxChange(tool, $event)"
                              />
                              <span class="min-w-0">
                                <span class="block">{{ getMcpToolZhLabel(tool) }}</span>
                                <span class="block font-mono text-[10px] text-zinc-400 dark:text-zinc-500 break-all">{{ tool }}</span>
                              </span>
                            </label>
                          </div>
                          <details
                            v-else
                            v-for="group in parent.groups"
                            :key="`ai-config-mcp-${source.source}-${parent.title}-${group.tag}`"
                            class="rounded-lg border border-zinc-200 bg-white/80 dark:border-zinc-700 dark:bg-zinc-900/60"
                          >
                            <summary class="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-zinc-700 dark:text-zinc-200 flex items-center justify-between gap-3">
                              <span>{{ group.tag }}</span>
                              <span class="text-[10px] font-normal text-zinc-400 dark:text-zinc-500">
                                {{ group.tools.filter(tool => form.mcp_tools.includes(tool)).length }} / {{ group.tools.length }}
                              </span>
                            </summary>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-2 px-2 pb-2">
                              <label v-for="tool in group.tools" :key="tool" class="text-xs text-zinc-600 dark:text-zinc-300 flex items-start gap-2 px-2 py-1.5 rounded border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
                                <input
                                  type="checkbox"
                                  class="mt-0.5"
                                  :checked="form.mcp_tools.includes(tool)"
                                  @change="onToolCheckboxChange(tool, $event)"
                                />
                                <span class="min-w-0">
                                  <span class="block">{{ getMcpToolZhLabel(tool) }}</span>
                                  <span class="block font-mono text-[10px] text-zinc-400 dark:text-zinc-500 break-all">{{ tool }}</span>
                                </span>
                              </label>
                            </div>
                          </details>
                        </div>
                      </details>
                    </div>
                  </details>
                  <div v-if="availableMcpTools.length === 0" class="text-xs text-zinc-500 dark:text-zinc-400">该角色暂无可配置的 MCP 工具</div>
                </div>
              </div>

              <div v-else-if="settingsSection === 'bot'" class="space-y-3">
                <div>
                  <label class="block text-[11px] text-zinc-500 mb-1">机器人类型</label>
                  <select v-model="form.bot_channel" class="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-100 text-xs">
                    <option value="feishu">飞书机器人</option>
                    <option value="qq">QQ机器人</option>
                  </select>
                </div>

                <template v-if="form.bot_channel === 'feishu'">
                <label class="flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-300 px-2 py-2 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/60">
                  <span>启用飞书机器人</span>
                  <input type="checkbox" v-model="form.bot_configs.feishu.enabled" />
                </label>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div class="md:col-span-2">
                    <label class="block text-[11px] text-zinc-500 mb-1">自定义群机器人 仅通知 URL</label>
                    <input v-model="form.bot_configs.feishu.webhook_url" class="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-100 text-xs" placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..." />
                  </div>
                  <div>
                    <label class="block text-[11px] text-zinc-500 mb-1">App ID</label>
                    <input v-model="form.bot_configs.feishu.app_id" class="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-100 text-xs" placeholder="cli_xxx" />
                  </div>
                  <div>
                    <label class="block text-[11px] text-zinc-500 mb-1">App Secret</label>
                    <input v-model="form.bot_configs.feishu.app_secret" type="password" class="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-100 text-xs" />
                  </div>
                  <div>
                    <label class="block text-[11px] text-zinc-500 mb-1">Verification Token</label>
                    <input v-model="form.bot_configs.feishu.verification_token" class="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-100 text-xs" />
                  </div>
                  <div>
                    <label class="block text-[11px] text-zinc-500 mb-1">默认接收 ID 类型</label>
                    <select v-model="form.bot_configs.feishu.default_receive_id_type" class="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-100 text-xs">
                      <option value="chat_id">chat_id</option>
                      <option value="open_id">open_id</option>
                      <option value="user_id">user_id</option>
                      <option value="union_id">union_id</option>
                      <option value="email">email</option>
                    </select>
                  </div>
                  <div class="md:col-span-2">
                    <label class="block text-[11px] text-zinc-500 mb-1">默认接收 ID（AI 主动通知时使用）</label>
                    <input v-model="form.bot_configs.feishu.default_receive_id" class="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-100 text-xs" placeholder="群聊 chat_id 或用户 open_id" />
                  </div>
                </div>
                <div class="text-[11px] text-zinc-500 dark:text-zinc-400">
                  仅通知 URL 只能让 AI 主动发通知；飞书用户主动与 AI 对话需要配置自建应用 App ID / Secret，并在飞书开放平台的事件订阅里选择“使用长连接接收事件”。启用后请在 MCP 工具权限中勾选 <span class="font-mono">message.send_to_user</span>。
                </div>
                </template>

                <template v-else>
                <label class="flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-300 px-2 py-2 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/60">
                  <span>启用 QQ机器人</span>
                  <input type="checkbox" v-model="form.bot_configs.qq.enabled" />
                </label>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label class="block text-[11px] text-zinc-500 mb-1">App ID</label>
                    <input v-model="form.bot_configs.qq.app_id" class="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-100 text-xs" placeholder="开放平台机器人 AppID" />
                  </div>
                  <div>
                    <label class="block text-[11px] text-zinc-500 mb-1">App Secret</label>
                    <input v-model="form.bot_configs.qq.app_secret" type="password" class="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-100 text-xs" />
                  </div>
                  <label class="md:col-span-2 flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-300 px-2 py-2 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/60">
                    <span>使用沙箱环境</span>
                    <input type="checkbox" v-model="form.bot_configs.qq.sandbox" />
                  </label>
                  <div>
                    <label class="block text-[11px] text-zinc-500 mb-1">主动发送目标 ID（可选）</label>
                    <input v-model="form.bot_configs.qq.default_target_id" class="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-100 text-xs" placeholder="openid / group_openid / channel_id" />
                  </div>
                </div>
                <div class="text-[11px] text-zinc-500 dark:text-zinc-400">
                  QQ 入站现在由服务端的 botpy 长连接托管，不需要单独配置回调地址。如果未连接，请先确认 App ID / Secret 和机器人权限配置正确。
                </div>
                </template>
              </div>

              <div v-else-if="settingsSection === 'auto'" class="space-y-3">
                <label class="flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-300">
                  <span>启用系统自动控制</span>
                  <input type="checkbox" v-model="form.system_auto_control.enabled" />
                </label>
                <div>
                  <label class="block text-[11px] text-zinc-500 mb-1">启动执行任务提示词</label>
                  <textarea
                    v-model="form.system_auto_control.start_task_prompt"
                    rows="2"
                    class="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-100 text-xs"
                  ></textarea>
                </div>
                <div>
                  <label class="block text-[11px] text-zinc-500 mb-1">继续被暂停任务提示词</label>
                  <textarea
                    v-model="form.system_auto_control.resume_task_prompt"
                    rows="2"
                    class="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-100 text-xs"
                  ></textarea>
                </div>
                <div>
                  <label class="block text-[11px] text-zinc-500 mb-1">任务监督提示词（AI 未标记完成时自动追问）</label>
                  <textarea
                    v-model="form.system_auto_control.supervision_prompt"
                    rows="2"
                    class="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-100 text-xs"
                  ></textarea>
                </div>
                <div>
                  <label class="block text-[11px] text-zinc-500 mb-1">传承提示文案（阈值默认使用上方 Token 上限）</label>
                  <textarea
                    v-model="form.system_auto_control.inheritance_notice"
                    rows="2"
                    class="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-100 text-xs"
                  ></textarea>
                </div>

                <div class="pt-1 border-t border-zinc-200 dark:border-zinc-700 text-[11px] text-zinc-500 dark:text-zinc-400">
                  任务列表已迁移到 AI 卡片下方，点击“任务列表”按钮可查看按优先级排序和执行状态。
                </div>
              </div>
            </div>
          </div>
        </div>
      </Transition>

      <Transition name="fade">
        <div
          v-if="promptDetailOpen"
          class="fixed inset-0 z-[110] bg-black/40 flex items-center justify-center p-4"
          @click.stop="closePromptDetail"
        >
          <div class="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-700 shadow-xl w-full max-w-5xl h-[82vh] flex flex-col" @click.stop>
            <div class="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
              <div class="min-w-0">
                <h4 class="text-sm font-semibold text-zinc-800 dark:text-zinc-100 truncate">Prompt 详情</h4>
                <div class="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">{{ form.name || '未命名 AI' }}</div>
              </div>
              <button class="text-xs px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-300" @click="closePromptDetail">关闭</button>
            </div>
            <div class="flex-1 min-h-0 p-4">
              <textarea
                v-model="form.prompt"
                class="w-full h-full resize-none px-3 py-2 rounded-lg border border-zinc-200 font-mono text-xs leading-5 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:bg-zinc-950 dark:border-zinc-700 dark:text-zinc-100"
              ></textarea>
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </Transition>
</template>
