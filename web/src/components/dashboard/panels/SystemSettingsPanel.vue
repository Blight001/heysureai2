<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getMcpToolZhLabel, groupMcpToolsBySource } from '@/utils/mcpTools'
import AppIcon from '@/components/common/AppIcon.vue'
import { useUiEffects } from '@/composables/useUiEffects'
import type { McpRoleMeta, ModelPreset } from '@/types'

interface Props {
  show: boolean
  globalMcpCallMethod: string
  mcpNamespaceHints: string
  mcpDynamicRule: string
  globalMcpFormatErrorHint: string
  defaultStartTaskPrompt: string
  defaultResumeTaskPrompt: string
  defaultSupervisionPrompt: string
  defaultSupervisionIdleSeconds: number
  defaultCompressionPrompt: string
  promptAiMessageNotify: string
  promptAiMessageInquiry: string
  aiMessageInquiryReminderSeconds: number
  promptAiMessageInquiryReminder: string
  promptAiMessageReply: string
  promptAiMessageChitchat: string
  promptAiMessageReplySuccess: string
  promptUserMessageNotice: string
  themeMode: 'light' | 'dark'
  fontSize: 'sm' | 'md' | 'lg'
  tavilyApiKey: string
  modelPresets: ModelPreset[]
  mcpMaxSteps: number
  mcpRoleMeta: McpRoleMeta
  roleMcpPermissions: Record<string, string[]>
}

const props = defineProps<Props>()

const { effects, setParticles, setMouseGlow } = useUiEffects()
const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
  (e: 'update:globalMcpCallMethod', value: string): void
  (e: 'update:mcpNamespaceHints', value: string): void
  (e: 'update:mcpDynamicRule', value: string): void
  (e: 'update:globalMcpFormatErrorHint', value: string): void
  (e: 'update:defaultStartTaskPrompt', value: string): void
  (e: 'update:defaultResumeTaskPrompt', value: string): void
  (e: 'update:defaultSupervisionPrompt', value: string): void
  (e: 'update:defaultSupervisionIdleSeconds', value: number): void
  (e: 'update:defaultCompressionPrompt', value: string): void
  (e: 'update:promptAiMessageNotify', value: string): void
  (e: 'update:promptAiMessageInquiry', value: string): void
  (e: 'update:aiMessageInquiryReminderSeconds', value: number): void
  (e: 'update:promptAiMessageInquiryReminder', value: string): void
  (e: 'update:promptAiMessageReply', value: string): void
  (e: 'update:promptAiMessageChitchat', value: string): void
  (e: 'update:promptAiMessageReplySuccess', value: string): void
  (e: 'update:promptUserMessageNotice', value: string): void
  (e: 'update:themeMode', value: 'light' | 'dark'): void
  (e: 'update:fontSize', value: 'sm' | 'md' | 'lg'): void
  (e: 'update:tavilyApiKey', value: string): void
  (e: 'update:modelPresets', value: ModelPreset[]): void
  (e: 'update:mcpMaxSteps', value: number): void
  (e: 'toggleRoleTool', payload: { role: string; tool: string; checked: boolean }): void
  (e: 'setRoleAllTools', payload: { role: string; checked: boolean }): void
  (e: 'resetRoleMcpPermissions'): void
  (e: 'save'): void
}>()

const roleTiers = computed(() => props.mcpRoleMeta?.order || [])
const roleLabel = (role: string) => props.mcpRoleMeta?.labels?.[role] || role
const roleOptionTools = (role: string) =>
  props.mcpRoleMeta?.options?.[role] || props.mcpRoleMeta?.defaults?.[role] || []
const roleSourceGroups = (role: string) => groupMcpToolsBySource(roleOptionTools(role))
const isRoleToolChecked = (role: string, tool: string) =>
  (props.roleMcpPermissions?.[role] || []).includes(tool)
const roleAllChecked = (role: string) => {
  const options = roleOptionTools(role)
  return options.length > 0 && options.every(tool => isRoleToolChecked(role, tool))
}
const toolsAllChecked = (role: string, tools: string[]) =>
  tools.length > 0 && tools.every(tool => isRoleToolChecked(role, tool))
const onRoleToolChange = (role: string, tool: string, event: Event) => {
  const target = event.target as HTMLInputElement | null
  emit('toggleRoleTool', { role, tool, checked: !!target?.checked })
}
const onRoleAllChange = (role: string, event: Event) => {
  const target = event.target as HTMLInputElement | null
  emit('setRoleAllTools', { role, checked: !!target?.checked })
}
const onRoleToolsChange = (role: string, tools: string[], event: Event) => {
  const target = event.target as HTMLInputElement | null
  const checked = !!target?.checked
  const optionSet = new Set(roleOptionTools(role))
  tools
    .filter(tool => optionSet.has(tool))
    .forEach(tool => emit('toggleRoleTool', { role, tool, checked }))
}

const themeModeValue = computed({
  get: () => props.themeMode,
  set: value => emit('update:themeMode', value)
})

const fontSizeValue = computed({
  get: () => props.fontSize,
  set: value => emit('update:fontSize', value)
})

const tavilyApiKeyValue = computed({
  get: () => props.tavilyApiKey,
  set: value => emit('update:tavilyApiKey', value)
})

const modelPresetsValue = computed({
  get: () => props.modelPresets || [],
  set: value => emit('update:modelPresets', value)
})

const expandedModelPresetIds = ref<Set<string>>(new Set())
const isModelPresetComplete = (preset: ModelPreset) =>
  !!String(preset.name || '').trim()
  && !!String(preset.model || '').trim()
  && !!String(preset.api_key || '').trim()
  && !!String(preset.base_url || '').trim()
const modelPresetKey = (preset: ModelPreset, index: number) => preset.id || `model_${index}`
const isModelPresetExpanded = (preset: ModelPreset, index: number) =>
  expandedModelPresetIds.value.has(modelPresetKey(preset, index)) || !isModelPresetComplete(preset)
const setModelPresetExpanded = (preset: ModelPreset, index: number, expanded: boolean) => {
  const next = new Set(expandedModelPresetIds.value)
  const key = modelPresetKey(preset, index)
  if (expanded) next.add(key)
  else next.delete(key)
  expandedModelPresetIds.value = next
}

const addModelPreset = () => {
  const id = `model_${Date.now()}`
  const next = new Set(expandedModelPresetIds.value)
  next.add(id)
  expandedModelPresetIds.value = next
  modelPresetsValue.value = [
    ...modelPresetsValue.value,
    { id, name: '新模型', api_key: '', base_url: '', model: '' },
  ]
}

const updateModelPreset = (index: number, patch: Partial<ModelPreset>) => {
  modelPresetsValue.value = modelPresetsValue.value.map((item, idx) => {
    if (idx !== index) return item
    const next = { ...item, ...patch }
    if (!next.id) next.id = next.model || `model_${index + 1}`
    if (isModelPresetComplete(next) && !isModelPresetComplete(item)) {
      const expanded = new Set(expandedModelPresetIds.value)
      expanded.delete(modelPresetKey(next, index))
      expandedModelPresetIds.value = expanded
    }
    return next
  })
}

const removeModelPreset = (index: number) => {
  const target = modelPresetsValue.value[index]
  if (target) {
    const expanded = new Set(expandedModelPresetIds.value)
    expanded.delete(modelPresetKey(target, index))
    expandedModelPresetIds.value = expanded
  }
  modelPresetsValue.value = modelPresetsValue.value.filter((_, idx) => idx !== index)
}

const mcpMaxStepsValue = computed({
  get: () => Number(props.mcpMaxSteps || 48),
  set: value => emit('update:mcpMaxSteps', Math.max(1, Math.min(999, Math.floor(Number(value) || 48))))
})

type SettingsDialog = '' | 'models' | 'roles'

const settingsDialog = ref<SettingsDialog>('')
const selectedRole = ref('')

const openSettingsDialog = (name: Exclude<SettingsDialog, ''>) => {
  settingsDialog.value = name
  selectedRole.value = ''
}

const closeSettingsDialog = () => {
  settingsDialog.value = ''
  selectedRole.value = ''
}

const openRoleDialog = (role: string) => {
  selectedRole.value = role
}

const settingsDialogTitles: Record<Exclude<SettingsDialog, ''>, string> = {
  models: '服务器模型',
  roles: 'MCP 角色权限',
}

const settingsDialogTitle = computed(() => {
  if (!settingsDialog.value) return ''
  return settingsDialogTitles[settingsDialog.value]
})

watch(() => props.show, visible => {
  if (!visible) {
    settingsDialog.value = ''
    selectedRole.value = ''
    expandedModelPresetIds.value = new Set()
  }
})

const openExtensionTestPage = () => {
  window.open(`${window.location.origin}/extension-test/`, '_blank', 'noopener,noreferrer')
}
</script>

<template>
  <Transition name="fade">
    <div v-if="show" class="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center backdrop-blur-sm" @click="emit('update:show', false)">
      <div class="bg-white rounded-2xl shadow-xl w-[560px] max-h-[90vh] overflow-y-auto p-6 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800" @click.stop>
        <div class="flex items-center justify-between mb-6">
          <h3 class="text-lg font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <AppIcon name="gear" class="w-5 h-5" /> 系统全能设置
          </h3>
          <button @click="emit('update:show', false)" class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div class="space-y-6">
          <div class="p-4 bg-zinc-50 rounded-xl dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800">
            <h4 class="text-sm font-semibold text-zinc-800 mb-3 dark:text-zinc-100 flex items-center gap-2"><AppIcon name="palette" class="w-4 h-4" /> 界面偏好</h4>
            <div class="grid grid-cols-2 gap-6">
              <div>
                <div class="text-xs text-zinc-500 mb-2 dark:text-zinc-400">主题模式</div>
                <div class="flex gap-2">
                  <button v-for="mode in (['light', 'dark'] as const)" :key="mode" @click="themeModeValue = mode" class="flex-1 px-3 py-1.5 rounded-lg border text-xs transition-all" :class="themeModeValue === mode ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' : 'border-zinc-200 text-zinc-500 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-400'">
                    <span class="inline-flex items-center justify-center gap-1.5"><AppIcon :name="mode === 'light' ? 'sun' : 'moon'" class="w-3.5 h-3.5" />{{ mode === 'light' ? '亮色' : '暗色' }}</span>
                  </button>
                </div>
              </div>
              <div>
                <div class="text-xs text-zinc-500 mb-2 dark:text-zinc-400">文字大小</div>
                <div class="flex gap-1">
                  <button v-for="size in (['sm', 'md', 'lg'] as const)" :key="size" @click="fontSizeValue = size" class="flex-1 px-2 py-1.5 rounded-lg border text-xs transition-all" :class="fontSizeValue === size ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' : 'border-zinc-200 text-zinc-500 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-400'">
                    {{ size === 'sm' ? '小' : size === 'md' ? '中' : '大' }}
                  </button>
                </div>
              </div>
            </div>
            <div class="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-700">
              <div class="text-xs text-zinc-500 mb-2 dark:text-zinc-400">动态效果</div>
              <div class="grid grid-cols-2 gap-2">
                <button
                  @click="setParticles(!effects.particles)"
                  class="px-3 py-2 rounded-lg border text-xs transition-all flex items-center justify-between gap-2"
                  :class="effects.particles ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' : 'border-zinc-200 text-zinc-500 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-400'"
                >
                  <span class="inline-flex items-center gap-1.5"><AppIcon name="sparkles" class="w-3.5 h-3.5" />背景粒子</span>
                  <span class="text-[10px] font-semibold">{{ effects.particles ? '开' : '关' }}</span>
                </button>
                <button
                  @click="setMouseGlow(!effects.mouseGlow)"
                  class="px-3 py-2 rounded-lg border text-xs transition-all flex items-center justify-between gap-2"
                  :class="effects.mouseGlow ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' : 'border-zinc-200 text-zinc-500 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-400'"
                >
                  <span class="inline-flex items-center gap-1.5"><AppIcon name="compass" class="w-3.5 h-3.5" />鼠标互动</span>
                  <span class="text-[10px] font-semibold">{{ effects.mouseGlow ? '开' : '关' }}</span>
                </button>
              </div>
              <p class="mt-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">背景粒子星座与鼠标跟随光晕 / 粒子联动，全站即时生效。</p>
            </div>
          </div>

          <div class="p-4 bg-zinc-50 rounded-xl dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800">
            <h4 class="text-sm font-semibold text-zinc-800 mb-3 dark:text-zinc-100 flex items-center gap-2">工作区与 MCP</h4>
            <div class="space-y-3">
              <div>
                <div class="text-xs text-zinc-500 mb-1 dark:text-zinc-400">Tavily API Key（联网搜索 MCP）</div>
                <input
                  v-model="tavilyApiKeyValue"
                  type="password"
                  autocomplete="off"
                  class="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-100 transition-all text-xs"
                  placeholder="tvly-..."
                />
                <p class="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">供 <code>workspace.search</code> 调用 Tavily 搜索；仍需在 MCP 权限中为对应 AI 勾选该工具。</p>
              </div>
              <div>
              <div class="text-xs text-zinc-500 mb-1 dark:text-zinc-400">单次运行最多步骤 / MCP 续跑次数</div>
              <input
                v-model.number="mcpMaxStepsValue"
                type="number"
                min="1"
                max="999"
                class="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-100 transition-all text-xs"
              />
              <p class="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">范围 1-999。连续调用 MCP 工具时，每次模型生成和工具返回后的继续执行都会消耗一步。</p>
              </div>
            </div>
          </div>

          <div class="p-4 bg-zinc-50 rounded-xl dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800">
            <h4 class="text-sm font-semibold text-zinc-800 mb-3 dark:text-zinc-100 flex items-center gap-2">
              <AppIcon name="globe" class="w-4 h-4" /> 浏览器插件
            </h4>
            <button
              type="button"
              class="settings-entry"
              @click="openExtensionTestPage"
            >
              <span>
                <span class="settings-entry-title">打开插件测试页</span>
                <span class="settings-entry-desc">在新标签页打开静态测试页，覆盖 observe / 点击 / 输入 / 滚动 / 拖拽 / 等待 / 提取等 MCP 场景</span>
              </span>
              <span class="settings-entry-arrow">↗</span>
            </button>
          </div>

          <div class="grid grid-cols-1 gap-3">
            <button
              class="settings-entry"
              @click="openSettingsDialog('models')"
            >
              <span>
                <span class="settings-entry-title">服务器模型</span>
                <span class="settings-entry-desc">已配置 {{ modelPresetsValue.length }} 个模型，点击查看和编辑具体 API 配置</span>
              </span>
              <span class="settings-entry-arrow">›</span>
            </button>
            <button
              class="settings-entry"
              @click="openSettingsDialog('roles')"
            >
              <span>
                <span class="settings-entry-title inline-flex items-center gap-1.5"><AppIcon name="shield" class="w-3.5 h-3.5" />MCP 角色权限</span>
                <span class="settings-entry-desc">工作区栏目中的 MCP 工具授权，包含联网搜索</span>
              </span>
              <span class="settings-entry-arrow">›</span>
            </button>
          </div>
        </div>

        <div class="mt-8 pt-4 border-t border-zinc-100 dark:border-zinc-800 flex justify-end">
          <button @click="emit('save'); emit('update:show', false)" class="px-6 py-2 bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 rounded-xl text-sm font-bold hover:opacity-90 active:scale-95 transition-all shadow-lg">完成</button>
        </div>
      </div>

      <Transition name="fade">
        <div
          v-if="settingsDialog"
          class="fixed inset-0 z-[70] bg-black/45 flex items-center justify-center p-4 backdrop-blur-sm"
          @click.stop="closeSettingsDialog"
        >
          <div
            class="bg-white rounded-2xl shadow-2xl w-[860px] max-w-[94vw] max-h-[88vh] flex flex-col dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
            @click.stop
          >
            <div class="flex items-center justify-between px-5 py-4 border-b border-zinc-100 dark:border-zinc-800">
              <h3 class="text-base font-bold text-zinc-900 dark:text-zinc-100">{{ settingsDialogTitle }}</h3>
              <button @click="closeSettingsDialog" class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div class="flex-1 overflow-y-auto px-5 py-4">
              <div v-if="settingsDialog === 'models'" class="space-y-4">
                <div class="flex items-center justify-between gap-3">
                  <p class="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                    服务器模型会作为 AI 配置中的可选模型来源。修改后点击“完成并保存”写入系统设置。
                  </p>
                  <button
                    class="shrink-0 px-3 py-1.5 rounded-lg border border-zinc-200 text-zinc-600 bg-white text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
                    @click="addModelPreset"
                  >
                    新增模型
                  </button>
                </div>
                <div class="space-y-3">
                  <div
                    v-for="(preset, index) in modelPresetsValue"
                    :key="preset.id || index"
                    class="rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-950/60 overflow-hidden"
                  >
                    <button
                      type="button"
                      class="w-full px-3 py-2.5 flex items-center justify-between gap-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900"
                      @click="setModelPresetExpanded(preset, index, !isModelPresetExpanded(preset, index))"
                    >
                      <span class="min-w-0">
                        <span class="block text-xs font-semibold text-zinc-800 dark:text-zinc-100 truncate">
                          {{ preset.name || preset.model || '未命名模型' }}
                        </span>
                        <span class="block mt-0.5 text-[10px] text-zinc-500 dark:text-zinc-400 truncate">
                          {{ preset.base_url || '未配置 Base URL' }}
                        </span>
                        <span v-if="!isModelPresetComplete(preset)" class="block mt-0.5 text-[10px] text-amber-600 dark:text-amber-300">配置未完成</span>
                      </span>
                      <span class="text-xs text-zinc-400 dark:text-zinc-500">
                        {{ isModelPresetExpanded(preset, index) ? '收起' : '修改' }}
                      </span>
                    </button>
                    <div v-if="isModelPresetExpanded(preset, index)" class="px-3 pb-3 border-t border-zinc-100 dark:border-zinc-800">
                      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3">
                        <div>
                          <div class="text-xs text-zinc-500 mb-1 dark:text-zinc-400">显示名称</div>
                          <input :value="preset.name" @input="updateModelPreset(index, { name: ($event.target as HTMLInputElement).value })" class="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-100 text-xs" />
                        </div>
                        <div>
                          <div class="text-xs text-zinc-500 mb-1 dark:text-zinc-400">模型名</div>
                          <input :value="preset.model" @input="updateModelPreset(index, { model: ($event.target as HTMLInputElement).value, id: preset.id || ($event.target as HTMLInputElement).value })" class="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-100 text-xs" />
                        </div>
                        <div>
                          <div class="text-xs text-zinc-500 mb-1 dark:text-zinc-400">API Key</div>
                          <input :value="preset.api_key" type="password" autocomplete="off" @input="updateModelPreset(index, { api_key: ($event.target as HTMLInputElement).value })" class="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-100 text-xs" />
                        </div>
                        <div>
                          <div class="text-xs text-zinc-500 mb-1 dark:text-zinc-400">Base URL</div>
                          <input :value="preset.base_url" @input="updateModelPreset(index, { base_url: ($event.target as HTMLInputElement).value })" class="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-100 text-xs" placeholder="https://.../chat/completions" />
                        </div>
                      </div>
                      <div class="mt-2 flex justify-end gap-2">
                        <button class="text-[11px] px-2 py-1 rounded border border-red-200 text-red-600 bg-red-50 dark:border-red-500/30 dark:bg-red-900/20 dark:text-red-300" @click="removeModelPreset(index)">删除</button>
                        <button
                          class="text-[11px] px-2 py-1 rounded border border-zinc-200 text-zinc-600 bg-white dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                          @click="setModelPresetExpanded(preset, index, false); emit('save')"
                        >
                          完成并保存
                        </button>
                      </div>
                    </div>
                  </div>
                  <div v-if="modelPresetsValue.length === 0" class="text-xs text-zinc-500 dark:text-zinc-400">暂无模型，请先新增一个服务器模型。</div>
                </div>
              </div>

              <div v-else-if="settingsDialog === 'roles'" class="space-y-4">
                <div class="flex items-center justify-between">
                  <p class="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed pr-2">
                    为每类角色设置可用的 MCP 工具范围。每个角色都可查看全部 MCP 工具，默认只勾选适合该角色的常用工具；各 AI 成员保存配置时会自动收敛到所属角色允许的工具。
                  </p>
                  <button
                    class="shrink-0 px-2 py-1 rounded-lg border border-zinc-200 text-zinc-500 bg-white text-[11px] hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
                    @click="emit('resetRoleMcpPermissions')"
                  >
                    恢复默认
                  </button>
                </div>
                <div v-if="roleTiers.length === 0" class="text-xs text-zinc-500 dark:text-zinc-400">正在加载角色权限…</div>
                <div class="grid grid-cols-1 gap-3">
                  <button
                  v-for="role in roleTiers"
                  :key="`role-${role}`"
                    type="button"
                    class="settings-entry bg-white/80 dark:bg-zinc-950/50"
                    @click="openRoleDialog(role)"
                >
                    <span>
                      <span class="settings-entry-title">{{ roleLabel(role) }}</span>
                      <span class="settings-entry-desc">
                        已选 {{ (roleMcpPermissions[role] || []).length }} / 可用 {{ roleOptionTools(role).length }} 个 MCP 工具
                      </span>
                    </span>
                    <span class="flex items-center gap-3">
                      <span class="flex items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400" @click.stop>
                        <input
                          type="checkbox"
                          :checked="roleAllChecked(role)"
                          @click.stop
                          @change.stop="onRoleAllChange(role, $event)"
                        />
                        <span>全选</span>
                      </span>
                      <span class="settings-entry-arrow">›</span>
                    </span>
                  </button>
                </div>
              </div>

            </div>

            <div class="px-5 py-4 border-t border-zinc-100 dark:border-zinc-800 flex justify-end">
              <button @click="closeSettingsDialog" class="px-4 py-2 bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 rounded-xl text-sm font-bold hover:opacity-90 active:scale-95 transition-all">确定</button>
            </div>
          </div>

          <Transition name="fade">
            <div
              v-if="settingsDialog === 'roles' && selectedRole"
              class="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-4 backdrop-blur-sm"
              @click.stop="selectedRole = ''"
            >
              <div
                class="bg-white rounded-2xl shadow-2xl w-[760px] max-w-[94vw] max-h-[82vh] flex flex-col dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
                @click.stop
              >
                <div class="flex items-center justify-between px-5 py-4 border-b border-zinc-100 dark:border-zinc-800">
                  <div>
                    <h3 class="text-base font-bold text-zinc-900 dark:text-zinc-100">{{ roleLabel(selectedRole) }}</h3>
                    <div class="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                      已选 {{ (roleMcpPermissions[selectedRole] || []).length }} / 可用 {{ roleOptionTools(selectedRole).length }}
                    </div>
                  </div>
                  <div class="flex items-center gap-3">
                    <label class="flex items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                      <input
                        type="checkbox"
                        :checked="roleAllChecked(selectedRole)"
                        @change="onRoleAllChange(selectedRole, $event)"
                      />
                      <span>全选</span>
                    </label>
                    <button @click="selectedRole = ''" class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div class="flex-1 overflow-y-auto px-5 py-4">
                  <div class="space-y-3">
                    <details
                      v-for="source in roleSourceGroups(selectedRole)"
                      :key="`${selectedRole}-mcp-source-${source.source}`"
                      open
                      class="rounded-lg border border-zinc-200 bg-white/80 dark:border-zinc-700 dark:bg-zinc-950/60"
                    >
                      <summary class="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-zinc-700 dark:text-zinc-200 flex items-center justify-between gap-3">
                        <span>{{ source.title }}</span>
                        <span class="flex items-center gap-3">
                          <span class="text-[10px] font-normal text-zinc-400 dark:text-zinc-500">
                            {{ source.tools.filter(tool => isRoleToolChecked(selectedRole, tool)).length }} / {{ source.tools.length }}
                          </span>
                          <span class="flex items-center gap-1 text-[10px] font-normal text-zinc-500 dark:text-zinc-400" @click.stop>
                            <input
                              type="checkbox"
                              :checked="toolsAllChecked(selectedRole, source.tools)"
                              @click.stop
                              @change.stop="onRoleToolsChange(selectedRole, source.tools, $event)"
                            />
                            <span>全选</span>
                          </span>
                        </span>
                      </summary>
                      <div class="px-2 pb-2">
                        <details
                          v-for="parent in source.parentGroups"
                          :key="`${selectedRole}-${source.source}-mcp-parent-${parent.title}`"
                          class="mb-2 rounded-lg border border-zinc-200 bg-zinc-50/70 last:mb-0 dark:border-zinc-700 dark:bg-zinc-800/40"
                        >
                          <summary class="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-zinc-700 dark:text-zinc-200 flex items-center justify-between gap-3">
                            <span>{{ parent.title }}</span>
                            <span class="flex items-center gap-3">
                              <span class="text-[10px] font-normal text-zinc-400 dark:text-zinc-500">
                                {{ parent.tools.filter(tool => isRoleToolChecked(selectedRole, tool)).length }} / {{ parent.tools.length }}
                              </span>
                              <span class="flex items-center gap-1 text-[10px] font-normal text-zinc-500 dark:text-zinc-400" @click.stop>
                                <input
                                  type="checkbox"
                                  :checked="toolsAllChecked(selectedRole, parent.tools)"
                                  @click.stop
                                  @change.stop="onRoleToolsChange(selectedRole, parent.tools, $event)"
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
                              <label
                                v-for="tool in parent.groups[0].tools"
                                :key="`${selectedRole}-${source.source}-${tool}`"
                                class="text-xs text-zinc-600 dark:text-zinc-300 flex items-start gap-2"
                              >
                                <input
                                  type="checkbox"
                                  class="mt-0.5"
                                  :checked="isRoleToolChecked(selectedRole, tool)"
                                  @change="onRoleToolChange(selectedRole, tool, $event)"
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
                              :key="`${selectedRole}-${source.source}-${parent.title}-${group.tag}`"
                              class="rounded-lg border border-zinc-200 bg-white/80 dark:border-zinc-700 dark:bg-zinc-900/60"
                            >
                              <summary class="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-zinc-700 dark:text-zinc-200 flex items-center justify-between gap-3">
                                <span>{{ group.tag }}</span>
                                <span class="text-[10px] font-normal text-zinc-400 dark:text-zinc-500">
                                  {{ group.tools.filter(tool => isRoleToolChecked(selectedRole, tool)).length }} / {{ group.tools.length }}
                                </span>
                              </summary>
                              <div class="grid grid-cols-1 md:grid-cols-2 gap-2 px-2 pb-2">
                                <label
                                  v-for="tool in group.tools"
                                  :key="`${selectedRole}-${source.source}-${tool}`"
                                  class="text-xs text-zinc-600 dark:text-zinc-300 flex items-start gap-2"
                                >
                                  <input
                                    type="checkbox"
                                    class="mt-0.5"
                                    :checked="isRoleToolChecked(selectedRole, tool)"
                                    @change="onRoleToolChange(selectedRole, tool, $event)"
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
                    <div v-if="roleOptionTools(selectedRole).length === 0" class="text-[11px] text-zinc-500 dark:text-zinc-400">该角色暂无可分配的工具</div>
                  </div>
                </div>

                <div class="px-5 py-4 border-t border-zinc-100 dark:border-zinc-800 flex justify-end">
                  <button @click="selectedRole = ''" class="px-4 py-2 bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 rounded-xl text-sm font-bold hover:opacity-90 active:scale-95 transition-all">确定</button>
                </div>
              </div>
            </div>
          </Transition>
        </div>
      </Transition>
    </div>
  </Transition>
</template>

<style scoped>
.settings-entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 14px 16px;
  border: 1px solid rgb(228 228 231);
  border-radius: 12px;
  background: rgb(250 250 250);
  text-align: left;
  transition: border-color 160ms ease, background-color 160ms ease, transform 160ms ease;
}

.settings-entry:hover {
  border-color: rgb(165 180 252);
  background: rgb(255 255 255);
  transform: translateY(-1px);
}

.dark .settings-entry {
  border-color: rgb(63 63 70);
  background: rgba(39, 39, 42, 0.5);
}

.dark .settings-entry:hover {
  border-color: rgba(129, 140, 248, 0.55);
  background: rgba(39, 39, 42, 0.85);
}

.settings-entry-title {
  display: block;
  color: rgb(39 39 42);
  font-size: 13px;
  font-weight: 700;
}

.dark .settings-entry-title {
  color: rgb(244 244 245);
}

.settings-entry-desc {
  display: block;
  margin-top: 4px;
  color: rgb(113 113 122);
  font-size: 11px;
}

.dark .settings-entry-desc {
  color: rgb(161 161 170);
}

.settings-entry-arrow {
  flex: 0 0 auto;
  color: rgb(113 113 122);
  font-size: 24px;
  line-height: 1;
}
</style>
