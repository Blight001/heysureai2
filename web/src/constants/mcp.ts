/**
 * Default MCP tool allow-list. Used as the initial selection for a new AI
 * configuration and as the fallback when `task_payload.mcp_tools_override`
 * is empty.
 */
export const DEFAULT_MCP_TOOLS = [
  'workspace.list_files',
  'workspace.get_file_tree',
  'workspace.read_files',
  'workspace.write_file',
  'workspace.edit_file',
  'workspace.delete_path',
  'workspace.run_command',
  'workspace.git_diff',
  'admin.list_agents',
  'admin.get_overview',
  'admin.dispatch_flow',
  'admin.dispatch_task',
  'project.list_projects',
  'project.create_project',
  'project.update_project',
  'project.delete_project',
  'task.create_immediate',
  'task.create_scheduled',
  'task.create_recurring',
  'task.list',
  'task.get_current',
  'task.inherit',
  'task.complete',
  'prompt.list_targets',
  'prompt.read_ai',
  'prompt.write_ai',
  'prompt.read_system',
  'prompt.write_system',
  'feishu.send_message',
  'conversation.forget_before_current',
] as const

export type DefaultMcpTool = (typeof DEFAULT_MCP_TOOLS)[number]
