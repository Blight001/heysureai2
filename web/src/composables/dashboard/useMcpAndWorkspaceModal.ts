import { ref, type Ref } from 'vue'
import { withMcpToolLocale } from '@/utils/mcpTools'
import type { McpToolDefinition } from '@/types'

interface UseMcpAndWorkspaceModalOptions {
  mcpToolMetaByName: Ref<Record<string, McpToolDefinition>>
}

export const useMcpAndWorkspaceModal = ({ mcpToolMetaByName }: UseMcpAndWorkspaceModalOptions) => {
  const toolModalOpen = ref(false)
  const toolModalTitle = ref('')
  const toolModalItems = ref<McpToolDefinition[]>([])

  const buildToolItems = (toolNames: string[], source: McpToolDefinition['mcpSource'] = 'server') => {
    return toolNames.map((name) => {
      const meta = mcpToolMetaByName.value[name]
      const base = meta
        ? { ...meta, mcpSource: source }
        : { name, description: '', inputSchema: { type: 'object', properties: {} }, destructive: false, mcpSource: source }
      return withMcpToolLocale(base)
    })
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

  return {
    toolModalOpen,
    toolModalTitle,
    toolModalItems,
    showAllServerMcpTools,
  }
}
