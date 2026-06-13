<script setup lang="ts">
import { computed, ref, useAttrs } from 'vue'
import AppIcon from '@/components/common/AppIcon.vue'
import {
  deleteInstalledClawHubSkill,
  installClawHubSkill,
  readInstalledClawHubSkill,
  readClawHubSkill,
  readEntry,
  saveIntrinsicProperties,
  saveSystemPrompts,
  searchClawHubSkills,
  setInstalledClawHubSkillEndpoint,
  updateInstalledClawHubSkill,
  type ClawHubInstalledSkillDetail,
  type ClawHubSkillDetail,
  type ClawHubSkillSearchResult,
  type KnowledgeEntryItem,
} from '@/api/librarian'
import { getAuthToken } from '@/api/http'
import { updateAiConfigFields } from '@/api/ai'
import { me } from '@/api/auth'
import { useMessage } from '@/composables/useMessage'
import type { User } from '@/types'

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
  (e: 'refresh-user', user: User): void
}>()

const attrs = useAttrs()
const { confirm } = useMessage()
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
const editingPropertyCategory = ref<string | null>(null)
const savingPropertyCategory = ref<string | null>(null)
const propertyEditError = ref('')
const propertyEditNotice = ref('')
const propertyDraftTools = ref<Array<{
  name: string
  description: string
  parameters: Array<{ name: string; description: string }>
}>>([])
const editingPromptSection = ref<string | null>(null)
const savingPromptSection = ref<string | null>(null)
const promptEditError = ref('')
const promptEditNotice = ref('')
const promptDraftItems = ref<Array<{ key: string; content: string | number }>>([])
const clawhubQuery = ref('')
const clawhubModalOpen = ref(false)
const clawhubSearching = ref(false)
const clawhubError = ref('')
const clawhubNotice = ref('')
const clawhubResults = ref<ClawHubSkillSearchResult[]>([])
const clawhubDetailLoading = ref(false)
const clawhubInspectingSlug = ref('')
const clawhubSelected = ref<ClawHubSkillDetail | null>(null)
const clawhubInstallingSlug = ref('')
const installedClawhubModalOpen = ref(false)
const installedClawhubLoading = ref(false)
const installedClawhubSaving = ref(false)
const installedClawhubDeleting = ref(false)
const installedClawhubError = ref('')
const installedClawhubNotice = ref('')
const installedClawhubSelected = ref<ClawHubInstalledSkillDetail | null>(null)
const installedClawhubDraft = ref('')
// 传承思想端归类：安装时选择 + 已装列表筛选 + 改端。
const installEndpointKind = ref<'auto' | 'any' | 'desktop' | 'browser'>('auto')
const thoughtEndpointFilter = ref<'all' | 'any' | 'desktop' | 'browser'>('all')
const installedEndpointSaving = ref(false)

const ENDPOINT_LABELS: Record<string, string> = { any: '通用', desktop: '桌面端', browser: '浏览器端' }
const endpointLabel = (kind?: string | null) => ENDPOINT_LABELS[String(kind || 'any')] || '通用'
const deviceTypeLabel = (kind?: string | null) => ({
  desktop: '桌面设备',
  browser: '浏览器设备',
  linux: 'Linux 设备',
}[String(kind || '').toLowerCase()] || String(kind || '端侧设备'))

const detailContent = computed(() => currentDetail.value?.body || currentDetail.value?.summary || '（无内容）')
const intrinsicProperties = computed(() => currentDetail.value?.intrinsic_properties || null)
const intrinsicPersonas = computed(() => currentDetail.value?.intrinsic_personas || null)
const systemPrompts = computed(() => currentDetail.value?.system_prompts || null)
const inheritanceSkills = computed(() => currentDetail.value?.inheritance_skills || null)
const inheritanceThoughts = computed(() => currentDetail.value?.inheritance_tools || null)

const filteredInstalledThoughts = computed(() => {
  const installed = inheritanceThoughts.value?.installed || []
  if (thoughtEndpointFilter.value === 'all') return installed
  return installed.filter(skill => String(skill.endpoint_kind || 'any') === thoughtEndpointFilter.value)
})

const installedEndpointKind = computed<'any' | 'desktop' | 'browser'>(() => {
  const kind = String(installedClawhubSelected.value?.skill?.endpoint_kind || 'any')
  return kind === 'desktop' || kind === 'browser' ? kind : 'any'
})

const toolParameters = (tool: { parameters?: Array<{ name: string; type: string; required: boolean; description: string }> }) =>
  Array.isArray(tool.parameters) ? tool.parameters : []
const formatImplementationCode = (code: unknown) => JSON.stringify(code, null, 2)

type IntrinsicPersonaAgent = NonNullable<KnowledgeEntryItem['intrinsic_personas']>['agents'][number]
type IntrinsicPropertyCategory = NonNullable<KnowledgeEntryItem['intrinsic_properties']>['categories'][number]

const startEditPersona = (agent: IntrinsicPersonaAgent) => {
  if (!agent.id) return
  editingPersonaId.value = agent.id
  personaEditError.value = ''
  personaEditNotice.value = ''
  personaDraftPrompt.value = agent.prompt || ''
}

const cancelEditPersona = () => {
  editingPersonaId.value = null
  personaEditError.value = ''
  personaDraftPrompt.value = ''
}

const savePersona = async (agent: IntrinsicPersonaAgent) => {
  if (!agent.id) return
  savingPersonaId.value = agent.id
  personaEditError.value = ''
  personaEditNotice.value = ''
  try {
    await updateAiConfigFields(agent.id, {
      prompt: personaDraftPrompt.value,
    })
    agent.prompt = personaDraftPrompt.value
    editingPersonaId.value = null
    personaEditNotice.value = `${agent.name} 已保存`
  } catch (err) {
    personaEditError.value = (err as Error).message || '保存失败'
  } finally {
    savingPersonaId.value = null
  }
}

const startEditPropertyCategory = (category: IntrinsicPropertyCategory) => {
  editingPropertyCategory.value = category.namespace
  propertyEditError.value = ''
  propertyEditNotice.value = ''
  propertyDraftTools.value = (category.tools || []).map(tool => ({
    name: tool.name,
    description: tool.description || '',
    parameters: toolParameters(tool).map(param => ({
      name: param.name,
      description: param.description || '',
    })),
  }))
}

const cancelEditPropertyCategory = () => {
  editingPropertyCategory.value = null
  propertyEditError.value = ''
  propertyDraftTools.value = []
}

const updateDraftToolDescription = (toolName: string, value: string) => {
  propertyDraftTools.value = propertyDraftTools.value.map(tool =>
    tool.name === toolName ? { ...tool, description: value } : tool,
  )
}

const updateDraftParamDescription = (toolName: string, paramName: string, value: string) => {
  propertyDraftTools.value = propertyDraftTools.value.map(tool => {
    if (tool.name !== toolName) return tool
    return {
      ...tool,
      parameters: tool.parameters.map(param =>
        param.name === paramName ? { ...param, description: value } : param,
      ),
    }
  })
}

const propertyDraftTool = (toolName: string) => propertyDraftTools.value.find(tool => tool.name === toolName)

const propertyDraftToolDescription = (toolName: string) => propertyDraftTool(toolName)?.description ?? ''

const propertyDraftParamDescription = (toolName: string, paramName: string) =>
  propertyDraftTool(toolName)?.parameters.find(param => param.name === paramName)?.description ?? ''

const savePropertyCategory = async (category: IntrinsicPropertyCategory) => {
  savingPropertyCategory.value = category.namespace
  propertyEditError.value = ''
  propertyEditNotice.value = ''
  try {
    const token = getAuthToken()
    const updated = await saveIntrinsicProperties(token, propertyDraftTools.value)
    currentDetail.value = updated
    editingPropertyCategory.value = null
    propertyDraftTools.value = []
    propertyEditNotice.value = `${category.namespace} 已保存`
  } catch (err) {
    propertyEditError.value = (err as Error).message || '保存失败'
  } finally {
    savingPropertyCategory.value = null
  }
}

type SystemPromptSection = NonNullable<KnowledgeEntryItem['system_prompts']>['sections'][number]

const startEditPromptSection = (section: SystemPromptSection) => {
  editingPromptSection.value = section.key
  promptEditError.value = ''
  promptEditNotice.value = ''
  promptDraftItems.value = section.items.map(item => ({
    key: item.key,
    content: item.type === 'number' ? Number(item.content || 0) : item.content || '',
  }))
}

const cancelEditPromptSection = () => {
  editingPromptSection.value = null
  promptEditError.value = ''
  promptDraftItems.value = []
}

const promptDraftValue = (key: string) =>
  promptDraftItems.value.find(item => item.key === key)?.content ?? ''

const updatePromptDraftValue = (key: string, value: string | number) => {
  promptDraftItems.value = promptDraftItems.value.map(item =>
    item.key === key ? { ...item, content: value } : item,
  )
}

const savePromptSection = async (section: SystemPromptSection) => {
  savingPromptSection.value = section.key
  promptEditError.value = ''
  promptEditNotice.value = ''
  try {
    const token = getAuthToken()
    const updated = await saveSystemPrompts(token, promptDraftItems.value)
    currentDetail.value = updated
    if (token) {
      const refreshedUser = await me(token)
      emit('refresh-user', refreshedUser)
    }
    editingPromptSection.value = null
    promptDraftItems.value = []
    promptEditNotice.value = `${section.title} 已保存`
  } catch (err) {
    promptEditError.value = (err as Error).message || '保存失败'
  } finally {
    savingPromptSection.value = null
  }
}

const searchClawHub = async () => {
  const query = clawhubQuery.value.trim()
  if (!query) {
    clawhubError.value = '请输入搜索关键词'
    return
  }
  clawhubSearching.value = true
  clawhubError.value = ''
  clawhubNotice.value = ''
  try {
    const token = getAuthToken()
    const data = await searchClawHubSkills(token, query, 20)
    clawhubResults.value = data.results || []
  } catch (err) {
    clawhubError.value = (err as Error).message || '搜索失败'
  } finally {
    clawhubSearching.value = false
  }
}

const openClawHubModal = () => {
  clawhubModalOpen.value = true
  clawhubError.value = ''
  clawhubNotice.value = ''
  installEndpointKind.value = 'auto'
}

const closeClawHubModal = () => {
  clawhubModalOpen.value = false
  clawhubError.value = ''
  clawhubNotice.value = ''
  clawhubDetailLoading.value = false
  clawhubInspectingSlug.value = ''
}

const inspectClawHubSkill = async (slug: string) => {
  const targetSlug = String(slug || '').trim()
  if (!targetSlug) return
  clawhubDetailLoading.value = true
  clawhubInspectingSlug.value = targetSlug
  clawhubError.value = ''
  clawhubNotice.value = ''
  clawhubModalOpen.value = true
  try {
    const token = getAuthToken()
    clawhubSelected.value = await readClawHubSkill(token, targetSlug)
  } catch (err) {
    clawhubError.value = (err as Error).message || '详情加载失败'
  } finally {
    clawhubDetailLoading.value = false
    clawhubInspectingSlug.value = ''
  }
}

const installSelectedClawHubSkill = async (force = false) => {
  const selected = clawhubSelected.value
  const slug = selected?.slug
  if (!slug) return
  clawhubInstallingSlug.value = slug
  clawhubError.value = ''
  clawhubNotice.value = ''
  try {
    const token = getAuthToken()
    const installed = await installClawHubSkill(token, slug, {
      version: selected.version,
      force,
      endpoint_kind: installEndpointKind.value === 'auto' ? undefined : installEndpointKind.value,
    })
    currentDetail.value = installed.entry
    clawhubSelected.value = {
      ...selected,
      installed: true,
    }
    clawhubResults.value = clawhubResults.value.map(item =>
      item.slug === slug ? { ...item, installed: true } : item,
    )
    clawhubNotice.value = force ? `${slug} 已更新` : `${slug} 已安装到本地传承思想`
  } catch (err) {
    clawhubError.value = (err as Error).message || '安装失败'
  } finally {
    clawhubInstallingSlug.value = ''
  }
}

const clawhubScanLabel = computed(() => {
  const scan = clawhubSelected.value?.scan || {}
  const security = (scan.security && typeof scan.security === 'object') ? scan.security as Record<string, any> : {}
  const moderation = (scan.moderation && typeof scan.moderation === 'object') ? scan.moderation as Record<string, any> : {}
  return String(security.status || moderation.verdict || moderation.summary || scan.error || '未知')
})

const openInstalledClawHubSkill = async (slug: string) => {
  const targetSlug = String(slug || '').trim()
  if (!targetSlug) return
  installedClawhubModalOpen.value = true
  installedClawhubLoading.value = true
  installedClawhubError.value = ''
  installedClawhubNotice.value = ''
  installedClawhubSelected.value = null
  installedClawhubDraft.value = ''
  try {
    const token = getAuthToken()
    const detail = await readInstalledClawHubSkill(token, targetSlug)
    installedClawhubSelected.value = detail
    installedClawhubDraft.value = detail.skill_card || ''
  } catch (err) {
    installedClawhubError.value = (err as Error).message || '加载失败'
  } finally {
    installedClawhubLoading.value = false
  }
}

const closeInstalledClawHubModal = () => {
  installedClawhubModalOpen.value = false
  installedClawhubLoading.value = false
  installedClawhubSaving.value = false
  installedClawhubDeleting.value = false
  installedClawhubError.value = ''
  installedClawhubNotice.value = ''
}

const saveInstalledClawHubSkill = async () => {
  const slug = installedClawhubSelected.value?.slug
  if (!slug) return
  installedClawhubSaving.value = true
  installedClawhubError.value = ''
  installedClawhubNotice.value = ''
  try {
    const token = getAuthToken()
    const updated = await updateInstalledClawHubSkill(token, slug, installedClawhubDraft.value)
    installedClawhubSelected.value = updated.detail
    currentDetail.value = updated.entry
    installedClawhubNotice.value = '已保存'
  } catch (err) {
    installedClawhubError.value = (err as Error).message || '保存失败'
  } finally {
    installedClawhubSaving.value = false
  }
}

const applyInstalledEndpoint = async (kind: 'any' | 'desktop' | 'browser') => {
  const slug = installedClawhubSelected.value?.slug
  if (!slug || kind === installedEndpointKind.value) return
  installedEndpointSaving.value = true
  installedClawhubError.value = ''
  installedClawhubNotice.value = ''
  try {
    const token = getAuthToken()
    const res = await setInstalledClawHubSkillEndpoint(token, slug, kind)
    installedClawhubSelected.value = res.detail
    installedClawhubNotice.value = `已改端为「${endpointLabel(kind)}」`
  } catch (err) {
    installedClawhubError.value = (err as Error).message || '改端失败'
  } finally {
    installedEndpointSaving.value = false
  }
}

const removeInstalledClawHubSkill = async () => {
  const slug = installedClawhubSelected.value?.slug
  if (!slug) return
  const ok = await confirm({
    message: `确认删除本地快照 ${slug}？删除后需要重新从 ClawHub 安装。`,
    type: 'warning',
    confirmText: '删除',
    cancelText: '取消',
  })
  if (!ok) return
  installedClawhubDeleting.value = true
  installedClawhubError.value = ''
  try {
    const token = getAuthToken()
    const deleted = await deleteInstalledClawHubSkill(token, slug)
    currentDetail.value = deleted.entry
    clawhubResults.value = clawhubResults.value.map(item =>
      item.slug === slug ? { ...item, installed: false } : item,
    )
    installedClawhubModalOpen.value = false
    installedClawhubSelected.value = null
    installedClawhubDraft.value = ''
  } catch (err) {
    installedClawhubError.value = (err as Error).message || '删除失败'
  } finally {
    installedClawhubDeleting.value = false
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
  editingPropertyCategory.value = null
  propertyEditError.value = ''
  propertyEditNotice.value = ''
  editingPromptSection.value = null
  promptEditError.value = ''
  promptEditNotice.value = ''
  clawhubModalOpen.value = false
  clawhubError.value = ''
  clawhubNotice.value = ''
  clawhubResults.value = []
  clawhubSelected.value = null
  clawhubInspectingSlug.value = ''
  clawhubInstallingSlug.value = ''
  installedClawhubModalOpen.value = false
  installedClawhubSelected.value = null
  installedClawhubDraft.value = ''
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
  editingPropertyCategory.value = null
  savingPropertyCategory.value = null
  propertyEditError.value = ''
  propertyEditNotice.value = ''
  propertyDraftTools.value = []
  editingPromptSection.value = null
  savingPromptSection.value = null
  promptEditError.value = ''
  promptEditNotice.value = ''
  promptDraftItems.value = []
  clawhubQuery.value = ''
  clawhubModalOpen.value = false
  clawhubError.value = ''
  clawhubNotice.value = ''
  clawhubResults.value = []
  clawhubSelected.value = null
  clawhubInspectingSlug.value = ''
  clawhubInstallingSlug.value = ''
  installedClawhubModalOpen.value = false
  installedClawhubSelected.value = null
  installedClawhubDraft.value = ''
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
        <AppIcon name="book" class="w-[18px] h-[18px]" /> 传承知识库
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
              固有技能
            </button>
            <button class="w-full text-left px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800" :class="filterValue === 'personas' ? 'text-indigo-600 dark:text-indigo-300' : ''" @click="applyFilter('personas')">
              固有人格
            </button>
            <button class="w-full text-left px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800" :class="filterValue === 'skills' ? 'text-indigo-600 dark:text-indigo-300' : ''" @click="applyFilter('skills')">
              传承技能
            </button>
            <button class="w-full text-left px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800" :class="filterValue === 'tools' ? 'text-indigo-600 dark:text-indigo-300' : ''" @click="applyFilter('tools')">
              传承思想
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
            <div class="flex flex-wrap items-center gap-2">
              <div class="text-sm font-semibold text-zinc-700 dark:text-zinc-200 truncate">
                {{ currentDetail?.title || selectedItem?.title || '知识库详情' }}
              </div>
              <template v-if="intrinsicProperties">
                <span class="px-1.5 py-0.5 rounded bg-zinc-100 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                  {{ intrinsicProperties.total }} 个工具
                </span>
                <span class="text-[10px] text-zinc-500 dark:text-zinc-400">
                  默认中文描述；保存后同步 mcp.list_tools / mcp.describe_tool
                </span>
              </template>
              <template v-else-if="intrinsicPersonas">
                <span class="px-1.5 py-0.5 rounded bg-zinc-100 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                  {{ intrinsicPersonas.total }} 个 AI
                </span>
                <span class="text-[10px] text-zinc-500 dark:text-zinc-400">
                  人格 Prompt 与自动控制 Prompt，保存后同步 AI 配置
                </span>
              </template>
              <template v-else-if="systemPrompts">
                <span class="px-1.5 py-0.5 rounded bg-zinc-100 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                  {{ systemPrompts.total }} 项配置
                </span>
                <span class="text-[10px] text-zinc-500 dark:text-zinc-400">
                  系统设置提示词，保存后同步系统设置
                </span>
              </template>
              <template v-else-if="inheritanceSkills">
                <span class="px-1.5 py-0.5 rounded bg-zinc-100 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                  {{ inheritanceSkills.device_total }} 台在线设备
                </span>
                <span class="px-1.5 py-0.5 rounded bg-zinc-100 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                  {{ inheritanceSkills.total }} 个 MCP
                </span>
                <span class="text-[10px] text-zinc-500 dark:text-zinc-400">
                  按设备分类，展开查看详情
                </span>
              </template>
              <template v-else-if="inheritanceThoughts">
                <span class="px-1.5 py-0.5 rounded bg-zinc-100 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                  {{ inheritanceThoughts.installed_total }} 个本地快照
                </span>
                <span class="text-[10px] text-zinc-500 dark:text-zinc-400">
                  ClawHub：{{ inheritanceThoughts.registry_url }}
                </span>
              </template>
            </div>
            <div class="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400 truncate">
              <template v-if="intrinsicProperties">
                {{ currentDetail?.summary || intrinsicProperties.description }}
              </template>
              <template v-else-if="intrinsicPersonas">
                {{ currentDetail?.summary || intrinsicPersonas.description }}
              </template>
              <template v-else-if="systemPrompts">
                {{ currentDetail?.summary || systemPrompts.description }}
              </template>
              <template v-else-if="inheritanceSkills">
                {{ inheritanceSkills.description }}
              </template>
              <template v-else-if="inheritanceThoughts">
                {{ inheritanceThoughts.description }}
              </template>
              <template v-else>
                {{ currentDetail?.memory_id || selectedItem?.id }}
              </template>
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

            <div v-if="currentDetail.summary && !intrinsicProperties && !intrinsicPersonas && !systemPrompts && !inheritanceSkills && !inheritanceThoughts" class="mb-4">
              <div class="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1">摘要</div>
              <div class="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-800/40 p-3 rounded-lg border border-zinc-100 dark:border-zinc-800">
                {{ currentDetail.summary }}
              </div>
            </div>

            <template v-if="intrinsicProperties">
              <div class="space-y-4">
                <div v-if="propertyEditNotice" class="text-xs text-emerald-600 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900 rounded-lg px-3 py-2">
                  {{ propertyEditNotice }}
                </div>
                <div v-if="propertyEditError" class="text-xs text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/30 border border-rose-100 dark:border-rose-900 rounded-lg px-3 py-2">
                  {{ propertyEditError }}
                </div>
                <details
                  v-for="category in intrinsicProperties.categories"
                  :key="category.namespace"
                  :open="editingPropertyCategory === category.namespace || undefined"
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
                        <button
                          v-if="editingPropertyCategory !== category.namespace"
                          type="button"
                          class="px-2 py-0.5 rounded border border-indigo-200 bg-white text-[10px] text-indigo-600 hover:bg-indigo-50 dark:bg-zinc-900 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
                          @click.stop.prevent="startEditPropertyCategory(category)"
                        >
                          编辑
                        </button>
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
                          <textarea
                            v-if="editingPropertyCategory === category.namespace"
                            :value="propertyDraftToolDescription(tool.name)"
                            rows="3"
                            class="w-full resize-y text-xs leading-relaxed text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-900/70 p-2 rounded border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-800"
                            @input="updateDraftToolDescription(tool.name, ($event.target as HTMLTextAreaElement).value)"
                          />
                          <div v-else class="text-xs leading-relaxed text-zinc-700 dark:text-zinc-200">
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
                            <textarea
                              v-if="editingPropertyCategory === category.namespace"
                              :value="propertyDraftParamDescription(tool.name, param.name)"
                              rows="2"
                              class="w-full resize-y text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-900/70 px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-800"
                              @input="updateDraftParamDescription(tool.name, param.name, ($event.target as HTMLTextAreaElement).value)"
                            />
                            <span v-else class="text-zinc-600 dark:text-zinc-300">{{ param.description || '（无描述）' }}</span>
                          </div>
                        </div>
                        <div v-else class="text-[11px] text-zinc-500 dark:text-zinc-400">无参数</div>
                      </div>
                    </div>
                    <div v-if="editingPropertyCategory === category.namespace" class="flex justify-end gap-2 px-3 py-3">
                      <button
                        type="button"
                        class="px-3 py-1.5 rounded border border-zinc-200 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        :disabled="savingPropertyCategory === category.namespace"
                        @click="cancelEditPropertyCategory"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        class="px-3 py-1.5 rounded bg-indigo-600 text-xs text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                        :disabled="savingPropertyCategory === category.namespace"
                        @click="savePropertyCategory(category)"
                      >
                        {{ savingPropertyCategory === category.namespace ? '保存中…' : '保存' }}
                      </button>
                    </div>
                  </div>
                </details>
              </div>
            </template>
            <template v-else-if="intrinsicPersonas">
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
            <template v-else-if="systemPrompts">
              <div class="space-y-4">
                <div v-if="promptEditNotice" class="text-xs text-emerald-600 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900 rounded-lg px-3 py-2">
                  {{ promptEditNotice }}
                </div>
                <div v-if="promptEditError" class="text-xs text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/30 border border-rose-100 dark:border-rose-900 rounded-lg px-3 py-2">
                  {{ promptEditError }}
                </div>
                <details
                  v-for="section in systemPrompts.sections"
                  :key="section.key"
                  :open="editingPromptSection === section.key || undefined"
                  class="group rounded-lg border border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/40 overflow-hidden"
                >
                  <summary class="list-none cursor-pointer px-3 py-2 border-b border-zinc-100 dark:border-zinc-800 select-none">
                    <div class="flex items-center justify-between gap-3">
                      <div class="flex min-w-0 items-center gap-2">
                        <span class="text-zinc-400 transition-transform group-open:rotate-90">›</span>
                        <div class="truncate text-xs font-semibold text-zinc-700 dark:text-zinc-200">{{ section.title }}</div>
                      </div>
                      <div class="flex shrink-0 items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                        <span>{{ section.count }} 项</span>
                        <button
                          v-if="editingPromptSection !== section.key"
                          type="button"
                          class="px-2 py-0.5 rounded border border-indigo-200 bg-white text-[10px] text-indigo-600 hover:bg-indigo-50 dark:bg-zinc-900 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
                          @click.stop.prevent="startEditPromptSection(section)"
                        >
                          编辑
                        </button>
                      </div>
                    </div>
                  </summary>
                  <div class="divide-y divide-zinc-100 dark:divide-zinc-800">
                    <div
                      v-for="item in section.items"
                      :key="item.key"
                      class="px-3 py-3"
                    >
                      <div class="flex items-center justify-between gap-3 mb-1">
                        <div class="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">{{ item.label }}</div>
                        <code class="text-[10px] text-zinc-400 dark:text-zinc-500">{{ item.key }}</code>
                      </div>
                      <input
                        v-if="editingPromptSection === section.key && item.type === 'number'"
                        :value="promptDraftValue(item.key)"
                        type="number"
                        min="0"
                        max="3600"
                        class="w-full text-xs text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-900/70 px-2 py-1.5 rounded border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-800"
                        @input="updatePromptDraftValue(item.key, Number(($event.target as HTMLInputElement).value || 0))"
                      />
                      <textarea
                        v-else-if="editingPromptSection === section.key"
                        :value="promptDraftValue(item.key)"
                        rows="6"
                        class="w-full resize-y whitespace-pre-wrap font-mono text-xs leading-relaxed text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-900/70 p-3 rounded border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-800"
                        @input="updatePromptDraftValue(item.key, ($event.target as HTMLTextAreaElement).value)"
                      />
                      <pre v-else class="whitespace-pre-wrap font-mono text-xs leading-relaxed text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-900/70 p-3 rounded border border-zinc-100 dark:border-zinc-700">{{ item.content || '（空）' }}</pre>
                    </div>
                    <div v-if="editingPromptSection === section.key" class="flex justify-end gap-2 px-3 py-3">
                      <button
                        type="button"
                        class="px-3 py-1.5 rounded border border-zinc-200 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        :disabled="savingPromptSection === section.key"
                        @click="cancelEditPromptSection"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        class="px-3 py-1.5 rounded bg-indigo-600 text-xs text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                        :disabled="savingPromptSection === section.key"
                        @click="savePromptSection(section)"
                      >
                        {{ savingPromptSection === section.key ? '保存中…' : '保存' }}
                      </button>
                    </div>
                  </div>
                </details>
              </div>
            </template>
            <template v-else-if="inheritanceSkills">
              <div class="space-y-3">
                <div
                  v-if="!inheritanceSkills.devices.length"
                  class="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-4 py-10 text-center text-xs text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800/40 dark:text-zinc-500"
                >
                  暂无在线设备 MCP。设备连接并上报工具后会显示在这里。
                </div>
                <details
                  v-for="device in inheritanceSkills.devices"
                  :key="`${device.device_type}-${device.device_id}`"
                  class="group overflow-hidden rounded-lg border border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/40"
                >
                  <summary class="list-none cursor-pointer px-3 py-3 select-none">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <div class="flex min-w-0 items-center gap-2">
                        <span class="text-zinc-400 transition-transform group-open:rotate-90">›</span>
                        <div class="min-w-0">
                          <div class="truncate text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                            {{ deviceTypeLabel(device.device_type) }}
                          </div>
                          <div class="mt-0.5 text-[10px] text-zinc-400 dark:text-zinc-500">
                            设备号：{{ device.device_id || '未提供' }}
                            <template v-if="device.updated_at"> · 上报于 {{ formatTime(device.updated_at) }}</template>
                          </div>
                        </div>
                      </div>
                      <div class="flex shrink-0 items-center gap-2 text-[10px] text-zinc-500 dark:text-zinc-400">
                        <span class="rounded bg-white px-2 py-1 dark:bg-zinc-900">{{ device.tool_count }} 个 MCP</span>
                        <span class="text-zinc-400 group-open:hidden">展开详情</span>
                        <span class="hidden text-indigo-500 group-open:inline dark:text-indigo-300">收起</span>
                      </div>
                    </div>
                  </summary>
                  <div class="divide-y divide-zinc-100 border-t border-zinc-100 dark:divide-zinc-800 dark:border-zinc-800">
                    <div
                      v-for="tool in device.tools"
                      :key="`${device.device_id}-${tool.name}`"
                      class="bg-white px-3 py-3 dark:bg-zinc-900/40"
                    >
                      <div class="grid grid-cols-1 gap-2 md:grid-cols-[13rem_1fr]">
                        <div>
                          <div class="mb-0.5 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">调用工具</div>
                          <code class="break-all text-[11px] text-indigo-600 dark:text-indigo-300">{{ tool.name }}</code>
                        </div>
                        <div>
                          <div class="mb-0.5 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">工具描述</div>
                          <div class="text-xs leading-relaxed text-zinc-700 dark:text-zinc-200">
                            {{ tool.description || '（无描述）' }}
                            <span v-if="tool.destructive" class="ml-1 text-amber-600 dark:text-amber-300">可能产生写入/变更</span>
                          </div>
                        </div>
                      </div>
                      <div class="mt-2">
                        <div class="mb-1 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">参数说明</div>
                        <div v-if="toolParameters(tool).length" class="overflow-hidden rounded border border-zinc-100 dark:border-zinc-700">
                          <div
                            v-for="param in toolParameters(tool)"
                            :key="`${device.device_id}-${tool.name}-${param.name}`"
                            class="grid grid-cols-1 gap-2 border-b border-zinc-100 px-2 py-1.5 text-[11px] last:border-b-0 dark:border-zinc-700 md:grid-cols-[11rem_6rem_4rem_1fr]"
                          >
                            <code class="break-all text-zinc-700 dark:text-zinc-200">{{ param.name }}</code>
                            <span class="text-zinc-500 dark:text-zinc-400">{{ param.type || 'any' }}</span>
                            <span :class="param.required ? 'text-rose-600 dark:text-rose-300' : 'text-zinc-400 dark:text-zinc-500'">
                              {{ param.required ? '必填' : '可选' }}
                            </span>
                            <span class="text-zinc-600 dark:text-zinc-300">{{ param.description || '（无描述）' }}</span>
                          </div>
                        </div>
                        <div v-else class="text-[11px] text-zinc-500 dark:text-zinc-400">无参数</div>
                      </div>
                      <div v-if="tool.implementation" class="mt-3 rounded border border-indigo-100 bg-indigo-50/50 p-2.5 dark:border-indigo-900/60 dark:bg-indigo-950/20">
                        <div class="flex flex-wrap items-center justify-between gap-2">
                          <div class="text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">底层实现</div>
                          <code class="text-[10px] text-indigo-500 dark:text-indigo-400">{{ tool.implementation.kind || 'unknown' }}</code>
                        </div>
                        <div v-if="tool.implementation.source_files?.length" class="mt-2">
                          <div class="mb-1 text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">源码入口</div>
                          <div class="flex flex-wrap gap-1">
                            <code
                              v-for="sourceFile in tool.implementation.source_files"
                              :key="`${device.device_id}-${tool.name}-${sourceFile}`"
                              class="break-all rounded bg-white px-1.5 py-1 text-[10px] text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"
                            >{{ sourceFile }}</code>
                          </div>
                        </div>
                        <div v-if="tool.implementation.editable_via" class="mt-2 text-[10px] leading-relaxed text-zinc-600 dark:text-zinc-300">
                          修改入口：<code>{{ tool.implementation.editable_via }}</code>，先调用 <code>inspect</code>，再调用 <code>get_source</code> 读取源码或 <code>upsert</code> 创建同名覆盖。
                        </div>
                        <details v-if="tool.implementation.handler_source" class="mt-2">
                          <summary class="cursor-pointer text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">查看处理函数入口</summary>
                          <pre class="mt-1 max-h-52 overflow-auto whitespace-pre-wrap break-all rounded bg-white p-2 font-mono text-[10px] leading-relaxed text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">{{ tool.implementation.handler_source }}</pre>
                        </details>
                        <details v-if="tool.implementation.code?.length" class="mt-2" open>
                          <summary class="cursor-pointer text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">动态程序代码</summary>
                          <pre class="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-white p-2 font-mono text-[10px] leading-relaxed text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">{{ formatImplementationCode(tool.implementation.code) }}</pre>
                        </details>
                      </div>
                    </div>
                    <div v-if="!device.tools.length" class="px-3 py-6 text-center text-xs text-zinc-400">
                      该设备暂未上报 MCP 工具
                    </div>
                  </div>
                </details>
              </div>
            </template>
            <template v-else-if="inheritanceThoughts">
              <div class="space-y-4">
                <div v-if="clawhubNotice" class="text-xs text-emerald-600 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900 rounded-lg px-3 py-2">
                  {{ clawhubNotice }}
                </div>
                <div v-if="clawhubError" class="text-xs text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/30 border border-rose-100 dark:border-rose-900 rounded-lg px-3 py-2">
                  {{ clawhubError }}
                </div>

                <section class="rounded-lg border border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/40 p-3">
                  <div class="flex flex-wrap items-center justify-between gap-3">
                    <div class="min-w-0">
                      <div class="text-xs font-semibold text-zinc-700 dark:text-zinc-200">ClawHub</div>
                      <div class="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400 break-all">
                        {{ inheritanceThoughts.registry_url }} · 本地快照默认不自动启用
                      </div>
                    </div>
                    <button
                      type="button"
                      class="px-3 py-2 rounded bg-indigo-600 text-xs text-white hover:bg-indigo-500"
                      @click.stop.prevent="openClawHubModal"
                    >
                      搜索 ClawHub
                    </button>
                  </div>
                </section>

                <section v-if="inheritanceThoughts.installed.length" class="space-y-2">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <div class="text-xs font-semibold text-zinc-500 dark:text-zinc-400">已安装</div>
                    <div class="flex items-center gap-1 text-[10px]">
                      <button
                        v-for="opt in [{ v: 'all', t: '全部' }, { v: 'any', t: '通用' }, { v: 'desktop', t: '桌面端' }, { v: 'browser', t: '浏览器端' }]"
                        :key="opt.v"
                        type="button"
                        class="px-1.5 py-0.5 rounded border transition-colors"
                        :class="thoughtEndpointFilter === opt.v ? 'border-indigo-300 bg-indigo-50 text-indigo-600 dark:border-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300' : 'border-zinc-200 text-zinc-500 hover:border-indigo-200 dark:border-zinc-700 dark:text-zinc-400'"
                        @click.stop.prevent="thoughtEndpointFilter = opt.v as any"
                      >{{ opt.t }}</button>
                    </div>
                  </div>
                  <div v-if="filteredInstalledThoughts.length === 0" class="text-center text-[11px] text-zinc-400 py-4">该端暂无传承思想</div>
                  <button
                    v-for="skill in filteredInstalledThoughts"
                    :key="skill.slug"
                    type="button"
                    class="w-full text-left rounded-lg border border-zinc-100 bg-zinc-50 hover:border-indigo-200 dark:border-zinc-800 dark:bg-zinc-800/40 dark:hover:border-indigo-700 px-3 py-2 transition-colors"
                    @click.stop.prevent="openInstalledClawHubSkill(skill.slug)"
                  >
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <div class="min-w-0">
                        <div class="text-xs font-semibold text-zinc-800 dark:text-zinc-100 truncate">{{ skill.displayName || skill.slug }}</div>
                        <code class="text-[11px] text-indigo-600 dark:text-indigo-300 break-all">{{ skill.slug }}</code>
                      </div>
                      <div class="flex flex-wrap items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400">
                        <span class="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300">{{ endpointLabel(skill.endpoint_kind) }}</span>
                        <span class="px-1.5 py-0.5 rounded bg-white dark:bg-zinc-900">{{ skill.version || 'latest' }}</span>
                        <span class="px-1.5 py-0.5 rounded bg-white dark:bg-zinc-900">{{ skill.present ? '文件可用' : '文件缺失' }}</span>
                        <span class="px-1.5 py-0.5 rounded bg-white dark:bg-zinc-900 text-indigo-600 dark:text-indigo-300">查看/编辑</span>
                      </div>
                    </div>
                  </button>
                </section>
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
    <div
      v-if="clawhubModalOpen"
      class="fixed inset-0 z-[560] bg-black/55 flex items-center justify-center p-4"
      @click.self="closeClawHubModal"
    >
      <div class="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-[calc(100vw-2rem)] max-w-6xl h-[82vh] flex flex-col border border-zinc-200 dark:border-zinc-800">
        <div class="flex items-center justify-between px-5 py-3 border-b border-zinc-100 dark:border-zinc-800">
          <div class="min-w-0">
            <div class="text-sm font-semibold text-zinc-800 dark:text-zinc-100">ClawHub 搜索</div>
            <div class="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400 truncate">
              {{ inheritanceThoughts?.registry_url || 'https://clawhub.ai' }}
            </div>
          </div>
          <button class="ml-3 text-zinc-400 hover:text-zinc-600 text-xl leading-none" @click="closeClawHubModal">×</button>
        </div>

        <div class="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[22rem_1fr]">
          <aside class="min-h-0 border-b lg:border-b-0 lg:border-r border-zinc-100 dark:border-zinc-800 flex flex-col">
            <div class="p-3 border-b border-zinc-100 dark:border-zinc-800">
              <div class="flex gap-2">
                <input
                  v-model="clawhubQuery"
                  type="search"
                  class="min-w-0 flex-1 text-xs text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-900/70 px-3 py-2 rounded border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-800"
                  placeholder="calendar、github、browser"
                  @keydown.enter.prevent="searchClawHub"
                />
                <button
                  type="button"
                  class="px-3 py-2 rounded bg-indigo-600 text-xs text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                  :disabled="clawhubSearching"
                  @click="searchClawHub"
                >
                  {{ clawhubSearching ? '搜索中…' : '搜索' }}
                </button>
              </div>
            </div>

            <div class="flex-1 min-h-0 overflow-y-auto p-3 space-y-2 custom-scrollbar">
              <div v-if="clawhubError" class="text-xs text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/30 border border-rose-100 dark:border-rose-900 rounded-lg px-3 py-2">
                {{ clawhubError }}
              </div>
              <div v-if="clawhubNotice" class="text-xs text-emerald-600 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900 rounded-lg px-3 py-2">
                {{ clawhubNotice }}
              </div>
              <div v-if="!clawhubSearching && clawhubResults.length === 0" class="text-center text-zinc-400 text-xs py-10">
                输入关键词搜索 ClawHub
              </div>
              <button
                v-for="result in clawhubResults"
                :key="result.slug"
                type="button"
                class="w-full text-left rounded-lg border px-3 py-2 transition-colors"
                :class="clawhubSelected?.slug === result.slug ? 'border-indigo-300 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-950/30' : 'border-zinc-100 bg-zinc-50 hover:border-indigo-200 dark:border-zinc-800 dark:bg-zinc-800/40 dark:hover:border-indigo-700'"
                @click.stop.prevent="inspectClawHubSkill(result.slug)"
              >
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <div class="text-xs font-semibold text-zinc-800 dark:text-zinc-100 truncate">{{ result.displayName || result.slug }}</div>
                    <code class="text-[11px] text-indigo-600 dark:text-indigo-300 break-all">{{ result.slug }}</code>
                  </div>
                  <span v-if="clawhubInspectingSlug === result.slug" class="shrink-0 text-[10px] text-zinc-400">查看中…</span>
                </div>
                <div class="mt-1 flex flex-wrap gap-2 text-[10px] text-zinc-500 dark:text-zinc-400">
                  <span>{{ result.owner?.displayName || result.ownerHandle || 'unknown' }}</span>
                  <span>{{ result.version || 'latest' }}</span>
                  <span v-if="result.installed" class="text-emerald-600 dark:text-emerald-300">已安装</span>
                </div>
              </button>
            </div>
          </aside>

          <main class="min-h-0 flex flex-col">
            <div v-if="clawhubDetailLoading" class="flex-1 flex items-center justify-center text-sm text-zinc-400">详情加载中…</div>
            <div v-else-if="clawhubSelected" class="flex-1 min-h-0 flex flex-col">
              <div class="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2">
                <div class="min-w-0">
                  <div class="text-sm font-semibold text-zinc-800 dark:text-zinc-100 truncate">
                    {{ clawhubSelected.detail?.skill?.displayName || clawhubSelected.slug }}
                  </div>
                  <div class="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                    {{ clawhubSelected.slug }} · {{ clawhubSelected.version || 'latest' }} · 扫描：{{ clawhubScanLabel }}
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <label class="flex items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                    端
                    <select
                      v-model="installEndpointKind"
                      class="text-[11px] text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-900/70 px-1.5 py-1 rounded border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-800"
                    >
                      <option value="auto">自动判断</option>
                      <option value="any">通用</option>
                      <option value="desktop">桌面端</option>
                      <option value="browser">浏览器端</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    class="px-3 py-1.5 rounded bg-indigo-600 text-xs text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                    :disabled="clawhubInstallingSlug === clawhubSelected.slug"
                    @click.stop.prevent="installSelectedClawHubSkill(clawhubSelected.installed)"
                  >
                    {{ clawhubInstallingSlug === clawhubSelected.slug ? '处理中…' : (clawhubSelected.installed ? '更新快照' : '安装快照') }}
                  </button>
                </div>
              </div>
              <div class="flex-1 min-h-0 overflow-y-auto p-4 custom-scrollbar">
                <pre class="whitespace-pre-wrap font-mono text-xs leading-relaxed text-zinc-700 dark:text-zinc-200 bg-zinc-50 dark:bg-zinc-800/40 p-3 rounded-lg border border-zinc-100 dark:border-zinc-800">{{ clawhubSelected.skill_card || '（无内容）' }}</pre>
              </div>
            </div>
            <div v-else class="flex-1 flex items-center justify-center text-sm text-zinc-400">
              选择一个搜索结果查看 SKILL.md
            </div>
          </main>
        </div>
      </div>
    </div>
    <div
      v-if="installedClawhubModalOpen"
      class="fixed inset-0 z-[570] bg-black/55 flex items-center justify-center p-4"
      @click.self="closeInstalledClawHubModal"
    >
      <div class="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-[calc(100vw-2rem)] max-w-5xl h-[82vh] flex flex-col border border-zinc-200 dark:border-zinc-800">
        <div class="flex items-center justify-between px-5 py-3 border-b border-zinc-100 dark:border-zinc-800">
          <div class="min-w-0">
            <div class="text-sm font-semibold text-zinc-800 dark:text-zinc-100 truncate">
              {{ installedClawhubSelected?.skill?.displayName || installedClawhubSelected?.slug || '本地快照' }}
            </div>
            <div class="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400 truncate">
              {{ installedClawhubSelected?.slug || '加载中' }}
            </div>
          </div>
          <button class="ml-3 text-zinc-400 hover:text-zinc-600 text-xl leading-none" @click="closeInstalledClawHubModal">×</button>
        </div>

        <div v-if="installedClawhubLoading" class="flex-1 flex items-center justify-center text-sm text-zinc-400">加载中…</div>
        <div v-else class="flex-1 min-h-0 flex flex-col">
          <div class="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2">
            <div class="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
              <span class="px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800">{{ installedClawhubSelected?.skill?.version || 'latest' }}</span>
              <span class="px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800">{{ installedClawhubSelected?.present ? '文件可用' : '文件缺失' }}</span>
              <label class="flex items-center gap-1">
                端
                <select
                  :value="installedEndpointKind"
                  :disabled="installedEndpointSaving || !installedClawhubSelected"
                  class="text-[11px] text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-900/70 px-1.5 py-1 rounded border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-800 disabled:opacity-60"
                  @change="applyInstalledEndpoint(($event.target as HTMLSelectElement).value as 'any' | 'desktop' | 'browser')"
                >
                  <option value="any">通用</option>
                  <option value="desktop">桌面端</option>
                  <option value="browser">浏览器端</option>
                </select>
              </label>
              <span class="px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800 truncate max-w-[20rem]">{{ installedClawhubSelected?.path || '' }}</span>
            </div>
            <div class="flex gap-2">
              <button
                type="button"
                class="px-3 py-1.5 rounded border border-rose-200 bg-white text-xs text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-900 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/30"
                :disabled="installedClawhubDeleting || !installedClawhubSelected"
                @click.stop.prevent="removeInstalledClawHubSkill"
              >
                {{ installedClawhubDeleting ? '删除中…' : '删除' }}
              </button>
              <button
                type="button"
                class="px-3 py-1.5 rounded bg-indigo-600 text-xs text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                :disabled="installedClawhubSaving || !installedClawhubSelected"
                @click.stop.prevent="saveInstalledClawHubSkill"
              >
                {{ installedClawhubSaving ? '保存中…' : '保存' }}
              </button>
            </div>
          </div>
          <div v-if="installedClawhubError" class="mx-5 mt-3 text-xs text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/30 border border-rose-100 dark:border-rose-900 rounded-lg px-3 py-2">
            {{ installedClawhubError }}
          </div>
          <div v-if="installedClawhubNotice" class="mx-5 mt-3 text-xs text-emerald-600 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900 rounded-lg px-3 py-2">
            {{ installedClawhubNotice }}
          </div>
          <div class="flex-1 min-h-0 p-5">
            <textarea
              v-model="installedClawhubDraft"
              class="w-full h-full resize-none whitespace-pre font-mono text-xs leading-relaxed text-zinc-700 dark:text-zinc-200 bg-zinc-50 dark:bg-zinc-800/40 p-3 rounded-lg border border-zinc-100 dark:border-zinc-800 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-800"
              spellcheck="false"
            />
          </div>
        </div>
      </div>
    </div>
    </Teleport>
  </div>
</template>
