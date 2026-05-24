<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getMcpToolZhLabel, groupMcpToolsBySource } from '@/utils/mcpTools'
import type { McpRoleMeta } from '@/types'

interface Props {
  show: boolean
  globalMcpCallMethod: string
  globalMcpFormatErrorHint: string
  defaultStartTaskPrompt: string
  defaultResumeTaskPrompt: string
  defaultSupervisionPrompt: string
  defaultSupervisionIdleSeconds: number
  defaultInheritanceNotice: string
  promptAiMessageInbound: string
  promptAiMessageReplySuccess: string
  promptUserMessageNotice: string
  themeMode: 'light' | 'dark'
  fontSize: 'sm' | 'md' | 'lg'
  mcpMaxSteps: number
  mcpRoleMeta: McpRoleMeta
  roleMcpPermissions: Record<string, string[]>
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
  (e: 'update:globalMcpCallMethod', value: string): void
  (e: 'update:globalMcpFormatErrorHint', value: string): void
  (e: 'update:defaultStartTaskPrompt', value: string): void
  (e: 'update:defaultResumeTaskPrompt', value: string): void
  (e: 'update:defaultSupervisionPrompt', value: string): void
  (e: 'update:defaultSupervisionIdleSeconds', value: number): void
  (e: 'update:defaultInheritanceNotice', value: string): void
  (e: 'update:promptAiMessageInbound', value: string): void
  (e: 'update:promptAiMessageReplySuccess', value: string): void
  (e: 'update:promptUserMessageNotice', value: string): void
  (e: 'update:themeMode', value: 'light' | 'dark'): void
  (e: 'update:fontSize', value: 'sm' | 'md' | 'lg'): void
  (e: 'update:mcpMaxSteps', value: number): void
  (e: 'viewAllMcp'): void
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

const mcpMaxStepsValue = computed({
  get: () => Number(props.mcpMaxSteps || 48),
  set: value => emit('update:mcpMaxSteps', Math.max(1, Math.min(999, Math.floor(Number(value) || 48))))
})

const globalMcpCallMethodValue = computed({
  get: () => props.globalMcpCallMethod,
  set: value => emit('update:globalMcpCallMethod', value)
})

const globalMcpFormatErrorHintValue = computed({
  get: () => props.globalMcpFormatErrorHint,
  set: value => emit('update:globalMcpFormatErrorHint', value)
})

const defaultStartTaskPromptValue = computed({
  get: () => props.defaultStartTaskPrompt,
  set: value => emit('update:defaultStartTaskPrompt', value)
})

const defaultResumeTaskPromptValue = computed({
  get: () => props.defaultResumeTaskPrompt,
  set: value => emit('update:defaultResumeTaskPrompt', value)
})

const defaultSupervisionPromptValue = computed({
  get: () => props.defaultSupervisionPrompt,
  set: value => emit('update:defaultSupervisionPrompt', value)
})

const defaultSupervisionIdleSecondsValue = computed({
  get: () => Number(props.defaultSupervisionIdleSeconds || 25),
  set: value => emit('update:defaultSupervisionIdleSeconds', Number(value) || 25)
})

const defaultInheritanceNoticeValue = computed({
  get: () => props.defaultInheritanceNotice,
  set: value => emit('update:defaultInheritanceNotice', value)
})

const promptAiMessageInboundValue = computed({
  get: () => props.promptAiMessageInbound,
  set: value => emit('update:promptAiMessageInbound', value)
})

const promptAiMessageReplySuccessValue = computed({
  get: () => props.promptAiMessageReplySuccess,
  set: value => emit('update:promptAiMessageReplySuccess', value)
})

const promptUserMessageNoticeValue = computed({
  get: () => props.promptUserMessageNotice,
  set: value => emit('update:promptUserMessageNotice', value)
})

type SettingsDialog = '' | 'mcp' | 'roles' | 'prompts'

const settingsDialog = ref<SettingsDialog>('')

const openSettingsDialog = (name: Exclude<SettingsDialog, ''>) => {
  settingsDialog.value = name
}

const settingsDialogTitles: Record<Exclude<SettingsDialog, ''>, string> = {
  mcp: 'MCP 配置',
  roles: 'MCP 角色权限',
  prompts: '提示词配置',
}

const settingsDialogTitle = computed(() => {
  if (!settingsDialog.value) return ''
  return settingsDialogTitles[settingsDialog.value]
})

watch(() => props.show, visible => {
  if (!visible) settingsDialog.value = ''
})
</script>

<template>
  <Transition name="fade">
    <div v-if="show" class="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center backdrop-blur-sm" @click="emit('update:show', false)">
      <div class="bg-white rounded-2xl shadow-xl w-[560px] max-h-[90vh] overflow-y-auto p-6 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800" @click.stop>
        <div class="flex items-center justify-between mb-6">
          <h3 class="text-lg font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <span>⚙️</span> 系统全能设置
          </h3>
          <button @click="emit('update:show', false)" class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div class="space-y-6">
          <div class="p-4 bg-zinc-50 rounded-xl dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800">
            <h4 class="text-sm font-semibold text-zinc-800 mb-3 dark:text-zinc-100 flex items-center gap-2">🎨 界面偏好</h4>
            <div class="grid grid-cols-2 gap-6">
              <div>
                <div class="text-xs text-zinc-500 mb-2 dark:text-zinc-400">主题模式</div>
                <div class="flex gap-2">
                  <button v-for="mode in (['light', 'dark'] as const)" :key="mode" @click="themeModeValue = mode" class="flex-1 px-3 py-1.5 rounded-lg border text-xs transition-all" :class="themeModeValue === mode ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' : 'border-zinc-200 text-zinc-500 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-400'">
                    {{ mode === 'light' ? '✨ 亮色' : '🌙 暗色' }}
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
          </div>

          <div class="p-4 bg-zinc-50 rounded-xl dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800">
            <h4 class="text-sm font-semibold text-zinc-800 mb-3 dark:text-zinc-100 flex items-center gap-2">MCP 运行限制</h4>
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

          <div class="grid grid-cols-1 gap-3">
            <button
              class="settings-entry"
              @click="openSettingsDialog('mcp')"
            >
              <span>
                <span class="settings-entry-title">🧰 MCP 配置</span>
                <span class="settings-entry-desc">编辑全局 MCP 调用规范与格式错误提示</span>
              </span>
              <span class="settings-entry-arrow">›</span>
            </button>
            <button
              class="settings-entry"
              @click="openSettingsDialog('roles')"
            >
              <span>
                <span class="settings-entry-title">🛡️ MCP 角色权限</span>
                <span class="settings-entry-desc">为不同角色配置可用 MCP 工具范围</span>
              </span>
              <span class="settings-entry-arrow">›</span>
            </button>
            <button
              class="settings-entry"
              @click="openSettingsDialog('prompts')"
            >
              <span>
                <span class="settings-entry-title">🧭 提示词配置</span>
                <span class="settings-entry-desc">编辑任务启动、恢复、监督、传承，以及 AI 间通信与用户消息回执提示</span>
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
          @click.stop="settingsDialog = ''"
        >
          <div
            class="bg-white rounded-2xl shadow-2xl w-[860px] max-w-[94vw] max-h-[88vh] flex flex-col dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
            @click.stop
          >
            <div class="flex items-center justify-between px-5 py-4 border-b border-zinc-100 dark:border-zinc-800">
              <h3 class="text-base font-bold text-zinc-900 dark:text-zinc-100">{{ settingsDialogTitle }}</h3>
              <button @click="settingsDialog = ''" class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div class="flex-1 overflow-y-auto px-5 py-4">
              <div v-if="settingsDialog === 'mcp'" class="space-y-4">
                <div class="flex items-center justify-end">
                  <button
                    class="px-3 py-1.5 rounded-lg border border-indigo-200 text-indigo-600 bg-indigo-50 text-xs font-medium hover:bg-indigo-100 dark:border-indigo-500/40 dark:text-indigo-300 dark:bg-indigo-500/10 dark:hover:bg-indigo-500/20"
                    @click="emit('viewAllMcp')"
                  >
                    查看当前全部MCP
                  </button>
                </div>
                <div>
                  <div class="text-xs text-zinc-500 mb-1 dark:text-zinc-400">全局 MCP 调用规范</div>
                  <textarea
                    v-model="globalMcpCallMethodValue"
                    rows="14"
                    class="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:bg-zinc-950 dark:border-zinc-700 dark:text-zinc-100 transition-all text-xs leading-relaxed font-mono"
                    placeholder="粘贴全局 MCP 调用方法模板，例如包含 <mcp-call> ... </mcp-call>、Available MCP tools include: {MCP} 和 Rules"
                  ></textarea>
                </div>
                <div>
                  <div class="text-xs text-zinc-500 mb-1 dark:text-zinc-400">MCP 格式错误提示</div>
                  <textarea
                    v-model="globalMcpFormatErrorHintValue"
                    rows="10"
                    class="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:bg-zinc-950 dark:border-zinc-700 dark:text-zinc-100 transition-all text-xs leading-relaxed"
                    placeholder="当检测到 AI 试图调用 MCP 但格式错误时，自动回注的系统提示文案。可使用 {details}、{format_error_count} 等占位符。"
                  ></textarea>
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
                <details
                  v-for="role in roleTiers"
                  :key="`role-${role}`"
                  class="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white/70 dark:bg-zinc-950/50"
                >
                  <summary class="cursor-pointer select-none px-3 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-200 flex items-center justify-between gap-3">
                    <span>{{ roleLabel(role) }}</span>
                    <span class="flex items-center gap-3">
                      <span class="text-[10px] text-zinc-400 dark:text-zinc-500">{{ (roleMcpPermissions[role] || []).length }} / {{ roleOptionTools(role).length }}</span>
                      <span class="flex items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400" @click.stop>
                        <input
                          type="checkbox"
                          :checked="roleAllChecked(role)"
                          @click.stop
                          @change.stop="onRoleAllChange(role, $event)"
                        />
                        <span>全选</span>
                      </span>
                    </span>
                  </summary>
                  <div class="px-3 pb-3">
                    <div class="space-y-3 max-h-64 overflow-y-auto pr-1">
                      <details
                        v-for="source in roleSourceGroups(role)"
                        :key="`${role}-mcp-source-${source.source}`"
                        class="rounded-lg border border-zinc-200 bg-white/80 dark:border-zinc-700 dark:bg-zinc-950/60"
                      >
                        <summary class="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-zinc-700 dark:text-zinc-200 flex items-center justify-between gap-3">
                          <span>{{ source.title }}</span>
                          <span class="flex items-center gap-3">
                            <span class="text-[10px] font-normal text-zinc-400 dark:text-zinc-500">
                              {{ source.tools.filter(tool => isRoleToolChecked(role, tool)).length }} / {{ source.tools.length }}
                            </span>
                            <span class="flex items-center gap-1 text-[10px] font-normal text-zinc-500 dark:text-zinc-400" @click.stop>
                              <input
                                type="checkbox"
                                :checked="toolsAllChecked(role, source.tools)"
                                @click.stop
                                @change.stop="onRoleToolsChange(role, source.tools, $event)"
                              />
                              <span>全选</span>
                            </span>
                          </span>
                        </summary>
                        <div class="px-2 pb-2">
                          <details
                            v-for="group in source.groups"
                            :key="`${role}-${source.source}-mcp-group-${group.tag}`"
                            class="mb-2 rounded-lg border border-zinc-200 bg-zinc-50/70 last:mb-0 dark:border-zinc-700 dark:bg-zinc-800/40"
                          >
                            <summary class="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-zinc-700 dark:text-zinc-200 flex items-center justify-between gap-3">
                              <span>{{ group.tag }}</span>
                              <span class="flex items-center gap-3">
                                <span class="text-[10px] font-normal text-zinc-400 dark:text-zinc-500">
                                  {{ group.tools.filter(tool => isRoleToolChecked(role, tool)).length }} / {{ group.tools.length }}
                                </span>
                                <span class="flex items-center gap-1 text-[10px] font-normal text-zinc-500 dark:text-zinc-400" @click.stop>
                                  <input
                                    type="checkbox"
                                    :checked="toolsAllChecked(role, group.tools)"
                                    @click.stop
                                    @change.stop="onRoleToolsChange(role, group.tools, $event)"
                                  />
                                  <span>全选</span>
                                </span>
                              </span>
                            </summary>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-2 px-2 pb-2">
                              <label
                                v-for="tool in group.tools"
                                :key="`${role}-${source.source}-${tool}`"
                                class="text-xs text-zinc-600 dark:text-zinc-300 flex items-start gap-2"
                              >
                                <input
                                  type="checkbox"
                                  class="mt-0.5"
                                  :checked="isRoleToolChecked(role, tool)"
                                  @change="onRoleToolChange(role, tool, $event)"
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
                      <div v-if="roleOptionTools(role).length === 0" class="text-[11px] text-zinc-500 dark:text-zinc-400">该角色暂无可分配的工具</div>
                    </div>
                  </div>
                </details>
              </div>

              <div v-else-if="settingsDialog === 'prompts'" class="space-y-5">
                <section class="space-y-3">
                  <h4 class="text-sm font-semibold text-zinc-800 dark:text-zinc-100">默认任务提示词</h4>
                  <div>
                    <div class="text-xs text-zinc-500 mb-1 dark:text-zinc-400">启动执行任务提示词</div>
                    <textarea v-model="defaultStartTaskPromptValue" rows="3" class="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:bg-zinc-950 dark:border-zinc-700 dark:text-zinc-100 transition-all text-xs"></textarea>
                  </div>
                  <div>
                    <div class="text-xs text-zinc-500 mb-1 dark:text-zinc-400">继续被暂停任务提示词</div>
                    <textarea v-model="defaultResumeTaskPromptValue" rows="3" class="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:bg-zinc-950 dark:border-zinc-700 dark:text-zinc-100 transition-all text-xs"></textarea>
                  </div>
                  <div>
                    <div class="text-xs text-zinc-500 mb-1 dark:text-zinc-400">任务监督提示词（AI 未标记完成时自动追问）</div>
                    <textarea v-model="defaultSupervisionPromptValue" rows="3" class="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:bg-zinc-950 dark:border-zinc-700 dark:text-zinc-100 transition-all text-xs"></textarea>
                  </div>
                  <div>
                    <div class="text-xs text-zinc-500 mb-1 dark:text-zinc-400">AI 停止思考超过多久后提醒（秒）</div>
                    <input v-model.number="defaultSupervisionIdleSecondsValue" type="number" min="5" max="3600" class="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:bg-zinc-950 dark:border-zinc-700 dark:text-zinc-100 transition-all text-xs" />
                    <p class="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">当任务 run 停止后，超过该时长且未调用 task.complete，系统会自动发起监督追问。</p>
                  </div>
                  <div>
                    <div class="text-xs text-zinc-500 mb-1 dark:text-zinc-400">传承提示文案（阈值默认使用上方 Token 上限）</div>
                    <textarea v-model="defaultInheritanceNoticeValue" rows="3" class="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:bg-zinc-950 dark:border-zinc-700 dark:text-zinc-100 transition-all text-xs"></textarea>
                  </div>
                </section>

                <section class="space-y-3 pt-5 border-t border-zinc-100 dark:border-zinc-800">
                  <h4 class="text-sm font-semibold text-zinc-800 dark:text-zinc-100">AI 通信提示词</h4>
                  <div>
                    <div class="text-xs text-zinc-500 mb-1 dark:text-zinc-400">
                      AI 收到来自其它 AI 消息时的中断提示（占位符：<code>{from_ai_name}</code>、<code>{from_ai_config_id}</code>、<code>{message_id}</code>、<code>{content}</code>）
                    </div>
                    <textarea v-model="promptAiMessageInboundValue" rows="7" class="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:bg-zinc-950 dark:border-zinc-700 dark:text-zinc-100 transition-all text-xs font-mono"></textarea>
                    <p class="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                      ai.send_message 触发后，目标 AI 在下一轮工作循环顶部会强行收到这段提示，
                      在没调 ai.reply_message 之前不应执行其它 MCP 工具。
                    </p>
                  </div>
                  <div>
                    <div class="text-xs text-zinc-500 mb-1 dark:text-zinc-400">
                      AI 成功回复消息后的恢复提示（占位符：<code>{message_id}</code>）
                    </div>
                    <textarea v-model="promptAiMessageReplySuccessValue" rows="3" class="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:bg-zinc-950 dark:border-zinc-700 dark:text-zinc-100 transition-all text-xs"></textarea>
                  </div>
                  <div>
                    <div class="text-xs text-zinc-500 mb-1 dark:text-zinc-400">
                      AI 调用 user.send_message 后的回执提示（占位符：<code>{channel}</code>）
                    </div>
                    <textarea v-model="promptUserMessageNoticeValue" rows="4" class="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:bg-zinc-950 dark:border-zinc-700 dark:text-zinc-100 transition-all text-xs"></textarea>
                  </div>
                </section>
              </div>
            </div>

            <div class="px-5 py-4 border-t border-zinc-100 dark:border-zinc-800 flex justify-end">
              <button @click="settingsDialog = ''" class="px-4 py-2 bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 rounded-xl text-sm font-bold hover:opacity-90 active:scale-95 transition-all">确定</button>
            </div>
          </div>
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
