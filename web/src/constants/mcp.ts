/**
 * Default MCP tool allow-list. Used as the initial selection for a new AI
 * configuration and as the fallback when `task_payload.mcp_tools_override`
 * is empty.
 */
export const DEFAULT_MCP_TOOLS = [
  'workspace.run_command',
  'admin.list_agents',
  'admin.get_overview',
  'admin.dispatch_flow',
  'project.list_projects',
  'project.create_project',
  'project.update_project',
  'project.delete_project',
  'task.create',
  'task.update',
  'task.delete',
  'task.list',
  'task.get_current',
  'task.inherit',
  'task.complete',
  'prompt.list_targets',
  'prompt.read_ai',
  'prompt.write_ai',
  'prompt.read_system',
  'prompt.write_system',
  'user.send_message',
  'ai.send_message',
  'conversation.forget_before_current',
] as const
