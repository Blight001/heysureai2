<script setup lang="ts">
import { computed, ref } from 'vue'
import AgentCard from '../cards/AgentCard.vue'

interface Agent {
  id: string
  name: string
  role: 'admin' | 'worker'
  tokensUsed: number
  tokenLimit: number
  generation: number
  status: 'learning' | 'working' | 'reproducing' | 'dead'
  platform: string
  currentTask?: string
  summary?: string
  projectId?: string
  projectName?: string
  aiConfigId?: number
  enabled?: boolean
  mcpEnabled?: boolean
  mcpTools?: string
  runtimeStatus?: string
  runtimeTool?: string
  digitalMemberRole?: 'manager' | 'member'
  currentTaskTitle?: string
  currentTaskStatus?: string
  latestThinking?: string
}

interface ProjectGroup {
  id: string
  name: string
  description: string
  status: 'running' | 'ended'
  aiMemberIds: number[]
  readonly?: boolean
  activeAgents: Agent[]
  deadAgents: Agent[]
}

interface ProjectPayload {
  name: string
  description: string
  status: 'running' | 'ended'
  ai_member_ids: number[]
}

interface Props {
  projectGroups: ProjectGroup[]
  projectGridClass: string
  centerGridClass: string
  filterOpen: boolean
  filterValue: 'all' | 'active' | 'inactive'
  allAgents: Agent[]
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'update:filterOpen', value: boolean): void
  (e: 'update:filterValue', value: Props['filterValue']): void
  (e: 'context', payload: { agent: Agent; x: number; y: number }): void
  (e: 'show-tools', agent: Agent): void
  (e: 'show-context', agent: Agent): void
  (e: 'show-tasks', agent: Agent): void
  (e: 'show-task-detail', payload: { agent: Agent; jobId: string }): void
  (e: 'chat', agent: Agent): void
  (e: 'settings', agent: Agent): void
  (e: 'create-project', payload: ProjectPayload): void
  (e: 'update-project', payload: { id: string; data: ProjectPayload }): void
  (e: 'delete-project', id: string): void
}>()

const expandedProjects = ref(new Set<string>())
const projectDialogOpen = ref(false)
const projectDialogMode = ref<'create' | 'edit'>('create')
const projectDialogForm = ref<ProjectPayload>({
  name: '',
  description: '',
  status: 'running',
  ai_member_ids: [],
})
const editingProjectId = ref('')

const availableMembers = computed(() => {
  return props.allAgents
    .filter(agent => typeof agent.aiConfigId === 'number')
    .map(agent => ({
      id: Number(agent.aiConfigId),
      name: agent.name,
      role: agent.role,
      status: agent.status,
    }))
})

const toggleDeadAgents = (projectId: string) => {
  const newSet = new Set(expandedProjects.value)
  if (newSet.has(projectId)) {
    newSet.delete(projectId)
  } else {
    newSet.add(projectId)
  }
  expandedProjects.value = newSet
}

const toggleFilter = () => {
  emit('update:filterOpen', !props.filterOpen)
}

const applyFilter = (value: Props['filterValue']) => {
  emit('update:filterValue', value)
  emit('update:filterOpen', false)
}

const openCreateProject = () => {
  projectDialogMode.value = 'create'
  editingProjectId.value = ''
  projectDialogForm.value = {
    name: '',
    description: '',
    status: 'running',
    ai_member_ids: [],
  }
  projectDialogOpen.value = true
}

const openEditProject = (project: ProjectGroup) => {
  if (project.readonly) return
  projectDialogMode.value = 'edit'
  editingProjectId.value = project.id
  projectDialogForm.value = {
    name: project.name,
    description: project.description || '',
    status: project.status || 'running',
    ai_member_ids: [...(project.aiMemberIds || [])],
  }
  projectDialogOpen.value = true
}

const submitProject = () => {
  const payload: ProjectPayload = {
    name: projectDialogForm.value.name.trim(),
    description: (projectDialogForm.value.description || '').trim(),
    status: projectDialogForm.value.status,
    ai_member_ids: [...projectDialogForm.value.ai_member_ids],
  }
  if (!payload.name) return
  if (projectDialogMode.value === 'create') {
    emit('create-project', payload)
  } else if (editingProjectId.value) {
    emit('update-project', { id: editingProjectId.value, data: payload })
  }
  projectDialogOpen.value = false
}

const closeProjectDialog = () => {
  projectDialogOpen.value = false
}

const onMemberCheckboxChange = (memberId: number, event: Event) => {
  const target = event.target as HTMLInputElement | null
  const checked = !!target?.checked
  const next = new Set(projectDialogForm.value.ai_member_ids)
  if (checked) next.add(memberId)
  else next.delete(memberId)
  projectDialogForm.value.ai_member_ids = Array.from(next).sort((a, b) => a - b)
}
</script>

<template>
  <section class="flex-1 bg-zinc-100/50 rounded-2xl border-2 border-dashed border-zinc-200 flex flex-col overflow-hidden relative dark:bg-zinc-900/40 dark:border-zinc-700 transition-colors duration-500">
    <div class="absolute top-0 left-0 bg-zinc-100 text-zinc-500 text-xs px-3 py-1 rounded-br-lg font-medium z-10 border-b border-r border-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:border-zinc-700 shadow-sm">
      🌍 Agent 进化与实战区域
    </div>
    <div class="absolute top-2 right-3 z-10 flex items-center gap-2">
      <button class="px-2 py-1 rounded border border-zinc-200 bg-white text-xs text-zinc-500 hover:text-indigo-600 hover:border-indigo-200 transition-colors dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-300 dark:hover:text-indigo-300 shadow-sm hover:shadow" @click.stop="openCreateProject">
        + 项目
      </button>
      <button class="px-2 py-1 rounded border border-zinc-200 bg-white text-xs text-zinc-500 hover:text-indigo-600 hover:border-indigo-200 transition-colors dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-300 dark:hover:text-indigo-300 shadow-sm hover:shadow" @click.stop="toggleFilter">
        筛选
      </button>
      <Transition name="fade">
        <div v-if="filterOpen" class="absolute right-0 top-full mt-2 w-40 bg-white border border-zinc-200 rounded-lg shadow-lg text-xs text-zinc-600 z-20 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-200" @click.stop>
          <button class="w-full text-left px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800" :class="filterValue === 'all' ? 'text-indigo-600 dark:text-indigo-300' : ''" @click="applyFilter('all')">
            所有项目
          </button>
          <button class="w-full text-left px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800" :class="filterValue === 'active' ? 'text-indigo-600 dark:text-indigo-300' : ''" @click="applyFilter('active')">
            运行中
          </button>
          <button class="w-full text-left px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800" :class="filterValue === 'inactive' ? 'text-indigo-600 dark:text-indigo-300' : ''" @click="applyFilter('inactive')">
            已结束
          </button>
        </div>
      </Transition>
    </div>

    <TransitionGroup name="list" tag="div" class="p-6 overflow-y-auto h-full pt-14 custom-scrollbar" :class="projectGridClass">
      <div v-for="project in projectGroups" :key="project.id" class="glass rounded-2xl border border-zinc-200 shadow-sm p-4 dark:bg-zinc-900/80 dark:border-zinc-800 transition-all duration-300 hover:shadow-md hover:border-indigo-200 dark:hover:border-indigo-900/50">
        <div class="flex items-start justify-between gap-4 mb-3">
          <div>
            <h3 class="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{{ project.name }}</h3>
            <p class="text-xs text-zinc-400 dark:text-zinc-500">{{ project.description }}</p>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs px-2 py-0.5 rounded-full"
              :class="project.status === 'running'
                ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300'
                : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300'"
            >
              {{ project.status === 'running' ? '运行中' : '已结束' }}
            </span>
            <span class="text-xs bg-zinc-100 px-2 py-0.5 rounded-full text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300 transition-colors">{{ project.activeAgents.length }} 在线</span>
            <button
              v-if="!project.readonly"
              class="text-xs px-2 py-0.5 rounded border border-zinc-200 text-zinc-500 hover:text-indigo-600 hover:border-indigo-200 dark:border-zinc-700 dark:text-zinc-300"
              @click="openEditProject(project)"
            >
              编辑
            </button>
            <button
              v-if="!project.readonly"
              class="text-xs px-2 py-0.5 rounded border border-red-200 text-red-500 hover:bg-red-50 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-900/20"
              @click="emit('delete-project', project.id)"
            >
              删除
            </button>
          </div>
        </div>

        <div class="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
          AI 成员ID: {{ project.aiMemberIds.length > 0 ? project.aiMemberIds.join(', ') : '无' }}
        </div>

        <TransitionGroup name="list" tag="div" :class="centerGridClass">
          <AgentCard
            v-for="agent in project.activeAgents"
            :key="agent.id"
            :agent="agent"
            @context="emit('context', $event)"
            @show-tools="emit('show-tools', $event)"
            @show-context="emit('show-context', $event)"
            @show-tasks="emit('show-tasks', $event)"
            @show-task-detail="emit('show-task-detail', $event)"
            @chat="emit('chat', $event)"
            @settings="emit('settings', $event)"
          />
          <div v-if="project.activeAgents.length === 0" class="col-span-full text-zinc-400 text-xs py-6 text-center">
            暂无参与的 Agent
          </div>
        </TransitionGroup>

        <div v-if="!project.readonly" class="mt-4 border-t border-zinc-100 pt-3 dark:border-zinc-800 relative">
          <div class="flex justify-between items-center mb-2">
            <div class="text-xs text-zinc-500 dark:text-zinc-400">牺牲者档案</div>
            <button
              v-if="project.deadAgents.length > 3"
              class="text-[10px] text-zinc-400 hover:text-indigo-500 flex items-center gap-1 transition-colors"
              @click="toggleDeadAgents(project.id)"
            >
              {{ expandedProjects.has(project.id) ? '收起' : `展开 (${project.deadAgents.length})` }}
            </button>
          </div>

          <div v-if="project.deadAgents.length === 0" class="text-xs text-zinc-400 dark:text-zinc-500">暂无牺牲者</div>

          <div class="relative transition-all duration-300">
            <TransitionGroup name="fade" tag="div">
              <div
                v-for="(agent, index) in project.deadAgents"
                :key="agent.id"
                class="text-xs text-zinc-600 flex items-start gap-2 py-1 dark:text-zinc-300"
                v-show="expandedProjects.has(project.id) || index < 3"
              >
                <span class="text-zinc-400 dark:text-zinc-500">•</span>
                <div>
                  <div class="font-medium text-zinc-700 dark:text-zinc-200">{{ agent.name }}</div>
                  <div class="text-[11px] text-zinc-500 dark:text-zinc-400">{{ agent.summary || '未留下遗言' }}</div>
                </div>
              </div>
            </TransitionGroup>

            <Transition name="fade">
              <div
                v-if="!expandedProjects.has(project.id) && project.deadAgents.length > 3"
                class="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-white via-white/90 to-transparent pointer-events-none dark:from-zinc-900 dark:via-zinc-900/90"
              ></div>
            </Transition>
          </div>
        </div>
      </div>
    </TransitionGroup>
    <div v-if="projectGroups.length === 0" class="absolute inset-0 flex items-center justify-center pt-10 pointer-events-none">
      <div class="text-center text-xs text-zinc-400 dark:text-zinc-500">
        <div class="text-sm font-medium text-zinc-500 dark:text-zinc-400">暂无项目</div>
        <div class="mt-1">点击右上角“+ 项目”后再添加。</div>
      </div>
    </div>

    <Transition name="fade">
      <div v-if="projectDialogOpen" class="fixed inset-0 z-[96] bg-black/45 flex items-center justify-center p-4" @click="closeProjectDialog">
        <div class="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-700 shadow-xl w-full max-w-2xl max-h-[88vh] overflow-y-auto p-5" @click.stop>
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              {{ projectDialogMode === 'create' ? '新增项目' : '编辑项目' }}
            </h3>
            <button class="text-xs px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700" @click="closeProjectDialog">关闭</button>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div>
              <label class="block text-xs text-zinc-500 mb-1">项目名称</label>
              <input v-model="projectDialogForm.name" class="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100" />
            </div>
            <div>
              <label class="block text-xs text-zinc-500 mb-1">项目状态</label>
              <select v-model="projectDialogForm.status" class="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100">
                <option value="running">运行中</option>
                <option value="ended">已结束</option>
              </select>
            </div>
            <div class="md:col-span-2">
              <label class="block text-xs text-zinc-500 mb-1">项目描述</label>
              <textarea v-model="projectDialogForm.description" rows="3" class="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100"></textarea>
            </div>
          </div>

          <div class="mt-4 p-3 rounded-lg border border-zinc-200 dark:border-zinc-700">
            <div class="text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-2">AI 成员 ID 记录</div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
              <label v-for="member in availableMembers" :key="`project-member-${member.id}`" class="text-xs text-zinc-600 dark:text-zinc-300 flex items-center gap-2">
                <input
                  type="checkbox"
                  :checked="projectDialogForm.ai_member_ids.includes(member.id)"
                  @change="onMemberCheckboxChange(member.id, $event)"
                />
                <span>{{ member.name }} (ID: {{ member.id }})</span>
              </label>
              <div v-if="availableMembers.length === 0" class="text-xs text-zinc-400">暂无可绑定 AI</div>
            </div>
          </div>

          <div class="mt-5 flex justify-end gap-2">
            <button class="text-xs px-3 py-1.5 rounded border border-zinc-200 dark:border-zinc-700" @click="closeProjectDialog">取消</button>
            <button class="text-xs px-3 py-1.5 rounded bg-indigo-600 text-white" @click="submitProject">保存</button>
          </div>
        </div>
      </div>
    </Transition>
  </section>
</template>
