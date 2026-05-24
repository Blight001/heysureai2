// tools/browser.ts — browser_* MCP tool implementations.
// Three kinds of impls live here:
//   1. Pure chrome.* API tools (navigate, screenshot, tab management, history).
//   2. Content-script-relayed tools (click, type, scroll, …) — they forward to
//      the page via chrome.tabs.sendMessage.
//   3. The browser-only router (executeBrowserOnly) that dispatches by name.

import { SEARCH_ENGINES } from './definitions'

// ── Helpers ───────────────────────────────────────────────────────────────
async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab?.id) throw new Error('No active tab found')
  return tab
}

async function contentMsg(tabId: number, msg: any): Promise<any> {
  try {
    const res = await chrome.tabs.sendMessage(tabId, msg)
    if (res?.error) throw new Error(res.error)
    return res
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

// ── chrome.* API tools ────────────────────────────────────────────────────
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

// ── Content-script-relayed tools ──────────────────────────────────────────
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

async function toolFindPopups(args: any): Promise<any> {
  const tab = await getActiveTab()
  return contentMsg(tab.id!, { action: 'find_popups', limit: args.limit || 10 })
}

async function toolClosePopup(args: any): Promise<any> {
  const tab = await getActiveTab()
  const result = await contentMsg(tab.id!, {
    action: 'close_popup',
    selector: args.selector,
    text: args.text,
    index: args.index,
    strategy: args.strategy || 'auto',
    force_remove: !!args.force_remove,
  })
  if (result?.success === false) throw new Error(result.reason || 'Popup close failed')
  return result
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

// ── Browser-only router ───────────────────────────────────────────────────
// Handles browser_* tools only. The combined router (router.ts) layers
// card_* dispatch on top for the public executeBrowserTool.
export async function executeBrowserOnly(name: string, args: any): Promise<any> {
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
    case 'browser_find_popups':      return toolFindPopups(args)
    case 'browser_close_popup':      return toolClosePopup(args)
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
