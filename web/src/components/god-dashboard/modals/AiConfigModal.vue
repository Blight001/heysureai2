<script setup lang="ts">
type SettingsSection = 'mcp' | 'workspace' | 'auto'

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

defineProps<Props>()
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
            <label class="block text-xs text-zinc-500 mb-1">Prompt</label>
            <textarea v-model="form.prompt" rows="3" class="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100"></textarea>
          </div>
        </div>

        <div class="mt-4 p-3 rounded-lg border border-zinc-200 dark:border-zinc-700">
          <div class="text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-2">权限及其系统设置</div>

          <details :open="settingsSection === 'mcp'" class="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-800/40 mb-2">
            <summary class="cursor-pointer select-none px-3 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-200" @click.prevent="onToggleSettingsSection('mcp')">MCP 工具权限</summary>
            <div class="px-3 pb-3">
              <label class="mb-3 flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-300 px-2 py-2 rounded border border-zinc-200 dark:border-zinc-700 bg-white/70 dark:bg-zinc-900/50">
                <span>MCP 调用无需确认</span>
                <input type="checkbox" v-model="form.mcp_auto_approve" />
              </label>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-44 overflow-y-auto pr-1">
                <label v-for="tool in availableMcpTools" :key="tool" class="text-xs text-zinc-600 dark:text-zinc-300 flex items-center gap-2">
                  <input
                    type="checkbox"
                    :checked="form.mcp_tools.includes(tool)"
                    @change="onToolCheckboxChange(tool, $event)"
                  />
                  <span class="font-mono">{{ tool }}</span>
                </label>
              </div>
            </div>
          </details>

          <details :open="settingsSection === 'workspace'" class="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-800/40 mb-2">
            <summary class="cursor-pointer select-none px-3 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-200" @click.prevent="onToggleSettingsSection('workspace')">工作目录权限</summary>
            <div class="px-3 pb-3">
              <label class="block text-xs text-zinc-500 mb-1">允许 AI 读写的工作目录</label>
              <div class="rounded-lg border border-zinc-200 dark:border-zinc-700 p-2 bg-white/70 dark:bg-zinc-900/50">
                <div v-if="workspaceDirsLoading" class="text-xs text-zinc-500 dark:text-zinc-400 px-1 py-2">正在加载用户工作区目录...</div>
                <div v-else-if="workspaceDirsError" class="text-xs text-red-600 dark:text-red-300 px-1 py-2">{{ workspaceDirsError }}</div>
                <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-44 overflow-y-auto pr-1">
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
          </details>

          <details v-if="form.ai_role_group === 'digital_member'" :open="settingsSection === 'auto'" class="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-800/40">
            <summary class="cursor-pointer select-none px-3 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-200" @click.prevent="onToggleSettingsSection('auto')">系统自动控制</summary>
            <div class="px-3 pb-3 space-y-3">
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
          </details>
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
    </div>
  </Transition>
</template>
