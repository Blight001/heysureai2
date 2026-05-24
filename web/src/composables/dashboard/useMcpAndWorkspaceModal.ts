import { ref, type Ref } from 'vue'
import { withMcpToolLocale } from '@/utils/mcpTools'
import type { Agent, McpToolDefinition } from '@/types'
import { getAuthToken } from '@/api/http'
import { callMcpTool } from '@/api/mcp'

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

  const buildToolItems = (toolNames: string[], source: McpToolDefinition['mcpSource'] = 'server') => {
    return toolNames.map((name) => {
      const meta = mcpToolMetaByName.value[name]
      const base = meta
        ? { ...meta, mcpSource: source }
        : { name, description: '', inputSchema: { type: 'object', properties: {} }, destructive: false, mcpSource: source }
      return withMcpToolLocale(base)
    })
  }

  const showAgentTools = (agent: Agent) => {
    toolModalTitle.value = agent.name
    const serverTools = new Set<string>()
    try {
      const parsed = JSON.parse(agent.mcpTools || '[]')
      if (Array.isArray(parsed)) {
        parsed
          .map(item => String(item || '').trim())
          .filter(Boolean)
          .forEach(tool => serverTools.add(tool))
      }
    } catch {
      // ignore parse error
    }
    if (agent.desktopAgentConnected || agent.browserAgentConnected) {
      serverTools.add('admin.list_agents')
    }
    const items = buildToolItems(Array.from(serverTools), 'server')
    if (agent.desktopAgentConnected) {
      const desktopTools = new Set<string>()
      const desktopCapabilities = agent.desktopAgentCapabilities || []
      desktopCapabilities
        .map(item => String(item || '').trim())
        .filter(Boolean)
        .forEach(tool => desktopTools.add(tool))
      items.push(...buildToolItems(Array.from(desktopTools), 'desktop'))
    }
    if (agent.browserAgentConnected) {
      const browserTools = new Set<string>()
      const browserCapabilities = agent.browserAgentCapabilities || []
      browserCapabilities
        .map(item => String(item || '').trim())
        .filter(Boolean)
        .forEach(tool => browserTools.add(tool))
      items.push(...buildToolItems(Array.from(browserTools), 'browser'))
    }
    toolModalItems.value = items
    toolModalOpen.value = true
  }

  const showAllServerMcpTools = (title: string = '当前服务器所有的mcp接口') => {
    toolModalTitle.value = title
    const toolNames = Object.keys(mcpToolMetaByName.value || {})
      .map(item => String(item || '').trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
    toolModalItems.value = buildToolItems(toolNames, 'server')
    toolModalOpen.value = true
  }

  const closeWorkspaceContextModal = () => {
    workspaceContextModalOpen.value = false
  }

  const loadAgentWorkspaceContext = async (agent: Agent) => {
    if (!agent.aiConfigId) return
    if (!getAuthToken()) return
    workspaceContextModalLoading.value = true
    workspaceContextModalError.value = ''
    workspaceContextModalTree.value = ''
    workspaceContextModalGitDiff.value = ''
    workspaceContextModalChanged.value = []
    try {
      const [treeData, diffData] = await Promise.all([
        callMcpTool({ tool: 'workspace.get_file_tree', arguments: {}, ai_config_id: agent.aiConfigId }),
        callMcpTool({ tool: 'workspace.git_diff', arguments: {}, ai_config_id: agent.aiConfigId }),
      ])

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
