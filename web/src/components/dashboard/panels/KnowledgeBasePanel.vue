<script setup lang="ts">
import { computed, ref, useAttrs } from 'vue'
import { readEntry, type KnowledgeEntryItem } from '@/api/librarian'
import { getAuthToken } from '@/api/http'
import { updateAiConfigFields } from '@/api/ai'

defineOptions({
  inheritAttrs: false,
})

interface KnowledgeItem {
  id: string
  title: string
  author: string
  time: string
  tags: string[]
}

interface Props {
  items: KnowledgeItem[]
  totalCount: number
  librarianPendingCount: number
  filterOpen: boolean
  filterValue: 'all' | 'intrinsic' | 'personas' | 'skills' | 'tools' | 'inheritance' | 'system' | 'business'
  noGlass?: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'update:filterOpen', value: boolean): void
  (e: 'update:filterValue', value: Props['filterValue']): void
  (e: 'open-proposal-review'): void
}>()

const attrs = useAttrs()
const rootAttrs = computed(() => {
  const { class: _class, ...rest } = attrs
  return rest
})
const detailOpen = ref(false)
const detailLoading = ref(false)
const detailError = ref('')
const selectedItem = ref<KnowledgeItem | null>(null)
const currentDetail = ref<KnowledgeEntryItem | null>(null)
const editingPersonaId = ref<number | null>(null)
const savingPersonaId = ref<number | null>(null)
const personaEditError = ref('')
const personaEditNotice = ref('')
const personaDraftPrompt = ref('')
const personaDraftAutoPrompts = ref<Record<string, string>>({})

const detailContent = computed(() => currentDetail.value?.body || currentDetail.value?.summary || '（无内容）')
const intrinsicProperties = computed(() => currentDetail.value?.intrinsic_properties || null)
const intrinsicPersonas = computed(() => currentDetail.value?.intrinsic_personas || null)

const toolParameters = (tool: { parameters?: Array<{ name: string; type: string; required: boolean; description: string }> }) =>
  Array.isArray(tool.parameters) ? tool.parameters : []

type IntrinsicPersonaAgent = NonNullable<KnowledgeEntryItem['intrinsic_personas']>['agents'][number]

const autoPromptValue = (key: string) => personaDraftAutoPrompts.value[key] ?? ''

const startEditPersona = (agent: IntrinsicPersonaAgent) => {
  if (!agent.id) return
  editingPersonaId.value = agent.id
  personaEditError.value = ''
  personaEditNotice.value = ''
  personaDraftPrompt.value = agent.prompt || ''
  personaDraftAutoPrompts.value = Object.fromEntries(
    (agent.auto_prompts || []).map(prompt => [prompt.key, prompt.content || '']),
  )
}

const cancelEditPersona = () => {
  editingPersonaId.value = null
  personaEditError.value = ''
  personaDraftPrompt.value = ''
  personaDraftAutoPrompts.value = {}
}

const updateDraftAutoPrompt = (key: string, value: string) => {
  personaDraftAutoPrompts.value = {
    ...personaDraftAutoPrompts.value,
    [key]: value,
  }
}

const parseAutoControl = (agent: IntrinsicPersonaAgent) => {
  try {
    const parsed = JSON.parse(agent.system_auto_control_raw || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

const savePersona = async (agent: IntrinsicPersonaAgent) => {
  if (!agent.id) return
  savingPersonaId.value = agent.id
  personaEditError.value = ''
  personaEditNotice.value = ''
  const rawAutoControlPrompt = (agent.auto_prompts || []).find(prompt => prompt.key === 'system_auto_control')
  if (rawAutoControlPrompt) {
    try {
      await updateAiConfigFields(agent.id, {
        prompt: personaDraftPrompt.value,
        system_auto_control: autoPromptValue(rawAutoControlPrompt.key),
      })
      agent.prompt = personaDraftPrompt.value
      agent.system_auto_control_raw = autoPromptValue(rawAutoControlPrompt.key)
      rawAutoControlPrompt.content = autoPromptValue(rawAutoControlPrompt.key)
      editingPersonaId.value = null
      personaEditNotice.value = `${agent.name} 已保存`
    } catch (err) {
      personaEditError.value = (err as Error).message || '保存失败'
    } finally {
      savingPersonaId.value = null
    }
    return
  }
  const autoControl = {
    ...parseAutoControl(agent),
    enabled: agent.auto_control_enabled ?? false,
  }
  for (const prompt of agent.auto_prompts || []) {
    autoControl[prompt.key] = autoPromptValue(prompt.key)
  }
  try {
    await updateAiConfigFields(agent.id, {
      prompt: personaDraftPrompt.value,
      system_auto_control: JSON.stringify(autoControl),
    })
    agent.prompt = personaDraftPrompt.value
    agent.system_auto_control_raw = JSON.stringify(autoControl)
    agent.auto_prompts = (agent.auto_prompts || []).map(prompt => ({
      ...prompt,
      content: autoPromptValue(prompt.key),
    }))
    editingPersonaId.value = null
    personaEditNotice.value = `${agent.name} 已保存`
  } catch (err) {
    personaEditError.value = (err as Error).message || '保存失败'
  } finally {
    savingPersonaId.value = null
  }
}

const toggleFilter = () => {
  emit('update:filterOpen', !props.filterOpen)
}

const applyFilter = (value: Props['filterValue']) => {
  emit('update:filterValue', value)
  emit('update:filterOpen', false)
}

const formatTime = (ts?: number | null) => {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const openDetail = async (item: KnowledgeItem) => {
  selectedItem.value = item
  detailOpen.value = true
  detailLoading.value = true
  detailError.value = ''
  currentDetail.value = null
  editingPersonaId.value = null
  personaEditError.value = ''
  personaEditNotice.value = ''
  try {
    const token = getAuthToken()
    currentDetail.value = await readEntry(token, item.id)
  } catch (err) {
    detailError.value = (err as Error).message || '条目加载失败'
  } finally {
    detailLoading.value = false
  }
}

const closeDetail = () => {
  detailOpen.value = false
  detailError.value = ''
  currentDetail.value = null
  selectedItem.value = null
  editingPersonaId.value = null
  savingPersonaId.value = null
  personaEditError.value = ''
  personaEditNotice.value = ''
  personaDraftPrompt.value = ''
  personaDraftAutoPrompts.value = {}
}
</script>

<template>
  <div v-bind="rootAttrs" :class="[
    attrs.class,
    'p-4 flex-1 flex flex-col overflow-hidden transition-all duration-300',
    noGlass ? '' : 'glass rounded-2xl border border-zinc-200 shadow-sm dark:bg-zinc-900/80 dark:border-zinc-800 hover:shadow-md'
  ]">
    <div class="flex justify-between items-center border-b border-zinc-100 pb-2 mb-2 dark:border-zinc-800">
      <h2 v-if="!noGlass" class="font-bold text-zinc-800 flex items-center gap-2 dark:text-zinc-100">
        <span>📚</span> 传承知识库
      </h2>
      <div v-else class="flex items-center gap-2">
        <span class="text-xs font-semibold text-zinc-500 dark:text-zinc-400">传承知识库</span>
      </div>
      <div class="flex items-center gap-2 relative">
        <button
          class="relative px-2 py-0.5 rounded border border-zinc-200 bg-white text-xs text-zinc-500 hover:text-indigo-600 hover:border-indigo-200 transition-colors dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-300 dark:hover:text-indigo-300"
          type="button"
          @click.stop="emit('open-proposal-review')"
        >
          沉淀审批
          <span
            v-if="librarianPendingCount > 0"
            class="ml-1 inline-flex min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] leading-4 justify-center"
          >{{ librarianPendingCount }}</span>
        </button>
        <span class="text-xs bg-zinc-100 px-2 py-0.5 rounded-full text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">{{ totalCount }} 条目</span>
        <button class="px-2 py-0.5 rounded border border-zinc-200 bg-white text-xs text-zinc-500 hover:text-indigo-600 hover:border-indigo-200 transition-colors dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-300 dark:hover:text-indigo-300" @click.stop="toggleFilter">
          筛选
        </button>
        <Transition name="fade">
          <div v-if="filterOpen" class="absolute right-0 top-8 w-36 bg-white border border-zinc-200 rounded-lg shadow-lg text-xs text-zinc-600 z-20 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-200" @click.stop>
            <button class="w-full text-left px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800" :class="filterValue === 'all' ? 'text-indigo-600 dark:text-indigo-300' : ''" @click="applyFilter('all')">
              全部
            </button>
            <button class="w-full text-left px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800" :class="filterValue === 'intrinsic' ? 'text-indigo-600 dark:text-indigo-300' : ''" @click="applyFilter('intrinsic')">
              固有属性
            </button>
            <button class="w-full text-left px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800" :class="filterValue === 'personas' ? 'text-indigo-600 dark:text-indigo-300' : ''" @click="applyFilter('personas')">
              固有人格
            </button>
            <button class="w-full text-left px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800" :class="filterValue === 'skills' ? 'text-indigo-600 dark:text-indigo-300' : ''" @click="applyFilter('skills')">
              传承技能
            </button>
            <button class="w-full text-left px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800" :class="filterValue === 'tools' ? 'text-indigo-600 dark:text-indigo-300' : ''" @click="applyFilter('tools')">
              传承知识
            </button>
          </div>
        </Transition>
      </div>
    </div>
    
    <div class="overflow-y-auto pr-1 space-y-2 flex-1 custom-scrollbar">
      <div v-if="items.length === 0" class="text-center text-zinc-400 text-xs py-10 dark:text-zinc-500">
        暂无知识库条目
      </div>
      <TransitionGroup name="list" tag="div" class="space-y-2">
        <button
          v-for="item in items"
          :key="item.id"
          type="button"
          class="w-full text-left p-3 bg-zinc-50 rounded border border-zinc-100 hover:border-indigo-200 transition-all duration-200 cursor-pointer group hover:scale-[1.01] hover:shadow-sm dark:bg-zinc-800 dark:border-zinc-700 dark:hover:border-indigo-400"
          @click="openDetail(item)"
        >
          <h4 class="text-sm font-medium text-zinc-800 group-hover:text-indigo-600 truncate dark:text-zinc-100 dark:group-hover:text-indigo-300">{{ item.title }}</h4>
          <div class="flex justify-between items-center mt-1">
            <span class="text-xs text-zinc-500 dark:text-zinc-400">{{ item.author }}</span>
            <span class="text-[10px] text-zinc-400 dark:text-zinc-500">{{ item.time }}</span>
          </div>
          <div class="mt-2 flex gap-1 flex-wrap">
            <span v-for="tag in item.tags" :key="tag" class="text-[10px] px-1.5 py-0.5 bg-white border border-zinc-200 rounded text-zinc-500 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-400">
              #{{ tag }}
            </span>
          </div>
        </button>
      </TransitionGroup>
    </div>

    <Teleport to="body">
    <div
      v-if="detailOpen"
      class="fixed inset-0 z-[520] bg-black/50 flex items-center justify-center p-4"
      @click.self="closeDetail"
    >
      <div class="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-[calc(100vw-2rem)] max-w-6xl h-[88vh] flex flex-col border border-zinc-200 dark:border-zinc-800">
        <div class="flex items-center justify-between px-5 py-3 border-b border-zinc-100 dark:border-zinc-800">
          <div class="min-w-0">
            <div class="text-sm font-semibold text-zinc-700 dark:text-zinc-200 truncate">
              {{ currentDetail?.title || selectedItem?.title || '知识库详情' }}
            </div>
            <div class="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400 truncate">
              {{ currentDetail?.memory_id || selectedItem?.id }}
            </div>
          </div>
          <button class="ml-3 text-zinc-400 hover:text-zinc-600 text-xl leading-none" @click="closeDetail">×</button>
        </div>

        <div class="flex-1 overflow-y-auto p-5 custom-scrollbar">
          <div v-if="detailLoading" class="text-center text-zinc-400 py-10">加载中…</div>
          <div v-else-if="detailError" class="text-center text-rose-500 py-10">{{ detailError }}</div>
          <template v-else-if="currentDetail">
            <div class="mb-3 flex flex-wrap gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
              <span class="px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800">范围：{{ currentDetail.scope }}</span>
              <span class="px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800">置信度：{{ Math.round(currentDetail.confidence * 100) }}%</span>
              <span class="px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800">使用：{{ currentDetail.use_count }} 次</span>
              <span class="px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800">更新：{{ formatTime(currentDetail.updated_at) }}</span>
            </div>

            <div v-if="currentDetail.triggers.length" class="mb-4 flex flex-wrap gap-1.5">
              <span
                v-for="trigger in currentDetail.triggers"
                :key="trigger"
                class="text-[10px] px-1.5 py-0.5 bg-white border border-zinc-200 rounded text-zinc-500 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-400"
              >
                #{{ trigger }}
              </span>
            </div>

            <div v-if="currentDetail.summary" class="mb-4">
              <div class="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1">摘要</div>
              <div class="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-800/40 p-3 rounded-lg border border-zinc-100 dark:border-zinc-800">
                {{ currentDetail.summary }}
              </div>
            </div>

            <template v-if="intrinsicProperties">
              <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                <div class="md:col-span-2 rounded-lg border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-800/40">
                  <div class="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1">前置描述</div>
                  <div class="text-xs leading-relaxed text-zinc-700 dark:text-zinc-200">{{ intrinsicProperties.description }}</div>
                </div>
                <div class="rounded-lg border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-800/40">
                  <div class="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1">总数</div>
                  <div class="text-2xl font-bold text-indigo-600 dark:text-indigo-300">{{ intrinsicProperties.total }}</div>
                </div>
              </div>

              <div class="space-y-4">
                <div class="text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-100 dark:border-zinc-800 rounded-lg px-3 py-2">
                  固有属性只读展示真实 MCP 工具定义；修改工具描述请更新对应 MCP 注册定义。
                </div>
                <details
                  v-for="category in intrinsicProperties.categories"
                  :key="category.namespace"
                  class="group rounded-lg border border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/40 overflow-hidden"
                >
                  <summary class="list-none cursor-pointer px-3 py-2 border-b border-zinc-100 dark:border-zinc-800 select-none">
                    <div class="flex items-center justify-between gap-3">
                      <div class="flex min-w-0 items-center gap-2">
                        <span class="text-zinc-400 transition-transform group-open:rotate-90">›</span>
                        <div class="truncate text-xs font-semibold text-zinc-700 dark:text-zinc-200">工具总栏目：{{ category.namespace }}</div>
                      </div>
                      <div class="flex shrink-0 items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                        <span>{{ category.count }} 个工具</span>
                      </div>
                    </div>
                  </summary>
                  <div class="divide-y divide-zinc-100 dark:divide-zinc-800">
                    <div
                      v-for="tool in category.tools"
                      :key="tool.name"
                      class="px-3 py-3"
                    >
                      <div class="grid grid-cols-1 md:grid-cols-[13rem_1fr] gap-2">
                        <div>
                          <div class="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 mb-0.5">调用工具</div>
                          <code class="text-[11px] text-indigo-600 dark:text-indigo-300 break-all">{{ tool.name }}</code>
                        </div>
                        <div>
                          <div class="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 mb-0.5">工具描述</div>
                          <div class="text-xs leading-relaxed text-zinc-700 dark:text-zinc-200">
                            {{ tool.description || '（无描述）' }}
                            <span v-if="tool.destructive" class="ml-1 text-amber-600 dark:text-amber-300">可能产生写入/变更</span>
                          </div>
                        </div>
                      </div>
                      <div class="mt-2">
                        <div class="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 mb-1">参数说明</div>
                        <div v-if="toolParameters(tool).length" class="overflow-hidden rounded border border-zinc-100 dark:border-zinc-700">
                          <div
                            v-for="param in toolParameters(tool)"
                            :key="`${tool.name}-${param.name}`"
                            class="grid grid-cols-1 md:grid-cols-[11rem_6rem_4rem_1fr] gap-2 px-2 py-1.5 text-[11px] border-b last:border-b-0 border-zinc-100 dark:border-zinc-700"
                          >
                            <code class="text-zinc-700 dark:text-zinc-200 break-all">{{ param.name }}</code>
                            <span class="text-zinc-500 dark:text-zinc-400">{{ param.type || 'any' }}</span>
                            <span :class="param.required ? 'text-rose-600 dark:text-rose-300' : 'text-zinc-400 dark:text-zinc-500'">
                              {{ param.required ? '必填' : '可选' }}
                            </span>
                            <span class="text-zinc-600 dark:text-zinc-300">{{ param.description || '（无描述）' }}</span>
                          </div>
                        </div>
                        <div v-else class="text-[11px] text-zinc-500 dark:text-zinc-400">无参数</div>
                      </div>
                    </div>
                  </div>
                </details>
              </div>
            </template>
            <template v-else-if="intrinsicPersonas">
              <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                <div class="md:col-span-2 rounded-lg border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-800/40">
                  <div class="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1">前置描述</div>
                  <div class="text-xs leading-relaxed text-zinc-700 dark:text-zinc-200">{{ intrinsicPersonas.description }}</div>
                </div>
                <div class="rounded-lg border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-800/40">
                  <div class="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1">AI 总数</div>
                  <div class="text-2xl font-bold text-indigo-600 dark:text-indigo-300">{{ intrinsicPersonas.total }}</div>
                </div>
              </div>

              <div class="space-y-4">
                <div v-if="personaEditNotice" class="text-xs text-emerald-600 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900 rounded-lg px-3 py-2">
                  {{ personaEditNotice }}
                </div>
                <div v-if="personaEditError" class="text-xs text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/30 border border-rose-100 dark:border-rose-900 rounded-lg px-3 py-2">
                  {{ personaEditError }}
                </div>
                <details
                  v-for="agent in intrinsicPersonas.agents"
                  :key="agent.id || agent.name"
                  :open="editingPersonaId === agent.id || undefined"
                  class="group rounded-lg border border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/40 overflow-hidden"
                >
                  <summary class="list-none cursor-pointer px-3 py-2 border-b border-zinc-100 dark:border-zinc-800 select-none">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <div class="flex min-w-0 items-center gap-2">
                        <span class="text-zinc-400 transition-transform group-open:rotate-90">›</span>
                        <div class="truncate text-sm font-semibold text-zinc-800 dark:text-zinc-100">{{ agent.name }}</div>
                      </div>
                      <div class="flex flex-wrap gap-1 text-[10px] text-zinc-500 dark:text-zinc-400">
                        <span class="px-1.5 py-0.5 rounded bg-white dark:bg-zinc-900">ID {{ agent.id }}</span>
                        <span class="px-1.5 py-0.5 rounded bg-white dark:bg-zinc-900">{{ agent.role }}</span>
                        <span v-if="agent.is_librarian" class="px-1.5 py-0.5 rounded bg-white dark:bg-zinc-900">图书管理员</span>
                        <span class="px-1.5 py-0.5 rounded bg-white dark:bg-zinc-900">{{ agent.enabled ? '启用' : '停用' }}</span>
                        <button
                          v-if="agent.id && editingPersonaId !== agent.id"
                          type="button"
                          class="ml-1 px-2 py-0.5 rounded border border-indigo-200 bg-white text-indigo-600 hover:bg-indigo-50 dark:bg-zinc-900 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
                          @click.stop.prevent="startEditPersona(agent)"
                        >
                          编辑
                        </button>
                      </div>
                    </div>
                    <div class="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                      {{ agent.platform }} · 第 {{ agent.generation }} 代 · {{ agent.model || '未设置模型' }}
                    </div>
                  </summary>
                  <div class="p-3 space-y-3">
                    <div>
                      <div class="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 mb-1">人格 Prompt</div>
                      <textarea
                        v-if="editingPersonaId === agent.id"
                        :value="personaDraftPrompt"
                        rows="10"
                        class="w-full resize-y whitespace-pre-wrap font-mono text-xs leading-relaxed text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-900/70 p-3 rounded border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-800"
                        @input="personaDraftPrompt = ($event.target as HTMLTextAreaElement).value"
                      />
                      <pre v-else class="whitespace-pre-wrap font-mono text-xs leading-relaxed text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-900/70 p-3 rounded border border-zinc-100 dark:border-zinc-700">{{ agent.prompt || '（空）' }}</pre>
                    </div>
                    <div
                      v-for="prompt in agent.auto_prompts"
                      :key="`${agent.id}-${prompt.key}`"
                    >
                      <div class="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 mb-1">{{ prompt.label }}</div>
                      <textarea
                        v-if="editingPersonaId === agent.id"
                        :value="autoPromptValue(prompt.key)"
                        rows="5"
                        class="w-full resize-y whitespace-pre-wrap font-mono text-xs leading-relaxed text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-900/70 p-3 rounded border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-800"
                        @input="updateDraftAutoPrompt(prompt.key, ($event.target as HTMLTextAreaElement).value)"
                      />
                      <pre v-else class="whitespace-pre-wrap font-mono text-xs leading-relaxed text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-900/70 p-3 rounded border border-zinc-100 dark:border-zinc-700">{{ prompt.content || '（空）' }}</pre>
                    </div>
                    <div v-if="editingPersonaId === agent.id" class="flex justify-end gap-2 pt-1">
                      <button
                        type="button"
                        class="px-3 py-1.5 rounded border border-zinc-200 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        :disabled="savingPersonaId === agent.id"
                        @click="cancelEditPersona"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        class="px-3 py-1.5 rounded bg-indigo-600 text-xs text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                        :disabled="savingPersonaId === agent.id"
                        @click="savePersona(agent)"
                      >
                        {{ savingPersonaId === agent.id ? '保存中…' : '保存' }}
                      </button>
                    </div>
                  </div>
                </details>
              </div>
            </template>
            <template v-else>
              <div class="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1">具体内容</div>
              <pre class="whitespace-pre-wrap font-mono text-xs leading-relaxed text-zinc-700 dark:text-zinc-200 bg-zinc-50 dark:bg-zinc-800/40 p-3 rounded-lg border border-zinc-100 dark:border-zinc-800">{{ detailContent }}</pre>
            </template>

            <div v-if="currentDetail.source_job_id" class="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
              来源任务：{{ currentDetail.source_job_id }} · 第 {{ currentDetail.source_generation || 1 }} 代
            </div>
          </template>
        </div>
      </div>
    </div>
    </Teleport>
  </div>
</template>
