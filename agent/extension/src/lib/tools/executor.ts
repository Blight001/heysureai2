// tools/executor.ts — server-dispatched task execution.
// Two paths:
//   1. Pure browser-tool calls (task.tool given) — runs the tool directly.
//   2. AI agentic loop (instruction → AI chooses tools) — runs callAI in a
//      loop, feeding tool results back until the model produces a text answer
//      or MAX_ITER is hit.

import { AgentSettings, ChatMessage, DispatchedTask, TaskResult } from '../types'
import { callAI, screenshotToolContent } from '../ai'
import { BROWSER_TOOLS } from './definitions'
import { executeBrowserTool } from './router'

// ── Task keyword inference ────────────────────────────────────────────────
// Used when the server dispatches a free-form instruction without an explicit
// tool name. Picks the closest browser_* tool based on simple keyword hits.
function inferTool(instruction: string): string {
  const t = instruction.toLowerCase()
  if (/截图|screenshot/.test(t))                                    return 'browser_screenshot'
  if (/弹窗|关闭弹窗|popup|modal|dialog/.test(t))                     return 'browser_close_popup'
  if (/搜索|search|查找|找/.test(t))                                 return 'browser_search'
  if (/点击|click/.test(t))                                          return 'browser_click'
  if (/输入|type|填写/.test(t))                                      return 'browser_type'
  if (/导航|打开|访问|navigate|open|go to|前往/.test(t))             return 'browser_navigate'
  if (/滚动|scroll/.test(t))                                         return 'browser_scroll'
  if (/提取|extract|抓取/.test(t))                                   return 'browser_extract'
  if (/标签|tab/.test(t))                                            return 'browser_tab_list'
  if (/内容|content|页面文本/.test(t))                               return 'browser_get_content'
  return 'browser_get_content'
}

// ── System prompt for the AI agentic loop ─────────────────────────────────
const SYSTEM_PROMPT = `You are HeySure AI, a browser automation assistant running as a Chrome extension.
You can navigate pages, click, type, take screenshots, search the web, close popups/modals/dialogs, and extract information.

When completing a task:
1. Navigate to the relevant URL or search for it
2. Use browser_page_info to know where you are on the page (scroll position, current section, visible headings) and browser_screenshot when you need to see it
3. Interact with elements systematically: click, double_click, right_click, type, fill forms, drag, press_key
4. If a popup/modal/dialog blocks the page, use browser_find_popups to inspect it and browser_close_popup to close it
5. Extract or summarize the result

Always:
- After scrolling, read the returned position (scrollY, percent, atTop/atBottom, section, visible headings) so you know where you landed and what changed
- Be methodical and verify each step
- Respond in the same language as the user's message
- Summarize what you accomplished at the end`

export async function executeTask(task: DispatchedTask, settings: AgentSettings): Promise<TaskResult> {
  const toolName = task.tool || inferTool(task.instruction || '')
  const args     = task.args || {}

  // Pure browser tool call (no AI loop)
  if (toolName && toolName !== 'ai_agent' && !toolName.startsWith('ai.')) {
    // Inject instruction into args if no explicit tool args given
    if (!task.tool && task.instruction && Object.keys(args).length === 0) {
      if (toolName === 'browser_search') args.query = task.instruction
      else if (toolName === 'browser_navigate') args.url = task.instruction
    }
    try {
      const result = await executeBrowserTool(toolName, args)
      return { success: true, tool: toolName, result, summary: `${toolName} completed` }
    } catch (err: any) {
      return { success: false, tool: toolName, result: null, summary: err.message }
    }
  }

  // AI agentic loop (instruction → AI decides which tools to use)
  if (!settings.aiKey) {
    return { success: false, tool: 'ai_agent', result: null, summary: 'AI Key not configured' }
  }

  const messages: ChatMessage[] = [{
    role: 'user',
    content: task.instruction || JSON.stringify(task.args) || 'Complete the task',
  }]

  const toolsUsed: string[] = []
  let iterations = 0
  const MAX_ITER = 12

  try {
    while (iterations < MAX_ITER) {
      const resp = await callAI(settings.aiBaseUrl, settings.aiKey, settings.aiModel, messages, BROWSER_TOOLS, SYSTEM_PROMPT)

      if (!resp.toolUses?.length) {
        return {
          success: true,
          tool: 'ai_agent',
          result: { text: resp.text, toolsUsed },
          summary: resp.text?.slice(0, 200) || 'Done',
        }
      }

      // Add assistant's tool-use block to history
      messages.push({ role: 'assistant', content: resp.toolUses as any[] })

      // Execute tools and collect results
      const toolResults: any[] = []
      for (const tu of resp.toolUses) {
        toolsUsed.push(tu.name)
        try {
          const toolResult = await executeBrowserTool(tu.name, tu.input)
          let content: any = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult)
          // For screenshots, include image data for vision models
          if (tu.name === 'browser_screenshot' && toolResult?.dataUrl) {
            content = screenshotToolContent(toolResult)
          }
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content })
        } catch (err: any) {
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: `Error: ${err.message}`, is_error: true })
        }
      }
      messages.push({ role: 'user', content: toolResults })
      iterations++
    }
    return { success: false, tool: 'ai_agent', result: { toolsUsed }, summary: 'Max iterations reached' }
  } catch (err: any) {
    return { success: false, tool: 'ai_agent', result: null, summary: err.message }
  }
}
