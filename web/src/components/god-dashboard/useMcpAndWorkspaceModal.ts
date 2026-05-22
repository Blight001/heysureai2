import { ref, type Ref } from 'vue'
import { withMcpToolLocale } from './mcpTools'
import type { Agent, McpToolDefinition } from './types'

interface UseMcpAndWorkspaceModalOptions {
  mcpToolMetaByName: Ref<Record<string, McpToolDefinition>>
}

export const useMcpAndWorkspaceModal = ({ mcpToolMetaByName }: UseMcpAndWorkspaceModalOptions) => {
  const toolModalOpen = ref(false)
  const toolModalTitle = ref('')
  const toolModalItems = ref<McpToolDefinition[]>([])

  const workspaceContextModalOpen = ref(false)
  const workspaceContextModalLoading = ref(false)
  const workspaceContextModalTitle = ref('')
  const workspaceContextModalTree = ref('')
  const workspaceContextModalGitDiff = ref('')
  const workspaceContextModalError = ref('')
  const workspaceContextModalChanged = ref<string[]>([])
  const workspaceContextModalTarget = ref<Agent | null>(null)

  const buildToolItems = (toolNames: string[]) => {
    return toolNames.map((name) => {
      const meta = mcpToolMetaByName.value[name]
      const base = meta ? { ...meta } : { name, description: '', inputSchema: { type: 'object', properties: {} }, destructive: false }
      return withMcpToolLocale(base)
    })
  }

  const showAgentTools = (agent: Agent) => {
    toolModalTitle.value = agent.name
    const allowedTools = new Set<string>()
    try {
      const parsed = JSON.parse(agent.mcpTools || '[]')
      if (Array.isArray(parsed)) {
        parsed
          .map(item => String(item || '').trim())
          .filter(Boolean)
          .forEach(tool => allowedTools.add(tool))
      }
    } catch {
      // ignore parse error
    }
    if (agent.desktopAgentConnected) {
      allowedTools.add('admin.list_agents')
      allowedTools.add('admin.dispatch_task')
    }
    toolModalItems.value = buildToolItems(Array.from(allowedTools))
    toolModalOpen.value = true
  }

  const showAllServerMcpTools = (title: string = '当前服务器所有的mcp接口') => {
    toolModalTitle.value = title
    const toolNames = Object.keys(mcpToolMetaByName.value || {})
      .map(item => String(item || '').trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
    toolModalItems.value = buildToolItems(toolNames)
    toolModalOpen.value = true
  }

  const closeWorkspaceContextModal = () => {
    workspaceContextModalOpen.value = false
  }

  const parseApiError = async (res: Response, fallback: string) => {
    try {
      const data = await res.json()
      return String(data?.detail || fallback)
    } catch {
      return fallback
    }
  }

  const loadAgentWorkspaceContext = async (agent: Agent) => {
    if (!agent.aiConfigId) return
    const token = localStorage.getItem('token')
    if (!token) return
    workspaceContextModalLoading.value = true
    workspaceContextModalError.value = ''
    workspaceContextModalTree.value = ''
    workspaceContextModalGitDiff.value = ''
    workspaceContextModalChanged.value = []
    try {
      const [treeRes, diffRes] = await Promise.all([
        fetch('/api/mcp/call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ tool: 'workspace.get_file_tree', arguments: {}, ai_config_id: agent.aiConfigId }),
        }),
        fetch('/api/mcp/call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ tool: 'workspace.git_diff', arguments: {}, ai_config_id: agent.aiConfigId }),
        }),
      ])

      if (!treeRes.ok) {
        throw new Error(await parseApiError(treeRes, '读取目录结构失败'))
      }
      if (!diffRes.ok) {
        throw new Error(await parseApiError(diffRes, '读取 Git Diff 失败'))
      }

      const treeData = await treeRes.json()
      const diffData = await diffRes.json()
      const treeResult = (treeData?.result && typeof treeData.result === 'object') ? treeData.result : {}
      const diffResult = (diffData?.result && typeof diffData.result === 'object') ? diffData.result : {}

      const root = String(treeResult.selected_path || treeResult.root || '.')
      const treeText = String(treeResult.tree || '').trim()
      workspaceContextModalTree.value = treeText
        ? `当前根目录: ${root}\n\n${treeText}`
        : `当前根目录: ${root}\n\n暂无目录结构数据`

      const changed = Array.isArray(diffResult.changed)
        ? diffResult.changed.map((item: any) => String(item || '').trim()).filter(Boolean)
        : []
      workspaceContextModalChanged.value = changed
      workspaceContextModalGitDiff.value = String(diffResult.diff || '').trim() || '暂无 Git Diff 变更'
    } catch (err: any) {
      workspaceContextModalError.value = String(err?.message || '加载 AI 工作区上下文失败')
    } finally {
      workspaceContextModalLoading.value = false
    }
  }

  const openAgentWorkspaceContext = (agent: Agent) => {
    if (!agent.aiConfigId) return
    workspaceContextModalTarget.value = agent
    workspaceContextModalTitle.value = agent.name
    workspaceContextModalOpen.value = true
    void loadAgentWorkspaceContext(agent)
  }

  return {
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
  }
}
