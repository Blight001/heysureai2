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
    if (res?.error) {
      const detail = typeof res.error === 'object'
        ? res.error
        : { message: String(res.error), code: 'CONTENT_ACTION_FAILED' }
      const err: any = new Error(detail.message || 'Content action failed')
      err.code = detail.code || 'CONTENT_ACTION_FAILED'
      err.suggestion = detail.suggestion
      err.trace = res.trace
      throw err
    }
    return res
  } catch (err: any) {
    if (err.message?.includes('Could not establish connection')) {
      const e: any = new Error('Content script unavailable on this page (try a normal web page, not chrome://).')
      e.code = 'CONTENT_SCRIPT_UNAVAILABLE'
      e.suggestion = 'Navigate to a normal http/https page and retry.'
      throw e
    }
    throw err
  }
}

function normalizeToolError(err: any, name: string, args: any) {
  return {
    message: err?.message || String(err),
    code: err?.code || 'TOOL_FAILED',
    suggestion: err?.suggestion || suggestionForTool(name),
    trace: args?.trace ? {
      tool: name,
      args,
      cause: err?.trace || null,
      stack: err?.stack || '',
      timestamp: Date.now(),
    } : undefined,
  }
}

function suggestionForTool(name: string) {
  if (name.includes('click') || name.includes('select') || name.includes('drag')) return 'Use browser_page_info, browser_dom_snapshot, or browser_find_text to verify the target selector/text, then retry.'
  if (name.includes('screenshot')) return 'Confirm the tool is enabled by policy and the extension has permission for the current tab.'
  if (name.includes('cookie')) return 'Confirm the cookies permission is enabled and the URL/domain is valid.'
  return 'Check tool parameters and current page state, then retry with trace:true for details.'
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
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId!, { format: 'png' })
    return { success: true, dataUrl, tabId: tab.id, url: tab.url }
  } catch (err: any) {
    const message = err?.message || String(err)
    return {
      success: false,
      disabled: /disabled|permission|not allowed|cannot|capture/i.test(message),
      error: message,
      tabId: tab.id,
      url: tab.url,
      hint: '截图不可用。请确认管理员已分配 browser_screenshot 工具，且扩展拥有当前页面的捕获权限。',
    }
  }
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
  return contentMsg(tab.id!, { action: 'scroll', direction: args.direction, amount: args.amount || 400, selector: args.selector })
}

async function toolWait(args: any): Promise<any> {
  const tab = await getActiveTab()
  return contentMsg(tab.id!, { action: 'wait', selector: args.selector, ms: args.ms })
}

function remoteObjectValue(obj: any): any {
  if (!obj) return undefined
  if ('value' in obj) return obj.value
  if ('unserializableValue' in obj) return obj.unserializableValue
  return obj.description ?? `[${obj.type || 'unknown'}]`
}

function exceptionMessage(details: any): string {
  const exception = details?.exception
  return exception?.description || exception?.value || details?.text || 'JavaScript evaluation failed'
}

async function debuggerEvaluate(tabId: number, code: string): Promise<any> {
  const target = { tabId }
  let attached = false

  async function evaluateExpression(expression: string) {
    const result: any = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
      replMode: true,
    })
    if (result?.exceptionDetails) throw new Error(exceptionMessage(result.exceptionDetails))
    return result?.result
  }

  try {
    await chrome.debugger.attach(target, '1.3')
    attached = true

    let result: any
    try {
      result = await evaluateExpression(code)
    } catch (err: any) {
      if (!/Illegal return statement|Unexpected token|await is only valid/i.test(err.message || '')) throw err
      result = await evaluateExpression(`(async () => {\n${code}\n})()`)
    }

    return {
      success: true,
      result: remoteObjectValue(result),
      type: result?.type,
      subtype: result?.subtype,
      executionContext: 'debugger',
    }
  } finally {
    if (attached) {
      try { await chrome.debugger.detach(target) } catch { /* tab may have closed */ }
    }
  }
}

async function toolEvaluate(args: any): Promise<any> {
  const tab = await getActiveTab()
  const rawCode = args.code ?? args.function ?? args.fn ?? args.expression
  const code = typeof rawCode === 'function' ? String(rawCode) : String(rawCode || '')
  if (!code) throw new Error('code is required')

  try {
    return await debuggerEvaluate(tab.id!, code)
  } catch (debuggerErr: any) {
    try {
      const fallback = await contentMsg(tab.id!, { action: 'evaluate', code })
      return {
        ...fallback,
        executionContext: 'content_script',
        warning: `CDP Runtime.evaluate failed: ${debuggerErr.message || String(debuggerErr)}`,
      }
    } catch (contentErr: any) {
      throw new Error(`browser_evaluate failed. CDP Runtime.evaluate: ${debuggerErr.message || String(debuggerErr)}; content script fallback: ${contentErr.message || String(contentErr)}`)
    }
  }
}

async function toolExtract(args: any): Promise<any> {
  const tab = await getActiveTab()
  return contentMsg(tab.id!, { action: 'extract', selector: args.selector, attributes: args.attributes, limit: args.limit || 50 })
}

async function toolDomSnapshot(args: any): Promise<any> {
  const tab = await getActiveTab()
  return contentMsg(tab.id!, { action: 'dom_snapshot', selector: args.selector, max_depth: args.max_depth, max_nodes: args.max_nodes, trace: !!args.trace })
}

async function toolIframeList(): Promise<any> {
  const tab = await getActiveTab()
  return contentMsg(tab.id!, { action: 'iframe_list' })
}

async function toolPerformance(): Promise<any> {
  const tab = await getActiveTab()
  return contentMsg(tab.id!, { action: 'performance' })
}

async function toolNetworkLog(args: any): Promise<any> {
  const tab = await getActiveTab()
  const result = await contentMsg(tab.id!, { action: 'performance' })
  return {
    ...result,
    source: 'performance_resource_timing',
    warning: 'This is a passive resource-timing view, not active network interception. Full request/response interception requires a debugger/webRequest pipeline.',
    limit: args.limit || 20,
    requests: (result.resources?.slowest || []).slice(0, args.limit || 20),
  }
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
  return contentMsg(tab.id!, {
    action: 'fill_form',
    fields: args.fields || args.form_fields || args.values,
    submitSelector: args.submit_selector || args.submitSelector,
  })
}

async function toolSelect(args: any): Promise<any> {
  const tab = await getActiveTab()
  return contentMsg(tab.id!, { action: 'select', selector: args.selector, value: args.value ?? args.text ?? args.option_text })
}

async function toolStorageGet(args: any): Promise<any> {
  const tab = await getActiveTab()
  return contentMsg(tab.id!, { action: 'storage_get', key: args.key, storageType: args.type || 'local' })
}

async function toolStorageSet(args: any): Promise<any> {
  const tab = await getActiveTab()
  return contentMsg(tab.id!, { action: 'storage_set', key: args.key, value: args.value, storageType: args.type || 'local' })
}

async function toolStorageRemove(args: any): Promise<any> {
  const tab = await getActiveTab()
  return contentMsg(tab.id!, { action: 'storage_remove', key: args.key, storageType: args.type || 'local' })
}

async function toolStorageList(args: any): Promise<any> {
  const tab = await getActiveTab()
  return contentMsg(tab.id!, { action: 'storage_list', prefix: args.prefix, include_values: !!args.include_values, limit: args.limit, storageType: args.type || 'local' })
}

async function toolFileUpload(args: any): Promise<any> {
  const tab = await getActiveTab()
  return contentMsg(tab.id!, { action: 'file_upload', selector: args.selector, files: args.files })
}

async function toolDownload(args: any): Promise<any> {
  if (!args.url) throw new Error('url is required')
  const id = await chrome.downloads.download({
    url: String(args.url),
    filename: args.filename ? String(args.filename) : undefined,
    saveAs: !!args.save_as,
  })
  return { success: true, downloadId: id, url: args.url, filename: args.filename || '' }
}

async function toolCookieList(args: any): Promise<any> {
  const tab = await getActiveTab()
  const url = String(args.url || tab.url || '')
  const cookies = await chrome.cookies.getAll(args.domain ? { domain: String(args.domain) } : { url })
  return { success: true, url, domain: args.domain || '', count: cookies.length, cookies }
}

async function toolCookieGet(args: any): Promise<any> {
  const tab = await getActiveTab()
  const url = String(args.url || tab.url || '')
  if (!args.name) throw new Error('name is required')
  const cookie = await chrome.cookies.get({ url, name: String(args.name) })
  return { success: true, url, name: args.name, found: !!cookie, cookie }
}

async function toolCookieSet(args: any): Promise<any> {
  const tab = await getActiveTab()
  const url = String(args.url || tab.url || '')
  if (!args.name) throw new Error('name is required')
  const cookie = await chrome.cookies.set({
    url,
    name: String(args.name),
    value: String(args.value ?? ''),
    domain: args.domain ? String(args.domain) : undefined,
    path: args.path ? String(args.path) : undefined,
    secure: args.secure === undefined ? undefined : !!args.secure,
    httpOnly: args.http_only === undefined ? undefined : !!args.http_only,
    expirationDate: args.expiration_date ? Number(args.expiration_date) : undefined,
  })
  return { success: true, cookie }
}

async function toolCookieDelete(args: any): Promise<any> {
  const tab = await getActiveTab()
  const url = String(args.url || tab.url || '')
  if (!args.name) throw new Error('name is required')
  const details = await chrome.cookies.remove({ url, name: String(args.name) })
  return { success: true, removed: !!details, details }
}

const SESSION_KEY = '_browser_sessions'

async function readSessions(): Promise<any[]> {
  const r = await chrome.storage.local.get(SESSION_KEY)
  return Array.isArray(r[SESSION_KEY]) ? r[SESSION_KEY] : []
}

async function writeSessions(sessions: any[]): Promise<void> {
  await chrome.storage.local.set({ [SESSION_KEY]: sessions })
}

async function toolSessionSave(args: any): Promise<any> {
  const tab = await getActiveTab()
  const id = String(args.id || `session_${Date.now()}`)
  const name = String(args.name || id)
  let local: any = null
  let session: any = null
  try { local = await contentMsg(tab.id!, { action: 'storage_list', include_values: true, storageType: 'local', limit: 500 }) } catch { /* ignore */ }
  try { session = await contentMsg(tab.id!, { action: 'storage_list', include_values: true, storageType: 'session', limit: 500 }) } catch { /* ignore */ }
  const snapshot = { id, name, url: tab.url, title: tab.title, createdAt: Date.now(), storage: { local, session } }
  const sessions = (await readSessions()).filter(s => s.id !== id)
  sessions.push(snapshot)
  await writeSessions(sessions)
  return { success: true, session: snapshot }
}

async function toolSessionList(): Promise<any> {
  const sessions = await readSessions()
  return { success: true, count: sessions.length, sessions: sessions.map(s => ({ id: s.id, name: s.name, url: s.url, title: s.title, createdAt: s.createdAt })) }
}

async function toolSessionRestore(args: any): Promise<any> {
  const sessions = await readSessions()
  const target = sessions.find(s => s.id === args.id || s.name === args.name)
  if (!target) throw new Error('session not found')
  await toolNavigate({ url: target.url, new_tab: !!args.new_tab })
  const tab = await getActiveTab()
  for (const item of target.storage?.local?.items || []) {
    await contentMsg(tab.id!, { action: 'storage_set', key: item.key, value: item.value, storageType: 'local' }).catch(() => {})
  }
  for (const item of target.storage?.session?.items || []) {
    await contentMsg(tab.id!, { action: 'storage_set', key: item.key, value: item.value, storageType: 'session' }).catch(() => {})
  }
  return { success: true, restored: { id: target.id, name: target.name, url: target.url } }
}

async function toolSessionDelete(args: any): Promise<any> {
  const sessions = await readSessions()
  const kept = sessions.filter(s => s.id !== args.id && s.name !== args.name)
  await writeSessions(kept)
  return { success: true, deleted: sessions.length - kept.length }
}

async function toolProfileInfo(): Promise<any> {
  const r = await chrome.storage.local.get('_logical_profile')
  return {
    success: true,
    profile: r._logical_profile || 'default',
    scope: 'extension-logical-profile',
    warning: 'Chrome extensions cannot switch the browser user profile. This is a logical profile marker for extension-side state only.',
  }
}

async function toolProfileSet(args: any): Promise<any> {
  const profile = String(args.name || args.profile || 'default')
  await chrome.storage.local.set({ _logical_profile: profile })
  return { success: true, profile, scope: 'extension-logical-profile' }
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
  try {
    switch (name) {
      case 'browser_navigate':         return toolNavigate(args)
      case 'browser_screenshot':       return toolScreenshot()
      case 'browser_click':            return toolClick(args)
      case 'browser_type':             return toolType(args)
      case 'browser_get_content':      return toolGetContent(args)
      case 'browser_dom_snapshot':     return toolDomSnapshot(args)
      case 'browser_search':           return toolSearch(args)
      case 'browser_scroll':           return toolScroll(args)
      case 'browser_wait':             return toolWait(args)
      case 'browser_evaluate':         return toolEvaluate(args)
      case 'browser_extract':          return toolExtract(args)
      case 'browser_iframe_list':      return toolIframeList()
      case 'browser_performance':      return toolPerformance()
      case 'browser_network_log':      return toolNetworkLog(args)
      case 'browser_file_upload':      return toolFileUpload(args)
      case 'browser_download':         return toolDownload(args)
      case 'browser_cookie_list':      return toolCookieList(args)
      case 'browser_cookie_get':       return toolCookieGet(args)
      case 'browser_cookie_set':       return toolCookieSet(args)
      case 'browser_cookie_delete':    return toolCookieDelete(args)
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
      case 'browser_storage_set':      return toolStorageSet(args)
      case 'browser_storage_remove':   return toolStorageRemove(args)
      case 'browser_storage_list':     return toolStorageList(args)
      case 'browser_session_save':     return toolSessionSave(args)
      case 'browser_session_list':     return toolSessionList()
      case 'browser_session_restore':  return toolSessionRestore(args)
      case 'browser_session_delete':   return toolSessionDelete(args)
      case 'browser_profile_info':     return toolProfileInfo()
      case 'browser_profile_set':      return toolProfileSet(args)
      case 'browser_hover':            return toolHover(args)
      case 'browser_page_info':        return toolPageInfo()
      case 'browser_right_click':      return toolRightClick(args)
      case 'browser_double_click':     return toolDoubleClick(args)
      case 'browser_drag':             return toolDrag(args)
      case 'browser_press_key':        return toolPressKey(args)
      default:
        throw new Error(`Unknown browser tool: ${name}`)
    }
  } catch (err: any) {
    if (args?.trace || args?.return_error) {
      return { success: false, error: normalizeToolError(err, name, args) }
    }
    throw err
  }
}
