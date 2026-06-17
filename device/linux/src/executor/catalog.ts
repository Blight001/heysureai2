// Tool catalog — the device is now a controlled runner, not a fixed-MCP source
// (设备端MCP代码下放长期方案 阶段三/四). The hardcoded native tools (keyboard /
// mouse / clipboard / process / screen / window / vision / …) have been removed;
// every capability now comes from server-pushed runtime tools (python/shell),
// managed via mcp.manage_dynamic_tool and executed by the runtime base.
//
// Only two built-ins remain on the device:
//   - mcp.manage_dynamic_tool: the local manager that loads server/AI tools;
//   - shell.run: the shell runtime entry (backed by runtime/shell-runner).

import { runCommand } from '../tools/shell'
import { registerTools } from './registry'
import { DYNAMIC_MCP_MANAGER_DEFINITION } from './dynamic'

const OBJ = (properties: Record<string, any>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: true,
})

registerTools([
  DYNAMIC_MCP_MANAGER_DEFINITION,
  {
    id: 'shell.run', platform: 'all',
    description: '在 agent 工作区中执行一条 shell 命令并返回输出。用途：运行命令行工具。场景：构建、测试、安装依赖、调用脚本（属高权限操作，请谨慎）。',
    inputSchema: OBJ({
      command: { type: 'string', description: '要执行的命令行。' },
      cwd: { type: 'string', description: '相对工作区根目录的工作目录。' },
      timeout_ms: { type: 'number', description: '硬超时（毫秒）。' },
    }, ['command']),
    handler: ({ workspaceRoot, args }) => runCommand(workspaceRoot, args),
  },
])
