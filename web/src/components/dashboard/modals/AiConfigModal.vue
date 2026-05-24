<script setup lang="ts">
import { computed, ref } from 'vue'
import { getMcpToolZhLabel, groupMcpToolsBySource } from '@/utils/mcpTools'

type SettingsSection = 'mcp' | 'workspace' | 'auto' | 'feishu'

interface Props {
  show: boolean
  mode: 'create' | 'edit'
  form: any | null
  deleteConfirm: boolean
  settingsSection: SettingsSection | ''
  availableMcpTools: string[]
  availableWorkspaceDirs: string[]
  workspaceDirsLoading: boolean
  workspaceDirsError: string
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
  feishu: '飞书机器人',
  workspace: '工作目录权限',
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
            <select v-model="form.ai_role_group" class="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100">
              <option value="assistant_admin">辅助管理员</option>
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
            <input v-model="form.model" class="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100" />
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
          <div>
            <label class="block text-xs text-zinc-500 mb-1">API Key</label>
            <input v-model="form.api_key" class="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100" />
          </div>
          <div>
            <label class="block text-xs text-zinc-500 mb-1">Base URL</label>
            <input v-model="form.base_url" class="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100" />
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
              @click="openSettingsSection('feishu')"
            >
              <span class="block text-xs font-medium text-zinc-700 dark:text-zinc-200">飞书机器人</span>
              <span class="mt-1 block text-[11px] text-zinc-500 dark:text-zinc-400">
                {{ form.feishu_enabled ? '已启用' : '未启用' }}，默认接收类型 {{ form.feishu_default_receive_id_type || 'chat_id' }}
              </span>
            </button>
            <button
              type="button"
              class="text-left px-3 py-2.5 rounded-lg border border-zinc-200 bg-zinc-50/70 hover:border-indigo-300 hover:bg-white dark:border-zinc-700 dark:bg-zinc-800/40 dark:hover:border-indigo-500/50 dark:hover:bg-zinc-800"
              @click="openSettingsSection('workspace')"
            >
              <span class="block text-xs font-medium text-zinc-700 dark:text-zinc-200">工作目录权限</span>
              <span class="mt-1 block text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                {{ form.workspace_root ? (form.workspace_root === '.' ? '用户工作区根目录' : form.workspace_root) : '仅对话，不绑定工作目录' }}
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
                  仅显示当前角色（{{ form.ai_role_group === 'assistant_admin' ? '辅助管理员' : (form.digital_member_role === 'manager' ? '数字成员·管理者' : '数字成员·普通成员') }}）允许的 MCP 工具，可在“系统设置 → MCP 角色权限”中调整各角色范围。
                </p>
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

              <div v-else-if="settingsSection === 'feishu'" class="space-y-3">
                <label class="flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-300 px-2 py-2 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/60">
                  <span>启用飞书机器人</span>
                  <input type="checkbox" v-model="form.feishu_enabled" />
                </label>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div class="md:col-span-2">
                    <label class="block text-[11px] text-zinc-500 mb-1">自定义群机器人 Webhook URL（仅主动通知）</label>
                    <input v-model="form.feishu_webhook_url" class="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-100 text-xs" placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..." />
                  </div>
                  <div>
                    <label class="block text-[11px] text-zinc-500 mb-1">App ID</label>
                    <input v-model="form.feishu_app_id" class="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-100 text-xs" placeholder="cli_xxx" />
                  </div>
                  <div>
                    <label class="block text-[11px] text-zinc-500 mb-1">App Secret</label>
                    <input v-model="form.feishu_app_secret" type="password" class="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-100 text-xs" />
                  </div>
                  <div>
                    <label class="block text-[11px] text-zinc-500 mb-1">Verification Token</label>
                    <input v-model="form.feishu_verification_token" class="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-100 text-xs" />
                  </div>
                  <div>
                    <label class="block text-[11px] text-zinc-500 mb-1">默认接收 ID 类型</label>
                    <select v-model="form.feishu_default_receive_id_type" class="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-100 text-xs">
                      <option value="chat_id">chat_id</option>
                      <option value="open_id">open_id</option>
                      <option value="user_id">user_id</option>
                      <option value="union_id">union_id</option>
                      <option value="email">email</option>
                    </select>
                  </div>
                  <div class="md:col-span-2">
                    <label class="block text-[11px] text-zinc-500 mb-1">默认接收 ID（AI 主动通知时使用）</label>
                    <input v-model="form.feishu_default_receive_id" class="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-100 text-xs" placeholder="群聊 chat_id 或用户 open_id" />
                  </div>
                </div>
                <div class="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Webhook URL 只能让 AI 主动发通知；飞书用户主动与 AI 对话需要配置自建应用 App ID / Secret，并在飞书开放平台的事件订阅里选择“使用长连接接收事件”。启用后请在 MCP 工具权限中勾选 <span class="font-mono">user.send_message</span>。
                </div>
              </div>

              <div v-else-if="settingsSection === 'workspace'">
                <label class="block text-xs text-zinc-500 mb-1">允许 AI 读写的工作目录</label>
                <div class="rounded-lg border border-zinc-200 dark:border-zinc-700 p-2 bg-zinc-50 dark:bg-zinc-800/60">
                  <div v-if="workspaceDirsLoading" class="text-xs text-zinc-500 dark:text-zinc-400 px-1 py-2">正在加载用户工作区目录...</div>
                  <div v-else-if="workspaceDirsError" class="text-xs text-red-600 dark:text-red-300 px-1 py-2">{{ workspaceDirsError }}</div>
                  <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[48vh] overflow-y-auto pr-1">
                    <label
                      class="text-xs text-zinc-600 dark:text-zinc-300 flex items-center gap-2 px-2 py-1.5 rounded border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-500/40"
                    >
                      <input type="radio" name="workspace-root-ai-config" value="" v-model="form.workspace_root" />
                      <span class="font-mono">（仅对话，不绑定工作目录）</span>
                    </label>
                    <label
                      v-for="dir in availableWorkspaceDirs"
                      :key="`ws-dir-${dir === '.' ? 'root' : dir}`"
                      class="text-xs text-zinc-600 dark:text-zinc-300 flex items-center gap-2 px-2 py-1.5 rounded border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-500/40"
                    >
                      <input type="radio" name="workspace-root-ai-config" :value="dir" v-model="form.workspace_root" />
                      <span class="font-mono">{{ dir === '.' ? '（用户工作区根目录）' : dir }}</span>
                    </label>
                  </div>
                </div>
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
