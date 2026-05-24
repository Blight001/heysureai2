import { computed, ref, type Ref } from 'vue'
import type { Agent, KnowledgeItem, ProjectItem } from '@/types'

interface UseDashboardUiOptions {
  unassignedProjectId: string
  agents: Ref<Agent[]>
  projects: Ref<ProjectItem[]>
  knowledgeBase: Ref<KnowledgeItem[]>
  addKnowledge: (title: string, author: string, tags: string[]) => void
}

export const useDashboardUi = (options: UseDashboardUiOptions) => {
  const { unassignedProjectId, agents, projects, knowledgeBase, addKnowledge } = options

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
  const projectFilterOpen = ref(false)
  const projectFilter = ref<'all' | 'active' | 'inactive'>('all')
  const knowledgeFilterOpen = ref(false)
  const knowledgeFilter = ref<'all' | 'inheritance' | 'system' | 'business'>('all')
  const userMenuOpen = ref(false)

  const openContextMenu = (payload: { agent: Agent; x: number; y: number }) => {
    contextMenu.value = {
      visible: true,
      x: payload.x,
      y: payload.y,
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

  const closeProjectFilter = () => {
    if (!projectFilterOpen.value) return
    projectFilterOpen.value = false
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

  const adminAgents = computed(() => agents.value.filter(a => a.role === 'admin' && a.status !== 'dead'))
  const activeAgents = computed(() => agents.value.filter(a => a.status !== 'dead').reverse())
  const deadAgents = computed(() => agents.value.filter(a => a.status === 'dead').reverse())

  const centerGridClass = computed(() => {
    if (leftCollapsed.value && rightCollapsed.value) {
      return 'grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-6'
    }
    if (leftCollapsed.value || rightCollapsed.value) {
      return 'grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-2 gap-6'
    }
    return 'grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-2 gap-6'
  })

  const projectGridClass = computed(() => {
    if (leftCollapsed.value && rightCollapsed.value) {
      return 'grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-2 gap-6'
    }
    if (leftCollapsed.value || rightCollapsed.value) {
      return 'grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-2 gap-6'
    }
    return 'grid grid-cols-1 gap-6'
  })

  const projectGroups = computed(() => {
    const base = [
      ...projects.value,
      {
        id: unassignedProjectId,
        name: '待分配/学习中',
        description: '尚未绑定项目的 Agent',
        status: 'running' as const,
        aiMemberIds: [],
        readonly: true,
      },
    ]

    return base.map(project => {
      const activeAgentsByProject = agents.value.filter(
        agent => agent.role === 'worker' && agent.status !== 'dead' && (agent.projectId || unassignedProjectId) === project.id
      )
      const deadAgentsByProject = agents.value.filter(
        agent => agent.role === 'worker' && agent.status === 'dead' && (agent.projectId || unassignedProjectId) === project.id
      )
      const aiMemberIds = Array.from(
        new Set(
          activeAgentsByProject
            .concat(deadAgentsByProject)
            .map(agent => agent.aiConfigId)
            .filter((id): id is number => typeof id === 'number')
        )
      ).sort((a, b) => a - b)

      return {
        ...project,
        aiMemberIds: project.id === unassignedProjectId ? aiMemberIds : (project.aiMemberIds?.length ? project.aiMemberIds : aiMemberIds),
        activeAgents: activeAgentsByProject,
        deadAgents: deadAgentsByProject,
      }
    }).filter(project => {
      if (projectFilter.value === 'active') return project.status === 'running'
      if (projectFilter.value === 'inactive') return project.status === 'ended'
      return true
    })
  })

  const filteredKnowledgeBase = computed(() => {
    if (knowledgeFilter.value === 'all') return knowledgeBase.value
    if (knowledgeFilter.value === 'inheritance') {
      return knowledgeBase.value.filter(item => item.tags.includes('传承'))
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
    projectFilterOpen,
    projectFilter,
    knowledgeFilterOpen,
    knowledgeFilter,
    userMenuOpen,
    openContextMenu,
    closeContextMenu,
    closeSettings,
    closeProjectFilter,
    closeKnowledgeFilter,
    openGuidanceDialog,
    closeGuidanceDialog,
    submitGuidance,
    closeUserMenu,
    adminAgents,
    activeAgents,
    deadAgents,
    centerGridClass,
    projectGridClass,
    projectGroups,
    filteredKnowledgeBase,
  }
}
