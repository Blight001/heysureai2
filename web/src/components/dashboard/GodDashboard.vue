<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from 'vue'
import { useMessage } from '@/composables/useMessage'
import { useMcpAndWorkspaceModal } from '@/composables/dashboard/useMcpAndWorkspaceModal'
import { useTaskManagement } from '@/composables/dashboard/useTaskManagement'
import { useAiConfigManagement } from '@/composables/dashboard/useAiConfigManagement'
import { useDashboardData } from '@/composables/dashboard/useDashboardData'
import { useDashboardUi } from '@/composables/dashboard/useDashboardUi'
import { useDashboardSystemSettings } from '@/composables/dashboard/useDashboardSystemSettings'
import {
  DASHBOARD_REFRESH_FAST_MS,
  DASHBOARD_REFRESH_HIDDEN_MS,
  DASHBOARD_REFRESH_NORMAL_MS,
  DASHBOARD_REFRESH_STREAM_MS,
  UNASSIGNED_PROJECT_ID,
} from '@/constants/dashboard'
import { DEFAULT_MCP_TOOLS } from '@/constants/mcp'
import type { Agent, McpRoleMeta, McpToolDefinition, User } from '@/types'

import logoUrl from '@/assets/logo/HeySure.png'
import { resolveAvatarUrl } from '@/utils/avatar'

const SystemSettingsPanel = defineAsyncComponent(() => import('./panels/SystemSettingsPanel.vue'))
const LeftSidebarPanel = defineAsyncComponent(() => import('./panels/LeftSidebarPanel.vue'))
const EvolutionArenaPanel = defineAsyncComponent(() => import('./panels/EvolutionArenaPanel.vue'))
const ValhallaPanel = defineAsyncComponent(() => import('./panels/ValhallaPanel.vue'))
const ChatInterface = defineAsyncComponent(() => import('@/components/chat/ChatInterface.vue'))
const McpToolsModal = defineAsyncComponent(() => import('./modals/McpToolsModal.vue'))
const WorkspaceContextModal = defineAsyncComponent(() => import('./modals/WorkspaceContextModal.vue'))
const TaskManagementModal = defineAsyncComponent(() => import('./modals/TaskManagementModal.vue'))
const AiConfigModal = defineAsyncComponent(() => import('./modals/AiConfigModal.vue'))
const AdminModal = defineAsyncComponent(() => import('./modals/AdminModal.vue'))
const ProposalReviewModal = defineAsyncComponent(() => import('@/components/librarian/ProposalReviewModal.vue'))

const { alert, confirm } = useMessage()

const props = defineProps<{
  currentUser?: User | null
}>()

const emit = defineEmits<{
  (e: 'login'): void
  (e: 'logout'): void
  (e: 'updateProfile'): void
  (e: 'refreshUser', user: User): void
  (e: 'ready'): void
}>()

const selectedFiles = ref<string[]>([])
const chatModalOpen = ref(false)
const chatTarget = ref<Agent | null>(null)
const proposalReviewOpen = ref(false)
const adminModalOpen = ref(false)
const isAdminUser = computed(() => ['owner', 'admin'].includes(props.currentUser?.role || ''))
let dashboardRefreshTimer: number | null = null
let dashboardRefreshLoopActive = false

const mcpToolMetaByName = ref<Record<string, McpToolDefinition>>({})
const mcpRoleMeta = ref<McpRoleMeta>({ order: [], labels: {}, defaults: {}, options: {}, permissions: {} })

const {
  themeMode,
  fontSize,
  brainViewMode,
  plainTextOutputEnabled,
  thinkingIcon,
  mcpSuccessIcon,
  mcpErrorIcon,
  thinkingIconEnabled,
  mcpSuccessIconEnabled,
  mcpErrorIconEnabled,
  tavilyApiKey,
  modelPresets,
  mcpMaxSteps,
  globalMcpCallMethod,
  mcpNamespaceHints,
  mcpDynamicRule,
  globalMcpFormatErrorHint,
  defaultStartTaskPrompt,
  defaultResumeTaskPrompt,
  defaultSupervisionPrompt,
  defaultSupervisionIdleSeconds,
  defaultInheritanceNotice,
  promptAiMessageNotify,
  promptAiMessageInquiry,
  aiMessageInquiryReminderSeconds,
  promptAiMessageInquiryReminder,
  promptAiMessageReply,
  promptAiMessageChitchat,
  promptAiMessageReplySuccess,
  promptUserMessageNotice,
  normalizeSystemAutoControl,
  saveSystemSettings,
  saveBrainViewMode,
  roleMcpPermissions,
  toggleRoleTool,
  setRoleAllTools,
  resetRoleMcpPermissions,
} = useDashboardSystemSettings({
  getCurrentUser: () => props.currentUser,
  alert,
  onRefreshUser: user => emit('refreshUser', user),
  mcpRoleMeta,
})

const effectiveThinkingIcon = computed(() => thinkingIconEnabled.value ? thinkingIcon.value : '')
const effectiveMcpSuccessIcon = computed(() => mcpSuccessIconEnabled.value ? mcpSuccessIcon.value : '')
const effectiveMcpErrorIcon = computed(() => mcpErrorIconEnabled.value ? mcpErrorIcon.value : '')

let resolveMcpAutoApprove = (_configId?: number) => false
const {
  agents,
  connectedAgents,
  knowledgeBase,
  projects,
  globalGeneration,
  allFiles,
  dashboardSocketConnected,
  syncChatTokensToAgents,
  loadProjectContext,
  loadAIAgents,
  loadValhallaEntries,
  valhallaEntries,
  librarianPending,
  createProject,
  updateProject,
  deleteProject,
  toggleAiRunByConfigId,
  addKnowledge,
  createSeedData,
  refreshDashboardLive,
} = useDashboardData({
  unassignedProjectId: UNASSIGNED_PROJECT_ID,
  alert,
  confirm,
  getCurrentUserId: () => Number(props.currentUser?.id),
  getMcpAutoApprove: configId => resolveMcpAutoApprove(configId),
})

const {
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
  sidebarMemberAgents,
  activeAgents,
  centerGridClass,
  projectGridClass,
  projectGroups,
  filteredKnowledgeBase,
} = useDashboardUi({
  unassignedProjectId: UNASSIGNED_PROJECT_ID,
  agents,
  projects,
  knowledgeBase,
  addKnowledge,
})

const {
  toolModalOpen,
  toolModalTitle,
  toolModalItems,
  workspaceContextModalOpen,
  workspaceContextModalLoading,
  workspaceContextModalTitle,
  workspaceContextModalTree,
  workspaceContextModalGitDiff,
  workspaceContextModalError,
  workspaceContextModalChanged,
  workspaceContextModalTarget,
  showAgentTools,
  showAllServerMcpTools,
  closeWorkspaceContextModal,
  loadAgentWorkspaceContext,
  openAgentWorkspaceContext,
} = useMcpAndWorkspaceModal({ mcpToolMetaByName })

const defaultMcpTools = [...DEFAULT_MCP_TOOLS]

const {
  aiConfigModalOpen,
  aiConfigDeleteConfirm,
  aiConfigSettingsSection,
  aiConfigMode,
  aiConfigForm,
  availableMcpTools,
  configAvailableMcpTools,
  availableWorkspaceDirs,
  workspaceDirsLoading,
  workspaceDirsError,
  getMcpAutoApprove,
  loadMcpTools,
  toggleAiConfigSettingsSection,
  openCreateAiConfig,
  openAgentSettings,
  toggleAiRunInSettings,
  saveAiConfig,
  deleteAiConfig,
  onToolCheckboxChange,
} = useAiConfigManagement({
  defaultMcpTools,
  mcpToolMetaByName,
  mcpRoleMeta,
  modelPresets,
  normalizeSystemAutoControl,
  alert,
  onToggleAiRunByConfigId: toggleAiRunByConfigId,
  onReloadAgents: loadAIAgents,
  onPatchChatTargetAutoApprove: (configId, enabled) => {
    const currentTarget = chatTarget.value
    if (currentTarget && currentTarget.aiConfigId === configId) {
      chatTarget.value = { ...currentTarget, mcpAutoApprove: enabled }
    }
  },
})
resolveMcpAutoApprove = getMcpAutoApprove

const {
  taskListModalOpen,
  taskListTarget,
  taskListItems,
  taskJobs,
  selectedTaskJobIds,
  taskListLoading,
  taskCreatePanelOpen,
  taskCreateSubmitting,
  taskWorkspaceDirs,
  taskWorkspaceDirsLoading,
  taskWorkspaceDirsError,
  taskDetailOpen,
  taskDetailLoading,
  taskDetailJob,
  taskGenerations,
  selectedGeneration,
  taskCreateForm,
  fetchAgentTaskList,
  openAgentTaskList,
  closeAgentTaskList,
  openTaskDetail,
  closeTaskDetail,
  toggleTaskCreatePanel,
  openTaskCreatePanelFromJob,
  closeTaskCreatePanel,
  onTaskCreateToolChange,
  submitTaskForAgent,
  pauseTaskJob,
  resumeTaskJob,
  deleteTaskJob,
  onTaskJobSelectChange,
  onSelectAllTaskJobsChange,
  batchDeleteTaskJobs,
  refreshOpenTaskPanel,
} = useTaskManagement({
  availableMcpTools,
  defaultMcpTools,
  alert,
  confirm,
  onReloadAgents: loadAIAgents,
})

const findFreshAgent = (agent: Agent | null) => {
  if (!agent) return null
  const configId = Number(agent.aiConfigId)
  if (Number.isFinite(configId)) {
    const byConfig = agents.value.find(item => Number(item.aiConfigId) === configId)
    if (byConfig) return byConfig
  }
  return agents.value.find(item => item.id === agent.id) || agent
}

const syncOpenAgentReferences = () => {
  chatTarget.value = findFreshAgent(chatTarget.value)
  taskListTarget.value = findFreshAgent(taskListTarget.value)
  workspaceContextModalTarget.value = findFreshAgent(workspaceContextModalTarget.value)
  if (workspaceContextModalTarget.value) {
    workspaceContextModalTitle.value = workspaceContextModalTarget.value.name
  }
}

const refreshDashboardAfterSave = async () => {
  await refreshDashboardLive(refreshOpenTaskPanel, { force: true })
  syncOpenAgentReferences()
}

const saveAiConfigAndRefresh = async () => {
  const saved = await saveAiConfig()
  if (saved) await refreshDashboardAfterSave()
}

const deleteAiConfigAndRefresh = async () => {
  await deleteAiConfig()
  await refreshDashboardAfterSave()
}

const openAllMcpToolsFromSystemSettings = async () => {
  if (Object.keys(mcpToolMetaByName.value || {}).length === 0) {
    await loadMcpTools()
  }
  showAllServerMcpTools('当前服务器所有的mcp接口')
}

const openAgentChat = (agent: Agent) => {
  if (!agent.aiConfigId) return
  chatTarget.value = agent
  chatModalOpen.value = true
}

const closeAgentChat = () => {
  chatModalOpen.value = false
}

const chatTargetAiKind = computed<'assistant' | 'core'>(() => {
  return chatTarget.value?.aiRole === 'assistant_admin' ? 'assistant' : 'core'
})

const openAgentTaskDetailFromCard = async (payload: { agent: Agent; jobId: string }) => {
  const agent = payload?.agent
  const jobId = String(payload?.jobId || '').trim()
  if (!agent?.aiConfigId) return

  await openAgentTaskList(agent)
  if (!jobId) return

  const job = taskJobs.value.find(row => String(row.job_id) === jobId)
  if (!job) {
    void alert({ message: '未找到该任务记录，已打开任务列表。', type: 'warning' })
    return
  }
  await openTaskDetail(job)
}

const stopDashboardRefreshLoop = () => {
  dashboardRefreshLoopActive = false
  if (!dashboardRefreshTimer) return
  window.clearTimeout(dashboardRefreshTimer)
  dashboardRefreshTimer = null
}

const hasLiveThinking = computed(() => {
  return agents.value.some(agent => {
    const liveText = String(agent.latestThinking || '').trim()
    return !!liveText
  })
})

const getDashboardRefreshInterval = () => {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return DASHBOARD_REFRESH_HIDDEN_MS
  if (hasLiveThinking.value) return DASHBOARD_REFRESH_STREAM_MS
  if (taskListModalOpen.value) return DASHBOARD_REFRESH_FAST_MS
  return dashboardSocketConnected.value ? DASHBOARD_REFRESH_NORMAL_MS : DASHBOARD_REFRESH_FAST_MS
}

const startDashboardRefreshLoop = () => {
  dashboardRefreshLoopActive = true
  stopDashboardRefreshLoop()
  dashboardRefreshLoopActive = true
  const scheduleNext = () => {
    if (!dashboardRefreshLoopActive) return
    const delay = getDashboardRefreshInterval()
    dashboardRefreshTimer = window.setTimeout(async () => {
      if (!dashboardRefreshLoopActive) return
      try {
        await refreshDashboardLive(refreshOpenTaskPanel)
      } finally {
        scheduleNext()
      }
    }, delay)
  }
  scheduleNext()
}

const handleDashboardVisibilityChange = () => {
  if (document.visibilityState !== 'visible') return
  void refreshDashboardLive(refreshOpenTaskPanel)
}

watch(
  () => dashboardSocketConnected.value,
  (connected, previous) => {
    if (connected && !previous) {
      void refreshDashboardLive(refreshOpenTaskPanel)
    }
  }
)

watch(
  agents,
  () => {
    syncOpenAgentReferences()
  },
  { flush: 'post' }
)

onMounted(async () => {
  try {
    await Promise.all([
      createSeedData(),
      loadMcpTools(),
    ])
  } finally {
    // 即使初始化部分失败，也通知外层撤下加载遮罩，避免界面卡在加载态
    emit('ready')
  }
  startDashboardRefreshLoop()
  document.addEventListener('visibilitychange', handleDashboardVisibilityChange)
})

onUnmounted(() => {
  stopDashboardRefreshLoop()
  document.removeEventListener('visibilitychange', handleDashboardVisibilityChange)
})
</script>

<template>
  <div class="relative isolate h-screen flex flex-col bg-zinc-50 text-zinc-900 overflow-hidden font-sans dark:bg-zinc-950 dark:text-zinc-100 bg-gradient-to-br from-zinc-50 via-zinc-100 to-indigo-50/30 dark:from-zinc-950 dark:via-zinc-900 dark:to-indigo-950/20 animate-gradient" @click="closeContextMenu(); closeSettings(); closeProjectFilter(); closeKnowledgeFilter(); closeUserMenu()">
    <div class="app-background-glow pointer-events-none absolute inset-0"></div>
    <div class="pointer-events-none absolute inset-0 opacity-60">
      <div class="app-background-orb app-background-orb-left"></div>
      <div class="app-background-orb app-background-orb-right"></div>
    </div>

    <div class="relative z-[1] flex h-full flex-col">
    <!-- 顶部导航栏 -->
    <header class="glass border-b border-zinc-200/50 px-4 md:px-6 py-3 flex justify-between items-center shadow-sm z-10 h-16 shrink-0 dark:border-zinc-800/50 backdrop-blur-md">
      <div class="flex items-center gap-2 md:gap-4 overflow-hidden">
        <img :src="logoUrl" alt="HeySure Logo" class="w-8 h-8 md:w-10 md:h-10 object-contain hover:scale-110 transition-transform duration-300 shrink-0" />
        <div class="overflow-hidden">
          <h1 class="text-sm md:text-lg font-bold text-zinc-900 tracking-tight dark:text-zinc-100 truncate">HeySure<span class="hidden sm:inline">-数字社会控制台</span> <span class="text-zinc-400 font-normal ml-2 dark:text-zinc-500 hidden lg:inline">HeySure-Digital Society Console</span></h1>
          <p class="text-[10px] md:text-xs text-zinc-500 dark:text-zinc-400 truncate">进化引擎已启动</p>
        </div>
      </div>
      <div class="flex gap-2 md:gap-4 text-sm items-center relative shrink-0">
        <div class="hidden sm:flex flex-col items-end">
           <span class="text-xs text-zinc-400 uppercase font-semibold">存活个体</span>
           <span class="text-lg font-bold text-indigo-600 leading-none">{{ agents.filter(a => a.status !== 'dead').length }}</span>
        </div>
        <div class="hidden sm:block w-px h-8 bg-zinc-200 dark:bg-zinc-700"></div>
        <div class="hidden sm:flex flex-col items-end">
           <span class="text-xs text-zinc-400 uppercase font-semibold">文明代数</span>
           <span class="text-lg font-bold text-emerald-600 leading-none">Gen {{ globalGeneration }}</span>
        </div>
        <button
          v-if="isAdminUser"
          class="ml-2 w-8 h-8 md:w-9 md:h-9 rounded-full border border-amber-200 bg-white text-amber-600 hover:text-amber-700 hover:border-amber-300 hover:bg-amber-50 transition-colors dark:bg-zinc-800 dark:border-amber-700/60 dark:text-amber-300 dark:hover:text-amber-200 shadow-sm hover:shadow-md flex items-center justify-center"
          title="管理员控制台"
          @click.stop="adminModalOpen = true; closeContextMenu()"
        >
          <span class="block text-xs md:text-base">🛡️</span>
        </button>
        <button class="ml-2 w-8 h-8 md:w-9 md:h-9 rounded-full border border-zinc-200 bg-white text-zinc-600 hover:text-indigo-600 hover:border-indigo-200 hover:bg-indigo-50 transition-colors dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-300 dark:hover:text-indigo-300 shadow-sm hover:shadow-md flex items-center justify-center" @click.stop="settingsOpen = true; closeContextMenu()">
          <span class="block hover:rotate-90 transition-transform duration-300 text-xs md:text-base">⚙️</span>
        </button>

        <!-- User Profile -->
        <div class="ml-2 md:ml-4 flex items-center gap-3 pl-2 md:pl-4 border-l border-zinc-200 dark:border-zinc-700 relative">
          <template v-if="currentUser">
            <button class="flex items-center gap-2 hover:bg-zinc-50 p-1 rounded-lg transition-colors dark:hover:bg-zinc-800" @click.stop="userMenuOpen = !userMenuOpen">
              <img :src="resolveAvatarUrl(currentUser.avatar) || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + currentUser.name"
                   class="w-7 h-7 md:w-8 md:h-8 rounded-full border border-zinc-200 bg-zinc-50 object-cover" />
              <div class="hidden md:flex flex-col items-start text-left">
                <span class="text-sm font-bold text-zinc-700 dark:text-zinc-200 leading-none mb-1">{{ currentUser.name }}</span>
                <span class="text-[10px] text-zinc-400 leading-none">ID: {{ currentUser.account }}</span>
              </div>
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-zinc-400 ml-1 transition-transform duration-200 hidden md:block" :class="{ 'rotate-180': userMenuOpen }" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            <!-- User Dropdown Menu -->
            <Transition name="fade">
              <div v-if="userMenuOpen" class="absolute right-0 top-12 w-48 bg-white border border-zinc-200 rounded-xl shadow-lg py-1 z-50 dark:bg-zinc-900 dark:border-zinc-700" @click.stop>
                <button @click="$emit('updateProfile'); userMenuOpen = false" class="w-full text-left px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 flex items-center gap-2 dark:text-zinc-300 dark:hover:bg-zinc-800">
                  <span class="text-zinc-400">✏️</span> 修改资料
                </button>
                <div class="h-px bg-zinc-100 my-1 dark:bg-zinc-800"></div>
                <button @click="$emit('logout'); userMenuOpen = false" class="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 dark:text-red-400 dark:hover:bg-red-900/20">
                  <span class="text-red-400">🚪</span> 退出登录
                </button>
              </div>
            </Transition>
          </template>
          <button v-else @click="$emit('login')" class="text-sm font-medium text-indigo-600 hover:text-indigo-700 px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition-colors dark:text-indigo-400 dark:hover:bg-indigo-900/20">
            登录 / 注册
          </button>
        </div>
      </div>
    </header>

    <!-- 主体内容区域 -->
    <main class="flex-1 overflow-y-auto lg:overflow-hidden p-6 flex flex-col lg:flex-row" :class="leftCollapsed || rightCollapsed ? 'gap-4' : 'gap-6'">

      <!-- 左侧：数字社会核心管理员 (管理员 + 知识库) -->
      <section class="flex flex-col gap-6 transition-all duration-300 relative shrink-0" :class="leftCollapsed ? 'lg:w-10 lg:min-w-[40px] w-full' : 'lg:w-[30%] lg:min-w-[420px] w-full'">
        <button class="hidden lg:block absolute -right-3 top-4 w-6 h-6 rounded-full border border-zinc-200 bg-white text-zinc-500 text-xs shadow hover:text-indigo-600 hover:border-indigo-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-300 dark:hover:text-indigo-300 z-10 transition-transform hover:scale-110" @click="leftCollapsed = !leftCollapsed">
          {{ leftCollapsed ? '⟩' : '⟨' }}
        </button>
        <div v-if="leftCollapsed" class="hidden lg:flex flex-1 items-center justify-center text-zinc-400 text-xs dark:text-zinc-500">
          数字社会核心管理员
        </div>
        <div v-else class="h-auto lg:h-full">
          <LeftSidebarPanel
            :admin-agents="adminAgents"
            :member-agents="sidebarMemberAgents"
            :active-agents="activeAgents"
            :connected-agents="connectedAgents"
            :brain-view-mode="brainViewMode"
            @context="openContextMenu"
            @update:brain-view-mode="saveBrainViewMode"
            @show-tools="showAgentTools"
            @show-context="openAgentWorkspaceContext"
            @show-tasks="openAgentTaskList"
            @show-task-detail="openAgentTaskDetailFromCard"
            @chat="openAgentChat"
            @settings="openAgentSettings"
            @create-ai="openCreateAiConfig('assistant_admin')"
          />
        </div>
      </section>

      <!-- 中间：进化场 (Worker Agents) -->
      <EvolutionArenaPanel
        class="h-auto lg:h-full min-h-[500px] lg:min-h-0"
        :project-groups="projectGroups"
        :project-grid-class="projectGridClass"
        :center-grid-class="centerGridClass"
        :filter-open="projectFilterOpen"
        :filter-value="projectFilter"
        :all-agents="agents"
        @update:filter-open="projectFilterOpen = $event"
        @update:filter-value="projectFilter = $event"
        @context="openContextMenu"
        @show-tools="showAgentTools"
        @show-context="openAgentWorkspaceContext"
        @show-tasks="openAgentTaskList"
        @show-task-detail="openAgentTaskDetailFromCard"
        @chat="openAgentChat"
        @settings="openAgentSettings"
        @create-project="createProject"
        @update-project="updateProject"
        @delete-project="deleteProject"
      />

      <!-- 右侧：英灵殿 (Logs / Dead Agents) -->
      <section class="transition-all duration-300 relative shrink-0" :class="rightCollapsed ? 'lg:w-10 lg:min-w-[40px] w-full' : 'lg:w-1/4 lg:min-w-[300px] w-full'">
        <button class="hidden lg:block absolute -left-3 top-4 w-6 h-6 rounded-full border border-zinc-200 bg-white text-zinc-500 text-xs shadow hover:text-indigo-600 hover:border-indigo-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-300 dark:hover:text-indigo-300 z-10 transition-transform hover:scale-110" @click="rightCollapsed = !rightCollapsed">
          {{ rightCollapsed ? '⟨' : '⟩' }}
        </button>
        <div v-if="rightCollapsed" class="hidden lg:flex h-full items-center justify-center text-zinc-400 text-xs dark:text-zinc-500">
          英灵殿
        </div>
        <div v-else class="flex flex-col gap-4 h-auto lg:h-full">
          <ValhallaPanel
            :entries="valhallaEntries"
            :active-agents="activeAgents"
            :connected-agents="connectedAgents"
            :knowledge-items="filteredKnowledgeBase"
            :knowledge-total-count="filteredKnowledgeBase.length"
            :librarian-pending-count="librarianPending.length"
            :knowledge-filter-open="knowledgeFilterOpen"
            :knowledge-filter-value="knowledgeFilter"
            @refresh="loadValhallaEntries"
            @update:knowledge-filter-open="knowledgeFilterOpen = $event"
            @update:knowledge-filter-value="knowledgeFilter = $event"
            @open-proposal-review="proposalReviewOpen = true; closeContextMenu()"
            @refresh-user="emit('refreshUser', $event)"
          />
        </div>
      </section>

    </main>

    <McpToolsModal
      :show="toolModalOpen"
      :title="toolModalTitle"
      :items="toolModalItems"
      @close="toolModalOpen = false"
    />

    <WorkspaceContextModal
      :show="workspaceContextModalOpen"
      :loading="workspaceContextModalLoading"
      :title="workspaceContextModalTitle"
      :tree="workspaceContextModalTree"
      :gitDiff="workspaceContextModalGitDiff"
      :error="workspaceContextModalError"
      :changedPaths="workspaceContextModalChanged"
      :canRefresh="!!workspaceContextModalTarget"
      @close="closeWorkspaceContextModal"
      @refresh="workspaceContextModalTarget && loadAgentWorkspaceContext(workspaceContextModalTarget)"
    />

    <TaskManagementModal
      :show="taskListModalOpen && !!taskListTarget"
      :target="taskListTarget"
      :task-list-items="taskListItems"
      :task-jobs="taskJobs"
      :selected-task-job-ids="selectedTaskJobIds"
      :task-list-loading="taskListLoading"
      :task-create-panel-open="taskCreatePanelOpen"
      :task-create-submitting="taskCreateSubmitting"
      :task-create-form="taskCreateForm"
      :available-mcp-tools="availableMcpTools"
      :default-mcp-tools="defaultMcpTools"
      :available-workspace-dirs="taskWorkspaceDirs"
      :workspace-dirs-loading="taskWorkspaceDirsLoading"
      :workspace-dirs-error="taskWorkspaceDirsError"
      :task-detail-open="taskDetailOpen"
      :task-detail-loading="taskDetailLoading"
      :task-detail-job="taskDetailJob"
      :task-generations="taskGenerations"
      :selected-generation="selectedGeneration"
      :on-close="closeAgentTaskList"
      :on-refresh="() => taskListTarget && fetchAgentTaskList(taskListTarget)"
      :on-toggle-task-create-panel="() => taskListTarget && toggleTaskCreatePanel(taskListTarget)"
      :on-close-task-create-panel="closeTaskCreatePanel"
      :on-submit-task="() => submitTaskForAgent(taskListTarget)"
      :on-task-create-tool-change="onTaskCreateToolChange"
      :on-open-task-detail="openTaskDetail"
      :on-reuse-task-template="(job) => taskListTarget && openTaskCreatePanelFromJob(taskListTarget, job)"
      :on-pause-task-job="(job) => taskListTarget && pauseTaskJob(taskListTarget, job)"
      :on-resume-task-job="(job) => taskListTarget && resumeTaskJob(taskListTarget, job)"
      :on-delete-task-job="(job) => taskListTarget && deleteTaskJob(taskListTarget, job)"
      :on-toggle-all-task-jobs-selection="onSelectAllTaskJobsChange"
      :on-task-job-select-change="onTaskJobSelectChange"
      :on-batch-delete-task-jobs="() => batchDeleteTaskJobs(taskListTarget)"
      :on-close-task-detail="closeTaskDetail"
      :on-update-selected-generation="(value) => selectedGeneration = value"
    />
    <Transition name="fade">
      <div v-if="chatTarget && chatModalOpen" class="fixed inset-0 z-[90] bg-black/45 flex items-center justify-center p-4" @click="closeAgentChat">
        <div class="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-700 shadow-xl w-full max-w-5xl h-[88vh] flex flex-col" @click.stop>
          <div class="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
            <div>
              <div class="text-sm font-semibold text-zinc-800 dark:text-zinc-100">与 {{ chatTarget.name }} 对话</div>
              <div class="text-xs text-zinc-500 dark:text-zinc-400">模型: {{ chatTarget.model || '未设置' }}</div>
            </div>
            <button class="text-xs px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-300" @click="closeAgentChat">关闭</button>
          </div>
          <div class="flex-1 min-h-0 p-4">
            <ChatInterface
              :key="`unified-chat-${chatTarget.aiConfigId}`"
              :adminModel="chatTarget.model || ''"
              :aiConfigId="chatTarget.aiConfigId"
              :aiKind="chatTargetAiKind"
              :mcpAutoApprove="!!chatTarget.mcpAutoApprove"
              :thinkingIcon="effectiveThinkingIcon"
              :mcpIcon="effectiveMcpSuccessIcon"
              :mcpSuccessIcon="effectiveMcpSuccessIcon"
              :mcpErrorIcon="effectiveMcpErrorIcon"
              :mcpDynamicRule="mcpDynamicRule"
            :selectedFiles="selectedFiles"
            :allFiles="allFiles"
            @update:selectedFiles="selectedFiles = $event"
            @open-settings="chatTarget && openAgentSettings(chatTarget)"
            @totalChatTokensUpdate="syncChatTokensToAgents"
            @refreshFiles="loadProjectContext"
          />
        </div>
      </div>
      </div>
    </Transition>

    <AiConfigModal
      :show="aiConfigModalOpen"
      :mode="aiConfigMode"
      :form="aiConfigForm"
      :delete-confirm="aiConfigDeleteConfirm"
      :settings-section="aiConfigSettingsSection"
      :available-mcp-tools="configAvailableMcpTools"
      :connected-agents="connectedAgents"
      :available-workspace-dirs="availableWorkspaceDirs"
      :workspace-dirs-loading="workspaceDirsLoading"
      :workspace-dirs-error="workspaceDirsError"
      :model-presets="modelPresets"
      :on-close="() => aiConfigModalOpen = false"
      :on-toggle-settings-section="toggleAiConfigSettingsSection"
      :on-tool-checkbox-change="onToolCheckboxChange"
      :on-toggle-run="toggleAiRunInSettings"
      :on-toggle-delete-confirm="() => aiConfigDeleteConfirm = !aiConfigDeleteConfirm"
      :on-save="saveAiConfigAndRefresh"
      :on-delete="deleteAiConfigAndRefresh"
    />
    <SystemSettingsPanel
      v-model:show="settingsOpen"
      v-model:globalMcpCallMethod="globalMcpCallMethod"
      v-model:mcpNamespaceHints="mcpNamespaceHints"
      v-model:mcpDynamicRule="mcpDynamicRule"
      v-model:globalMcpFormatErrorHint="globalMcpFormatErrorHint"
      v-model:defaultStartTaskPrompt="defaultStartTaskPrompt"
      v-model:defaultResumeTaskPrompt="defaultResumeTaskPrompt"
      v-model:defaultSupervisionPrompt="defaultSupervisionPrompt"
      v-model:defaultSupervisionIdleSeconds="defaultSupervisionIdleSeconds"
      v-model:defaultInheritanceNotice="defaultInheritanceNotice"
      v-model:promptAiMessageNotify="promptAiMessageNotify"
      v-model:promptAiMessageInquiry="promptAiMessageInquiry"
      v-model:aiMessageInquiryReminderSeconds="aiMessageInquiryReminderSeconds"
      v-model:promptAiMessageInquiryReminder="promptAiMessageInquiryReminder"
      v-model:promptAiMessageReply="promptAiMessageReply"
      v-model:promptAiMessageChitchat="promptAiMessageChitchat"
      v-model:promptAiMessageReplySuccess="promptAiMessageReplySuccess"
      v-model:promptUserMessageNotice="promptUserMessageNotice"
      v-model:themeMode="themeMode"
      v-model:fontSize="fontSize"
      v-model:thinkingIcon="thinkingIcon"
      v-model:mcpSuccessIcon="mcpSuccessIcon"
      v-model:mcpErrorIcon="mcpErrorIcon"
      v-model:thinkingIconEnabled="thinkingIconEnabled"
      v-model:mcpSuccessIconEnabled="mcpSuccessIconEnabled"
      v-model:mcpErrorIconEnabled="mcpErrorIconEnabled"
      v-model:plainTextOutputEnabled="plainTextOutputEnabled"
      v-model:tavilyApiKey="tavilyApiKey"
      v-model:modelPresets="modelPresets"
      v-model:mcpMaxSteps="mcpMaxSteps"
      :mcp-role-meta="mcpRoleMeta"
      :role-mcp-permissions="roleMcpPermissions"
      @view-all-mcp="openAllMcpToolsFromSystemSettings"
      @toggle-role-tool="payload => toggleRoleTool(payload.role, payload.tool, payload.checked)"
      @set-role-all-tools="payload => setRoleAllTools(payload.role, payload.checked)"
      @reset-role-mcp-permissions="resetRoleMcpPermissions"
      @save="saveSystemSettings"
    />

    <AdminModal
      :show="adminModalOpen"
      :current-user="currentUser"
      @close="adminModalOpen = false"
    />


    <Transition name="fade">
      <div
        v-if="contextMenu.visible"
        class="fixed z-50 bg-white border border-zinc-200 rounded-lg shadow-lg text-xs text-zinc-700 w-36 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-200"
        :style="{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }"
        @click.stop
      >
        <button class="w-full text-left px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800" @click="openGuidanceDialog">
          给予指引
        </button>
      </div>
    </Transition>

    <Transition name="fade">
      <div v-if="guidanceDialog.visible" class="fixed inset-0 z-40 bg-black/40 flex items-center justify-center backdrop-blur-sm" @click="closeGuidanceDialog">
        <div class="bg-white rounded-2xl shadow-xl w-[420px] p-5 dark:bg-zinc-900 transform transition-all scale-100" @click.stop>
          <h3 class="text-sm font-semibold text-zinc-800 mb-3 dark:text-zinc-100">上帝指引</h3>
          <div class="text-xs text-zinc-500 mb-2 dark:text-zinc-400">{{ guidanceDialog.agent?.name }}</div>
          <textarea
            v-model="guidanceDialog.text"
            rows="4"
            class="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100"
            placeholder="输入指引内容，让 AI 执行..."
          ></textarea>
          <div class="mt-4 flex justify-end gap-2">
            <button class="px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200" @click="closeGuidanceDialog">取消</button>
            <button class="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-500 dark:bg-indigo-500 dark:hover:bg-indigo-400" @click="submitGuidance">确认指引</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Librarian proposal review modal -->
    <ProposalReviewModal
      :show="proposalReviewOpen"
      @close="proposalReviewOpen = false"
    />

    </div>
  </div>
</template>

<style scoped>
.task-running-border {
  animation: taskRunningPulse 1.6s ease-in-out infinite;
}

@keyframes taskRunningPulse {
  0% {
    box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.35);
  }
  70% {
    box-shadow: 0 0 0 8px rgba(34, 197, 94, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(34, 197, 94, 0);
  }
}
</style>
