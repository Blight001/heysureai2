# Windows Agent 动态加载与工具执行方案

本文记录 `agent/windows` 侧的技术选型与执行边界，目标是回答三个问题：

1. Windows Agent 用什么语言和运行时更合适
2. 动态导入、插件加载、脚本执行分别怎么做
3. 如何把“能执行”与“可控、安全、可维护”放在一起

## 1. 结论

如果目标是做一个上手难度低、开发快、方便动态加载工具的 Windows Agent，主程序优先选 `Python`。

推荐分层如下：

- **主程序**：`Python`
- **插件工具**：`Python 模块` 或独立进程工具
- **脚本工具**：`Python` / `PowerShell` / 其他外部脚本
- **通信方式**：`stdin/stdout`、HTTP、Named Pipe、gRPC，按场景选择

一句话概括：

- `Python` 适合做“主控壳”和快速编排
- 脚本语言适合做“工具实现”和快速扩展
- 复杂或高风险能力尽量放到子进程里

## 2. 为什么主程序选 Python

### 2.1 上手快

Python 的优势是：

- 语法简单
- 原型开发快
- 动态导入直接
- 调试成本低

如果你的目标是先把 Agent 跑起来，再慢慢补工程化，Python 更合适。

### 2.2 动态导入天然方便

Python 自带比较直接的动态加载方式：

- `importlib.import_module`
- `importlib.util.spec_from_file_location`
- `pkgutil.iter_modules`
- `entry_points`

这意味着工具可以按目录、按包、按清单加载，不需要先走一套重型插件框架。

### 2.3 适合做工具编排

Windows Agent 往往不是单一算法问题，而是“编排 + 执行”问题：

- 调工具
- 控超时
- 收日志
- 传递 JSON
- 管理权限

Python 做这些事很顺手，且和大量现成生态兼容。

### 2.4 对本项目更直接

当前仓库里已经有：

- 后端服务
- 前端控制台
- Windows Agent 目录

如果 Agent 本身先用 Python，可以更快把“能执行工具”的链路跑通，再决定后续是否需要更重的原生封装。

## 3. 动态加载有三种层次

很多人说“动态导入”，实际上可以分成三层。

### 3.1 运行时导入 Python 包

适合：

- 同一技术栈的插件
- 共享接口定义
- 需要在进程内调用的能力

方式：

- 主程序扫描 `tools/` 目录
- 读取插件清单
- 按需 `import`
- 通过统一接口调用

优点：

- 调用快
- 写法简单
- 适合低风险能力

缺点：

- 插件和主程序耦合更高
- 单个插件异常可能影响主进程

### 3.2 启动独立子进程

适合：

- 脚本工具
- 高风险工具
- 语言不统一的工具

方式：

- 主程序启动 `python.exe`、`pwsh.exe`、自定义 `.exe`
- 通过 `stdin/stdout` 传递 JSON
- 主程序负责超时、退出码、日志收集

优点：

- 隔离强
- 适合任意语言
- 崩溃不会直接拖死主程序

缺点：

- 调用开销更高
- 协议设计要做好

### 3.3 纯配置驱动的外部工具

适合：

- 已经存在的脚本或命令行工具
- 不想写进主程序的能力

方式：

- 每个工具有自己的 manifest
- 指定命令、参数模板、输入输出格式
- 主程序统一调度

优点：

- 扩展快
- 不依赖具体语言

缺点：

- 校验、权限、参数约束必须补齐

## 4. 推荐架构

推荐把 Windows Agent 拆成 4 层。

```text
┌────────────────────────────────────────────┐
│                Agent Host                  │
│            Python 主程序入口               │
└──────────────────────┬─────────────────────┘
                       │
      ┌────────────────┼────────────────┐
      ▼                ▼                ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ Plugin Tools │ │ Script Tools │ │ Built-in     │
│ Python 包    │ │ Python/PS1   │ │ Native Tools │
└──────┬───────┘ └──────┬───────┘ └──────┬───────┘
       │                │                │
       └────────────┬───┴───────┬────────┘
                    ▼           ▼
             ┌────────────────────────┐
             │  Unified Tool Runner   │
             │  timeout / log / ACL   │
             └────────────────────────┘
```

核心原则：

- 主程序只负责调度、权限、日志、状态管理
- 真正执行动作的能力尽量收敛到 Tool Runner
- 风险较高的工具尽量走子进程隔离

## 5. 工具类型划分

建议把工具分成两类。

### 5.1 进程内工具

适合低风险、纯逻辑、依赖少的能力：

- 字符串处理
- 配置解析
- 本地状态读取
- 简单文件扫描

典型形式：

- Python 包
- 统一接口 `IToolPlugin`

### 5.2 进程外工具

适合高风险、复杂依赖、语言不统一的能力：

- Python 脚本
- PowerShell 脚本
- 外部 CLI
- 浏览器自动化工具
- 需要独立环境的脚本

典型形式：

- `tool.json + script`
- `exe + manifest`
- `stdin/stdout` JSON 协议

## 6. 推荐的插件约定

如果走 Python 插件，建议约定一个最小接口。

```python
class ToolPlugin:
    name = "screenshot"
    version = "1.0.0"

    def execute(self, request: dict) -> dict:
        raise NotImplementedError
```

建议再配一个清单文件：

```json
{
  "id": "desktop.screenshot",
  "name": "Screenshot",
  "version": "1.0.0",
  "entry": "tools.desktop.screenshot:ToolPlugin",
  "type": "python",
  "permissions": ["screen", "window"]
}
```

这样主程序可以先读 manifest，再决定是否加载插件。

### 6.1 统一落盘位置

建议把所有 MCP 工具统一保存到软件端根目录的资源目录里，而不是散落在多个功能目录中。

推荐目录：

```text
agent/windows/resources/mcp/
  screenshots/
    tool.py
    tool.json
  clipboard/
    tool.py
    tool.json
  browser/
    tool.py
    tool.json
```

原则是：

- 运行时只从 `resources/mcp/` 扫描工具
- 工具代码、清单、资源文件都放在同一能力包里
- 发布时整体打包进软件资源目录

这样做的好处是：

- 工具发现路径单一
- 方便热加载和版本管理
- 服务器回传时能直接按目录读取，不需要额外索引

### 6.2 Python 文件头部标准注释

每个 `tool.py` 文件头部都要有统一的注释块，作为工具的第一说明来源。

建议使用模块 docstring，包含这些字段：

- 工具名称
- 简介
- 版本
- 输入参数
- 输出说明
- 权限需求
- 注意事项

模板如下：

```python
"""
name: screenshot.capture
summary: Capture the current screen and return an image path or base64 payload.
version: 1.0.0
permissions: screen

parameters:
  - name: output
    type: string
    required: false
    description: Optional output path for the screenshot file.
  - name: format
    type: string
    required: false
    description: Output format, for example png or jpg.

returns:
  - ok: boolean
  - path: string
  - data: string

notes:
  - This tool may require screen-capture permission.
"""
```

### 6.3 为什么要把说明写进文件头

这样服务器端返回工具信息时，不需要依赖额外的 README 或单独文档，也不需要人工同步两份说明。

服务器可以直接读取：

- `tool.json`，用于发现、路由和权限判断
- `tool.py` 头部注释，作为工具简介、参数、返回值和注意事项的标准说明

换句话说：

- `tool.json` 负责“机器可读”
- `tool.py` 顶部注释负责“人和服务器都能直接读取的说明”
- `README.md` 只保留为可选的补充文档，不作为必需项

## 7. 脚本工具怎么接

如果工具本身是脚本，建议不要把脚本直接塞进主程序逻辑里，而是统一成一个执行协议。

### 7.1 建议格式

每个脚本工具一个目录：

```text
resources/mcp/
  file-search/
    tool.json
    tool.py
  powershell-report/
    tool.json
    main.ps1
```

`tool.json` 负责描述：

- 工具 ID
- 入口文件
- 运行命令
- 需要的权限
- 输入输出 schema

其中，如果工具是 Python，实现文件优先命名为 `tool.py`，并把头部注释作为标准说明来源。

### 7.2 执行方式

主程序通过子进程启动脚本：

- 输入：标准输入 JSON
- 输出：标准输出 JSON
- 错误：标准错误日志
- 结束：退出码表示成功或失败

这种方式比直接把一切都塞进主进程更容易维护，也更容易做隔离。

## 8. 安全边界

动态加载的核心风险不是“能不能加载”，而是“加载后能做什么”。

### 8.1 分级授权

建议按能力分级：

- 只读类：查询、读取、分析
- 轻写入类：修改配置、生成文件
- 高风险类：执行命令、控制窗口、操作剪贴板、网络下载

### 8.2 白名单优先

不建议让工具随意声明能力。

应该由主程序控制：

- 哪些插件可加载
- 哪些工具可调用
- 哪些参数范围合法
- 哪些路径允许访问

### 8.3 超时和退出控制

所有外部执行都必须有：

- 超时
- kill 机制
- 重试策略
- 日志落盘

否则 Agent 很容易卡死在某个脚本里。

## 9. 与本项目的建议对接方式

结合当前仓库结构，建议这样分：

- `agent/windows`：Windows 主程序
- `agent/windows/resources/mcp/`：所有 MCP 工具资源、代码、清单
- `server/`：调度、权限、任务、知识库
- `agent/windows/runtime/`：统一执行器、进程管理、日志

如果后面要接 `server/connector_runtime` 下发任务，建议任务包只传：

- 工具 ID
- 任务参数
- 目标工作目录
- 权限策略
- 超时

不要直接把任意代码作为默认任务载荷。

服务端回传工具信息时，优先读取 `resources/mcp/<tool>/tool.py` 的头部注释和对应 `tool.json`，这样就能做到“代码即说明”，不需要额外维护一份独立的工具说明文档。

## 10. 最终建议

如果你要做的是一个真正可长期维护的 Windows Agent，我建议：

1. 主程序用 `Python`
2. 进程内能力用 Python 插件
3. 高风险和异构能力用外部脚本进程
4. 所有工具都通过统一 manifest 描述
5. 所有执行都经过权限、超时、日志、审计

这个组合的实际收益是：

- 上手快
- 动态扩展能力足够
- 维护成本可控
- 安全边界清楚

如果后续要落代码，下一步最适合先定：

- Python 插件接口
- `tool.json` 格式
- `stdin/stdout` 协议
- 插件目录结构

## 11. 什么时候不该只用 Python

如果后续发现下面这些需求变重，再考虑把某些能力拆成独立原生模块：

- 大量系统级 Windows 集成
- 需要非常强的 UI 自动化稳定性
- 需要高性能长时间运行的本地守护进程
- 需要严格的企业部署和强类型边界

这不意味着 Python 不行，而是说明某些局部能力可以再单独优化，不必一开始就把主程序做重。

## 12. 与现有 Electron Agent 的对接（落地修正）

> 本节是对前面方案的**现实校正**。前 11 节默认“主程序用 Python”，但当前仓库的
> `agent/windows` 已经是一套成型的 **Electron + TypeScript** 应用（`package.json`
> 里是 electron 28 + robotjs + electron-builder，已能打包 NSIS 安装包）。因此“主程序
> 换 Python”等于推倒重来，与“快速上手”的初衷相悖。本节给出折中：**保留前面所有架构思想，
> 但主控壳继续用 TS，Python 只作为子进程工具的实现语言。**

### 12.1 现状盘点

`agent/windows` 已经具备前面方案想要的大半能力：

- `src/executor/registry.ts`：工具注册表（`ToolDefinition { id, platform, handler, description, inputSchema }`），就是第 6 节想要的“统一接口 + 清单”。
- `src/executor/catalog.ts`：内置工具目录，自带中文 description 和 JSON Schema，注册时通过 `agent:register` 的 `toolDefs` 上报服务器——已经实现了第 6.3 节“代码即说明、服务器不再硬编码 schema”。
- `src/executor/index.ts`：`executeTask` 按 tool id 分发，带 try/catch、summary——就是第 4 节的 Unified Tool Runner 雏形。
- `src/tools/*`：14 个内置进程内工具（screen、mouse、keyboard、clipboard、shell、vision…）。
- `src/ipc/mcp.ts`：MCP 链路已接到 TS 侧。

也就是说：**第 5.1 节“进程内工具”这条线已经跑通了**，缺的只是第 5.2 / 第 7 节的“进程外脚本工具”这条扩展线。

### 12.2 修正后的选型

| 层 | 前文建议 | 修正为 |
|----|----------|--------|
| 主控壳 / 编排 | Python 主程序 | **保持 TS（现有 Electron `executor`）** |
| 进程内工具 | Python 插件 | **保持 TS（现有 `tools/*`）** |
| 进程外脚本工具 | Python/PS1 子进程 | **照搬：Python/PS1 子进程，stdin/stdout JSON** |
| 工具清单 | `tool.json` + 头部注释 | **照搬** |
| 安全边界 | 白名单/超时/分级/审计 | **照搬，由 TS 主控统一实施** |

结论：**前 11 节里除了“主程序语言”这一项，其余全部采纳。** Python 不做主控，只做
高危/异构能力的子进程实现，正好对应第 3.2 节“启动独立子进程”这条最稳的路。

### 12.3 落地路径：给 executor 加一个 subprocess 工具加载器

不改动现有任何内置工具，只**新增一个加载器**，开机时扫描 `resources/mcp/`，把每个
外部脚本工具**注册成一条普通 `ToolDefinition`**——其 `handler` 不是 JS 函数，而是
“拉起子进程、喂 JSON、收 JSON”。对 `executeTask` 和服务器完全透明：它们看到的还是
一个有 id / description / inputSchema 的工具。

目录约定（沿用第 6.1 / 第 7.1 节）：

```text
agent/windows/resources/mcp/
  file-search/
    tool.json        # 机器可读：id、入口、命令、权限、JSON Schema
    tool.py          # 实现 + 头部 docstring 说明
  powershell-report/
    tool.json
    main.ps1
```

`tool.json` 字段（用真正的 JSON Schema 做参数校验，不要靠注释解析）：

```json
{
  "id": "ext.file_search",
  "version": "1.0.0",
  "runtime": "python",
  "entry": "tool.py",
  "platform": "windows",
  "permissions": ["fs.read"],
  "timeout_ms": 30000,
  "description": "在指定目录下按关键字搜索文件。",
  "input_schema": {
    "type": "object",
    "properties": {
      "root": { "type": "string", "description": "搜索根目录（相对工作区）。" },
      "keyword": { "type": "string", "description": "文件名关键字。" }
    },
    "required": ["keyword"]
  }
}
```

加载器（新增 `src/executor/external.ts`，约 30 行核心逻辑）：

```ts
import { spawn } from 'node:child_process'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { registerTool, ToolPlatform } from './registry'

const RUNTIME_CMD: Record<string, string> = {
  python: 'python',
  powershell: 'pwsh',
}

// 开机调用一次：扫描 resources/mcp/，把每个外部脚本工具注册成 ToolDefinition。
export function loadExternalTools(mcpRoot: string): void {
  if (!existsSync(mcpRoot)) return
  for (const dir of readdirSync(mcpRoot, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue
    const toolDir = join(mcpRoot, dir.name)
    const manifestPath = join(toolDir, 'tool.json')
    if (!existsSync(manifestPath)) continue

    const m = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const cmd = RUNTIME_CMD[m.runtime]
    if (!cmd) continue // 未知 runtime：跳过（白名单优先，见第 8.2 节）

    registerTool({
      id: m.id,
      platform: (m.platform || 'windows') as ToolPlatform,
      description: m.description,
      inputSchema: m.input_schema,
      handler: ({ workspaceRoot, args }) =>
        runSubprocessTool(cmd, join(toolDir, m.entry), args, {
          workspaceRoot,
          timeoutMs: m.timeout_ms ?? 30000,
        }),
    })
  }
}

// stdin 喂 JSON，stdout 收 JSON，超时 kill，退出码非 0 视为失败（第 7.2 / 8.3 节）。
function runSubprocessTool(
  cmd: string, script: string, args: Record<string, any>,
  opts: { workspaceRoot: string; timeoutMs: number },
): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [script], { cwd: opts.workspaceRoot })
    let out = '', err = ''
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('tool timeout')) }, opts.timeoutMs)

    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { err += d })
    child.on('error', reject)
    child.on('close', code => {
      clearTimeout(timer)
      if (code !== 0) return reject(new Error(err || `exit ${code}`))
      try { resolve(JSON.parse(out)) } catch { reject(new Error('invalid JSON from tool: ' + out.slice(0, 200))) }
    })
    child.stdin.write(JSON.stringify(args))
    child.stdin.end()
  })
}
```

在 `src/executor/index.ts`（或 `catalog` 之后）调用一次 `loadExternalTools(<resources/mcp 绝对路径>)`
即可——之后这些 Python/PS1 工具就和内置工具一样出现在 `listToolDefs()` 上报、被
`executeTask` 分发，**服务器侧零改动**。

对应的 `tool.py` 骨架（头部 docstring 即说明，见第 6.2 节）：

```python
"""
name: ext.file_search
summary: 在指定目录下按关键字搜索文件名。
version: 1.0.0
permissions: fs.read
"""
import sys, json, os

def main():
    args = json.loads(sys.stdin.read() or "{}")
    root = args.get("root", ".")
    kw = args.get("keyword", "")
    hits = [os.path.join(dp, f)
            for dp, _, fs in os.walk(root) for f in fs if kw in f]
    json.dump({"ok": True, "matches": hits[:200]}, sys.stdout)

if __name__ == "__main__":
    main()
```

### 12.4 这样做的收益与待补点

收益：

- **不丢现有链路**：Electron + robotjs + 已注册的 14 个工具原封不动。
- **吃到动态扩展红利**：新增一个 Python/PS1 工具 = 往 `resources/mcp/` 放一个目录，重启即生效，无需改 TS 编译产物。
- **安全边界统一**：白名单（未知 runtime 跳过）、超时 kill、退出码、stderr 日志全部由 TS 主控实施，符合第 8 章。
- **服务器透明**：外部工具复用现有 `toolDefs` 上报通道，“代码即说明”照样成立。

仍需补的点（前文埋的坑，落地时别忘）：

- **大二进制返回**：截图 base64 走 stdout 会很笨重。约定大产物落盘到工作区、stdout 只回路径（与现有 `screen.capture` 的 `upload_to_server` 思路一致）。
- **热加载/卸载**：上面是“开机扫描”。要做运行时热加载，需补 `registry` 的反注册和版本切换；进程内工具难热卸载，外部子进程工具天然好做——这也是把高频变更能力放子进程的又一个理由。
- **参数校验**：`input_schema` 已是 JSON Schema，建议在 `handler` 入口加一道校验再 spawn，别把未校验参数直接喂给脚本。
- **权限授予**：`permissions` 字段目前只是声明，谁授予、是否需要用户确认，要接到主控的分级授权（第 8.1 节）上。
