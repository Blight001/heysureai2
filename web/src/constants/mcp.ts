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
  'admin.list_agents',
  'admin.get_overview',
  'task.create',
  'task.update',
  'task.delete',
  'task.list',
  'task.complete',
  'prompt.list_targets',
  'prompt.read_ai',
  'prompt.write_ai',
  'prompt.read_system',
  'prompt.write_system',
  'message.send_to_user',
  'message.send_to_ai',
  'conversation.list',
  'conversation.detail',
  'conversation.create',
  'conversation.delete',
  'conversation.edit',
  'conversation.compress',
] as const
