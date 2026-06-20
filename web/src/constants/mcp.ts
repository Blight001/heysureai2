/**
 * Default MCP tool allow-list. Used as the initial selection for a new AI
 * configuration and as the fallback when `task_payload.mcp_tools_override`
 * is empty.
 */
export const DEFAULT_MCP_TOOLS = [
  'mcp.list_tools',
  'mcp.describe_tool',
  'workspace.search',
  'workspace.run_command',
  'workspace.manage',
  'admin.manage',
  'task.manage',
  'task.complete',
  'prompt.manage',
  'knowledge.manage',
  'message.send_to_user',
  'message.send_to_ai',
  'conversation.manage',
] as const
