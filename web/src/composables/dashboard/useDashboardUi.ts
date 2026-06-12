import { computed, ref, type Ref } from 'vue'
import type { Agent, KnowledgeItem } from '@/types'

interface UseDashboardUiOptions {
  unassignedProjectId: string
  agents: Ref<Agent[]>
  knowledgeBase: Ref<KnowledgeItem[]>
  addKnowledge: (title: string, author: string, tags: string[]) => void
}

export const useDashboardUi = (options: UseDashboardUiOptions) => {
  const { unassignedProjectId, agents, knowledgeBase, addKnowledge } = options
  const CONTEXT_MENU_WIDTH = 144
  const CONTEXT_MENU_HEIGHT = 34
  const CONTEXT_MENU_MARGIN = 8

  const contextMenu = ref({
    visible: false,
    x: 0,
    y: 0,
    agent: null as Agent | null,
  })

  const guidanceDialog = ref({
    visible: false,
    agent: null as Agent | null,
    text: '',
  })

  const settingsOpen = ref(false)
  const leftCollapsed = ref(false)
  const rightCollapsed = ref(false)
  const knowledgeFilterOpen = ref(false)
  const knowledgeFilter = ref<'all' | 'intrinsic' | 'personas' | 'skills' | 'tools' | 'inheritance' | 'system' | 'business'>('all')
  const userMenuOpen = ref(false)

  const clampContextMenuPosition = (x: number, y: number) => {
    if (typeof window === 'undefined') return { x, y }
    const maxX = Math.max(CONTEXT_MENU_MARGIN, window.innerWidth - CONTEXT_MENU_WIDTH - CONTEXT_MENU_MARGIN)
    const maxY = Math.max(CONTEXT_MENU_MARGIN, window.innerHeight - CONTEXT_MENU_HEIGHT - CONTEXT_MENU_MARGIN)
    return {
      x: Math.min(Math.max(CONTEXT_MENU_MARGIN, x), maxX),
      y: Math.min(Math.max(CONTEXT_MENU_MARGIN, y), maxY),
    }
  }

  const openContextMenu = (payload: { agent: Agent; x: number; y: number }) => {
    const position = clampContextMenuPosition(payload.x, payload.y)
    contextMenu.value = {
      visible: true,
      x: position.x,
      y: position.y,
      agent: payload.agent,
    }
  }

  const closeContextMenu = () => {
    if (!contextMenu.value.visible) return
    contextMenu.value.visible = false
  }

  const closeSettings = () => {
    if (!settingsOpen.value) return
    settingsOpen.value = false
  }

  const closeKnowledgeFilter = () => {
    if (!knowledgeFilterOpen.value) return
    knowledgeFilterOpen.value = false
  }

  const openGuidanceDialog = () => {
    if (!contextMenu.value.agent) return
    guidanceDialog.value = {
      visible: true,
      agent: contextMenu.value.agent,
      text: '',
    }
    closeContextMenu()
  }

  const closeGuidanceDialog = () => {
    guidanceDialog.value.visible = false
    guidanceDialog.value.text = ''
    guidanceDialog.value.agent = null
  }

  const submitGuidance = () => {
    const { agent, text } = guidanceDialog.value
    if (!agent) return
    const trimmed = text.trim()
    if (!trimmed) {
      closeGuidanceDialog()
      return
    }
    if (agent.status !== 'dead') {
      agent.currentTask = `执行上帝指引：${trimmed}`
    } else {
      agent.summary = `上帝指引：${trimmed}`
    }
    addKnowledge(`上帝指引：${trimmed}`, '上帝', ['指引', agent.role === 'admin' ? '系统' : '业务'])
    closeGuidanceDialog()
  }

  const closeUserMenu = () => {
    if (!userMenuOpen.value) return
    userMenuOpen.value = false
  }

  const isUnassignedAgent = (agent: Agent) => (agent.projectId || unassignedProjectId) === unassignedProjectId

  const hasAssignedWork = (agent: Agent) => {
    const taskStatus = String(agent.currentTaskStatus || '').toLowerCase()
    const runStatus = String(agent.activeRunStatus || '').toLowerCase()
    const snapshotStatus = String(agent.taskCurrentOrRecent?.effectiveStatus || agent.taskCurrentOrRecent?.status || '').toLowerCase()
    const inactive = new Set(['', 'idle', 'completed', 'done', 'cancelled', 'canceled', 'stopped', 'error'])
    return (
      !inactive.has(taskStatus)
      || ['queued', 'running'].includes(runStatus)
      || (!!agent.taskCurrentOrRecent?.title && !inactive.has(snapshotStatus))
    )
  }

  const adminAgents = computed(() => agents.value.filter(a => a.role === 'admin' && a.status !== 'dead'))
  const sidebarMemberAgents = computed(() => agents.value.filter(
    agent => agent.role === 'worker'
      && agent.status !== 'dead'
      && isUnassignedAgent(agent)
      && !hasAssignedWork(agent)
  ))
  const activeAgents = computed(() => agents.value.filter(a => a.status !== 'dead').reverse())
  const deadAgents = computed(() => agents.value.filter(a => a.status === 'dead').reverse())

  const filteredKnowledgeBase = computed(() => {
    if (knowledgeFilter.value === 'all') return knowledgeBase.value
    if (knowledgeFilter.value === 'inheritance') {
      return knowledgeBase.value.filter(item => item.tags.includes('传承'))
    }
    if (knowledgeFilter.value === 'intrinsic') {
      return knowledgeBase.value.filter(item => item.tags.includes('固有属性'))
    }
    if (knowledgeFilter.value === 'personas') {
      return knowledgeBase.value.filter(item => item.tags.includes('固有人格'))
    }
    if (knowledgeFilter.value === 'skills') {
      return knowledgeBase.value.filter(item => item.tags.includes('传承技能'))
    }
    if (knowledgeFilter.value === 'tools') {
      return knowledgeBase.value.filter(item => item.tags.includes('传承思想'))
    }
    if (knowledgeFilter.value === 'system') {
      return knowledgeBase.value.filter(item => item.tags.includes('系统'))
    }
    if (knowledgeFilter.value === 'business') {
      return knowledgeBase.value.filter(item => item.tags.includes('业务'))
    }
    return knowledgeBase.value
  })

  return {
    contextMenu,
    guidanceDialog,
    settingsOpen,
    leftCollapsed,
    rightCollapsed,
    knowledgeFilterOpen,
    knowledgeFilter,
    userMenuOpen,
    openContextMenu,
    closeContextMenu,
    closeSettings,
    closeKnowledgeFilter,
    openGuidanceDialog,
    closeGuidanceDialog,
    submitGuidance,
    closeUserMenu,
    adminAgents,
    sidebarMemberAgents,
    activeAgents,
    deadAgents,
    filteredKnowledgeBase,
  }
}
