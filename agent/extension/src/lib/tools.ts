import { AIToolDef, AgentSettings, DispatchedTask, TaskResult, ChatMessage, AIToolUse } from './types'
import { callAI } from './ai'

// ── Search engine registry ────────────────────────────────────────────────
export const SEARCH_ENGINES: Record<string, string> = {
  google:        'https://www.google.com/search?q=',
  bing:          'https://www.bing.com/search?q=',
  duckduckgo:    'https://duckduckgo.com/?q=',
  baidu:         'https://www.baidu.com/s?wd=',
  github:        'https://github.com/search?q=',
  youtube:       'https://www.youtube.com/results?search_query=',
  wikipedia:     'https://en.wikipedia.org/wiki/Special:Search?search=',
  stackoverflow: 'https://stackoverflow.com/search?q=',
  npm:           'https://www.npmjs.com/search?q=',
  pypi:          'https://pypi.org/search/?q=',
  mdn:           'https://developer.mozilla.org/en-US/search?q=',
}

// ── Tool definitions (MCP / Anthropic tool-use format) ────────────────────
export const BROWSER_TOOLS: AIToolDef[] = [
  {
    name: 'browser_navigate',
    description: 'Navigate the active browser tab to a URL. Returns when the page has loaded.',
    input_schema: {
      type: 'object',
      properties: {
        url:     { type: 'string',  description: 'Absolute URL to navigate to' },
        new_tab: { type: 'boolean', description: 'Open in a new tab instead of current' },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Capture a screenshot of the current tab. Returns a base64 PNG data URL.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_click',
    description: 'Click an element on the page by CSS selector, visible text, or coordinates.',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector' },
        text:     { type: 'string', description: 'Visible text of the element to click' },
        x:        { type: 'number', description: 'X coordinate (px)' },
        y:        { type: 'number', description: 'Y coordinate (px)' },
      },
    },
  },
  {
    name: 'browser_type',
    description: 'Type text into an input field or textarea.',
    input_schema: {
      type: 'object',
      properties: {
        selector:    { type: 'string',  description: 'CSS selector of the input' },
        text:        { type: 'string',  description: 'Text to type' },
        clear_first: { type: 'boolean', description: 'Clear the field before typing (default true)' },
        submit:      { type: 'boolean', description: 'Press Enter after typing' },
      },
      required: ['text'],
    },
  },
  {
    name: 'browser_get_content',
    description: 'Get the visible text content, URL, title, and meta info of the current page.',
    input_schema: {
      type: 'object',
      properties: {
        selector:     { type: 'string',  description: 'Limit content to this CSS selector (default: body)' },
        include_html: { type: 'boolean', description: 'Also return raw HTML (truncated)' },
      },
    },
  },
  {
    name: 'browser_search',
    description: 'Search the web using a popular search engine.',
    input_schema: {
      type: 'object',
      properties: {
        query:  { type: 'string', description: 'Search query' },
        engine: {
          type: 'string',
          enum: Object.keys(SEARCH_ENGINES),
          description: 'Search engine (default: google)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'browser_scroll',
    description: 'Scroll the current page. Returns the resulting scroll position (scrollY, percent, atTop/atBottom), how many pixels actually moved, and which section/headings are now in view — so you know where you landed and what changed.',
    input_schema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom'], description: 'Scroll direction' },
        amount:    { type: 'number', description: 'Pixels to scroll (default 400)' },
        selector:  { type: 'string', description: 'Optional: scroll this element into view instead of by amount' },
      },
      required: ['direction'],
    },
  },
  {
    name: 'browser_wait',
    description: 'Wait for a CSS selector to appear or for a fixed duration.',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'Wait for this CSS element to appear' },
        ms:       { type: 'number', description: 'Wait for this many milliseconds' },
      },
    },
  },
  {
    name: 'browser_evaluate',
    description: 'Execute arbitrary JavaScript in the page context and return the result.',
    input_schema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JavaScript expression or statements to execute' },
      },
      required: ['code'],
    },
  },
  {
    name: 'browser_extract',
    description: 'Extract structured data (text, href, src, etc.) from elements matching a selector.',
    input_schema: {
      type: 'object',
      properties: {
        selector:   { type: 'string', description: 'CSS selector to query' },
        attributes: { type: 'array', items: { type: 'string' }, description: 'Attributes to collect per element' },
        limit:      { type: 'number', description: 'Max number of elements (default 50)' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_find_text',
    description: 'Find all elements that contain specific text on the page.',
    input_schema: {
      type: 'object',
      properties: {
        text:  { type: 'string',  description: 'Text to search for' },
        exact: { type: 'boolean', description: 'Exact match only' },
      },
      required: ['text'],
    },
  },
  {
    name: 'browser_fill_form',
    description: 'Fill multiple form fields in one call.',
    input_schema: {
      type: 'object',
      properties: {
        fields: {
          type: 'array',
          description: 'List of {selector, value} pairs to fill',
          items: {
            type: 'object',
            properties: { selector: { type: 'string' }, value: { type: 'string' } },
            required: ['selector', 'value'],
          },
        },
        submit_selector: { type: 'string', description: 'CSS selector of submit button to click after filling' },
      },
      required: ['fields'],
    },
  },
  {
    name: 'browser_select',
    description: 'Select an option in a <select> dropdown.',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the <select> element' },
        value:    { type: 'string', description: 'Option value or visible text to select' },
      },
      required: ['selector', 'value'],
    },
  },
  {
    name: 'browser_tab_list',
    description: 'List all open browser tabs.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_tab_open',
    description: 'Open a new tab with the given URL.',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'URL for the new tab' } },
      required: ['url'],
    },
  },
  {
    name: 'browser_tab_close',
    description: 'Close a tab by its ID, or the active tab if no ID given.',
    input_schema: {
      type: 'object',
      properties: { tab_id: { type: 'number', description: 'Tab ID to close' } },
    },
  },
  {
    name: 'browser_history_back',
    description: 'Navigate the current tab back in history.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_history_forward',
    description: 'Navigate the current tab forward in history.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_clipboard_write',
    description: 'Write text to the system clipboard.',
    input_schema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Text to copy' } },
      required: ['text'],
    },
  },
  {
    name: 'browser_storage_get',
    description: 'Read a key from the page\'s localStorage or sessionStorage.',
    input_schema: {
      type: 'object',
      properties: {
        key:  { type: 'string', description: 'Storage key' },
        type: { type: 'string', enum: ['local', 'session'], description: 'Storage type (default: local)' },
      },
      required: ['key'],
    },
  },
  {
    name: 'browser_hover',
    description: 'Hover the mouse over an element to reveal tooltips or dropdowns.',
    input_schema: {
      type: 'object',
      properties: { selector: { type: 'string', description: 'CSS selector of element to hover' } },
      required: ['selector'],
    },
  },
  {
    name: 'browser_page_info',
    description: 'Get where you currently are on the page: scroll position (scrollY, percent, atTop/atBottom), viewport size, full page height, the current section heading, all headings now visible in the viewport, and element counts. Call this to orient yourself before/after scrolling or interacting.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_right_click',
    description: 'Right-click (open the context menu) on an element by CSS selector, visible text, or coordinates.',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector' },
        text:     { type: 'string', description: 'Visible text of the element' },
        x:        { type: 'number', description: 'X coordinate (px)' },
        y:        { type: 'number', description: 'Y coordinate (px)' },
      },
    },
  },
  {
    name: 'browser_double_click',
    description: 'Double-click an element by CSS selector, visible text, or coordinates (e.g. to select a word or open an item).',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector' },
        text:     { type: 'string', description: 'Visible text of the element' },
        x:        { type: 'number', description: 'X coordinate (px)' },
        y:        { type: 'number', description: 'Y coordinate (px)' },
      },
    },
  },
  {
    name: 'browser_drag',
    description: 'Drag from a source element/point and drop onto a target element/point. Fires both HTML5 drag-and-drop and pointer events, so it works with most draggable UIs (sliders, sortable lists, file drop zones).',
    input_schema: {
      type: 'object',
      properties: {
        selector:    { type: 'string', description: 'Source CSS selector' },
        text:        { type: 'string', description: 'Source visible text' },
        x:           { type: 'number', description: 'Source X coordinate (px)' },
        y:           { type: 'number', description: 'Source Y coordinate (px)' },
        to_selector: { type: 'string', description: 'Target CSS selector' },
        to_text:     { type: 'string', description: 'Target visible text' },
        to_x:        { type: 'number', description: 'Target X coordinate (px)' },
        to_y:        { type: 'number', description: 'Target Y coordinate (px)' },
      },
    },
  },
  {
    name: 'browser_press_key',
    description: 'Press a keyboard key (optionally with modifiers) on the focused element or a given selector. Useful for Enter, Escape, Tab, Arrow keys, or shortcuts like Ctrl+A.',
    input_schema: {
      type: 'object',
      properties: {
        key:      { type: 'string', description: 'Key name, e.g. "Enter", "Escape", "Tab", "ArrowDown", "a"' },
        selector: { type: 'string', description: 'Optional CSS selector to focus before pressing' },
        ctrl:     { type: 'boolean', description: 'Hold Ctrl' },
        shift:    { type: 'boolean', description: 'Hold Shift' },
        alt:      { type: 'boolean', description: 'Hold Alt' },
        meta:     { type: 'boolean', description: 'Hold Meta/Cmd' },
      },
      required: ['key'],
    },
  },
]

export const BROWSER_CAPABILITIES = BROWSER_TOOLS.map(t => t.name)

// ── Helpers ───────────────────────────────────────────────────────────────
async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab?.id) throw new Error('No active tab found')
  return tab
}

async function contentMsg(tabId: number, msg: any): Promise<any> {
  try {
    return await chrome.tabs.sendMessage(tabId, msg)
  } catch (err: any) {
    if (err.message?.includes('Could not establish connection')) {
      throw new Error('Content script unavailable on this page (try a normal web page, not chrome://).')
    }
    throw err
  }
}

async function waitForTabLoad(tabId: number, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener)
      reject(new Error('Page load timed out'))
    }, timeoutMs)
    function listener(id: number, info: chrome.tabs.TabChangeInfo) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(t)
        chrome.tabs.onUpdated.removeListener(listener)
        resolve()
      }
    }
    chrome.tabs.onUpdated.addListener(listener)
  })
}

// ── Individual browser tool implementations ───────────────────────────────
async function toolNavigate(args: any): Promise<any> {
  if (!args.url) throw new Error('url is required')
  let url: URL
  try { url = new URL(args.url) } catch { url = new URL('https://' + args.url) }

  if (args.new_tab) {
    const tab = await chrome.tabs.create({ url: url.href })
    await waitForTabLoad(tab.id!)
    return { success: true, url: url.href, tabId: tab.id, new_tab: true }
  }
  const tab = await getActiveTab()
  await chrome.tabs.update(tab.id!, { url: url.href })
  await waitForTabLoad(tab.id!)
  return { success: true, url: url.href, tabId: tab.id }
}

async function toolScreenshot(): Promise<any> {
  const tab = await getActiveTab()
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId!, { format: 'png' })
  return { success: true, dataUrl, tabId: tab.id, url: tab.url }
}

async function toolSearch(args: any): Promise<any> {
  const query  = String(args.query || '')
  if (!query) throw new Error('query is required')
  const engine = String(args.engine || 'google').toLowerCase()
  const base   = SEARCH_ENGINES[engine] || SEARCH_ENGINES.google
  const url    = base + encodeURIComponent(query)
  const tab    = await getActiveTab()
  await chrome.tabs.update(tab.id!, { url })
  await waitForTabLoad(tab.id!)
  return { success: true, query, engine, url }
}

async function toolTabList(): Promise<any> {
  const tabs = await chrome.tabs.query({})
  return {
    success: true,
    count: tabs.length,
    tabs: tabs.map(t => ({ id: t.id, url: t.url, title: t.title, active: t.active, windowId: t.windowId })),
  }
}

async function toolTabOpen(args: any): Promise<any> {
  const tab = await chrome.tabs.create({ url: args.url || 'about:blank' })
  return { success: true, tabId: tab.id, url: tab.url }
}

async function toolTabClose(args: any): Promise<any> {
  const tabId = args.tab_id ? Number(args.tab_id) : (await getActiveTab()).id!
  await chrome.tabs.remove(tabId)
  return { success: true, tabId }
}

async function toolHistoryBack(): Promise<any> {
  const tab = await getActiveTab()
  await chrome.scripting.executeScript({ target: { tabId: tab.id! }, func: () => history.back() })
  return { success: true }
}

async function toolHistoryForward(): Promise<any> {
  const tab = await getActiveTab()
  await chrome.scripting.executeScript({ target: { tabId: tab.id! }, func: () => history.forward() })
  return { success: true }
}

async function toolClipboardWrite(args: any): Promise<any> {
  const text = String(args.text ?? '')
  const tab  = await getActiveTab()
  await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    func: (t: string) => navigator.clipboard.writeText(t),
    args: [text],
  })
  return { success: true, length: text.length }
}

// Content-script-dependent tools
async function toolClick(args: any): Promise<any> {
  const tab = await getActiveTab()
  return contentMsg(tab.id!, { action: 'click', selector: args.selector, text: args.text, x: args.x, y: args.y })
}

async function toolType(args: any): Promise<any> {
  const tab = await getActiveTab()
  return contentMsg(tab.id!, { action: 'type', selector: args.selector, text: args.text, clearFirst: args.clear_first !== false, submit: !!args.submit })
}

async function toolGetContent(args: any): Promise<any> {
  const tab = await getActiveTab()
  return contentMsg(tab.id!, { action: 'get_content', selector: args.selector, includeHtml: !!args.include_html })
}

async function toolScroll(args: any): Promise<any> {
  const tab = await getActiveTab()
  return contentMsg(tab.id!, { action: 'scroll', direction: args.direction, amount: args.amount || 400 })
}

async function toolWait(args: any): Promise<any> {
  const tab = await getActiveTab()
  return contentMsg(tab.id!, { action: 'wait', selector: args.selector, ms: args.ms })
}

async function toolEvaluate(args: any): Promise<any> {
  const tab = await getActiveTab()
  return contentMsg(tab.id!, { action: 'evaluate', code: args.code })
}

async function toolExtract(args: any): Promise<any> {
  const tab = await getActiveTab()
  return contentMsg(tab.id!, { action: 'extract', selector: args.selector, attributes: args.attributes, limit: args.limit || 50 })
}

async function toolFindText(args: any): Promise<any> {
  const tab = await getActiveTab()
  return contentMsg(tab.id!, { action: 'find_text', text: args.text, exact: !!args.exact })
}

async function toolFillForm(args: any): Promise<any> {
  const tab = await getActiveTab()
  return contentMsg(tab.id!, { action: 'fill_form', fields: args.fields, submitSelector: args.submit_selector })
}

async function toolSelect(args: any): Promise<any> {
  const tab = await getActiveTab()
  return contentMsg(tab.id!, { action: 'select', selector: args.selector, value: args.value })
}

async function toolStorageGet(args: any): Promise<any> {
  const tab = await getActiveTab()
  return contentMsg(tab.id!, { action: 'storage_get', key: args.key, storageType: args.type || 'local' })
}

async function toolHover(args: any): Promise<any> {
  const tab = await getActiveTab()
  return contentMsg(tab.id!, { action: 'hover', selector: args.selector })
}

async function toolPageInfo(): Promise<any> {
  const tab = await getActiveTab()
  return contentMsg(tab.id!, { action: 'page_info' })
}

async function toolRightClick(args: any): Promise<any> {
  const tab = await getActiveTab()
  return contentMsg(tab.id!, { action: 'right_click', selector: args.selector, text: args.text, x: args.x, y: args.y })
}

async function toolDoubleClick(args: any): Promise<any> {
  const tab = await getActiveTab()
  return contentMsg(tab.id!, { action: 'double_click', selector: args.selector, text: args.text, x: args.x, y: args.y })
}

async function toolDrag(args: any): Promise<any> {
  const tab = await getActiveTab()
  return contentMsg(tab.id!, {
    action: 'drag',
    selector: args.selector, text: args.text, x: args.x, y: args.y,
    toSelector: args.to_selector, toText: args.to_text, toX: args.to_x, toY: args.to_y,
  })
}

async function toolPressKey(args: any): Promise<any> {
  const tab = await getActiveTab()
  return contentMsg(tab.id!, {
    action: 'press_key',
    key: args.key, selector: args.selector,
    ctrl: !!args.ctrl, shift: !!args.shift, alt: !!args.alt, meta: !!args.meta,
  })
}

// ── Central tool router ───────────────────────────────────────────────────
export async function executeBrowserTool(name: string, args: any): Promise<any> {
  switch (name) {
    case 'browser_navigate':         return toolNavigate(args)
    case 'browser_screenshot':       return toolScreenshot()
    case 'browser_click':            return toolClick(args)
    case 'browser_type':             return toolType(args)
    case 'browser_get_content':      return toolGetContent(args)
    case 'browser_search':           return toolSearch(args)
    case 'browser_scroll':           return toolScroll(args)
    case 'browser_wait':             return toolWait(args)
    case 'browser_evaluate':         return toolEvaluate(args)
    case 'browser_extract':          return toolExtract(args)
    case 'browser_find_text':        return toolFindText(args)
    case 'browser_fill_form':        return toolFillForm(args)
    case 'browser_select':           return toolSelect(args)
    case 'browser_tab_list':         return toolTabList()
    case 'browser_tab_open':         return toolTabOpen(args)
    case 'browser_tab_close':        return toolTabClose(args)
    case 'browser_history_back':     return toolHistoryBack()
    case 'browser_history_forward':  return toolHistoryForward()
    case 'browser_clipboard_write':  return toolClipboardWrite(args)
    case 'browser_storage_get':      return toolStorageGet(args)
    case 'browser_hover':            return toolHover(args)
    case 'browser_page_info':        return toolPageInfo()
    case 'browser_right_click':      return toolRightClick(args)
    case 'browser_double_click':     return toolDoubleClick(args)
    case 'browser_drag':             return toolDrag(args)
    case 'browser_press_key':        return toolPressKey(args)
    default:
      throw new Error(`Unknown browser tool: ${name}`)
  }
}

// ── Task keyword inference ────────────────────────────────────────────────
function inferTool(instruction: string): string {
  const t = instruction.toLowerCase()
  if (/截图|screenshot/.test(t))                                    return 'browser_screenshot'
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

// ── Task executor (server-dispatched tasks) ───────────────────────────────
const SYSTEM_PROMPT = `You are HeySure AI, a browser automation assistant running as a Chrome extension.
You can navigate pages, click, type, take screenshots, search the web, and extract information.

When completing a task:
1. Navigate to the relevant URL or search for it
2. Use browser_page_info to know where you are on the page (scroll position, current section, visible headings) and browser_screenshot when you need to see it
3. Interact with elements systematically: click, double_click, right_click, type, fill forms, drag, press_key
4. Extract or summarize the result

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
            const b64 = toolResult.dataUrl.replace(/^data:image\/png;base64,/, '')
            content = [
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } },
              { type: 'text', text: `Screenshot of: ${toolResult.url || 'current page'}` },
            ]
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
