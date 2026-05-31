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

function unsupportedScreenshotReason(url?: string) {
  const raw = String(url || '')
  if (/^(chrome|edge|brave|vivaldi|opera|chrome-extension):\/\//i.test(raw)) {
    return '浏览器内部页面或扩展页面不允许扩展截图。请切换到普通 http/https 页面后重试。'
  }
  if (/^https:\/\/chromewebstore\.google\.com\//i.test(raw)) {
    return 'Chrome 网上应用店页面不允许扩展截图。'
  }
  return ''
}

function isRetryableCaptureError(message: string) {
  return /quota|too many|rate|active|visible|tab|capture|pending|loading/i.test(message)
}

async function delay(ms: number) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function boundedTimeout(value: any, fallback: number, min = 1000, max = 30000) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

type ScreenshotFormat = 'png' | 'jpeg' | 'webp'

type ScreenshotClip = {
  x: number
  y: number
  width: number
  height: number
  scale?: number
}

function screenshotFormat(args: any): ScreenshotFormat {
  const format = String(args.format || 'png').toLowerCase()
  return ['png', 'jpeg', 'webp'].includes(format) ? format as ScreenshotFormat : 'png'
}

function screenshotQuality(args: any) {
  const quality = Number(args.quality)
  if (!Number.isFinite(quality)) return undefined
  return Math.min(100, Math.max(0, Math.round(quality)))
}

function maxDataUrlChars(args: any) {
  const n = Number(args.max_data_url_chars)
  if (Number.isFinite(n) && n > 0) return Math.min(20_000_000, Math.max(100_000, Math.round(n)))
  return 8_000_000
}

async function ensureScreenshotPayloadSize(
  dataUrl: string,
  args: any,
  retryCompressed?: () => Promise<string>,
) {
  const maxChars = maxDataUrlChars(args)
  if (dataUrl.length <= maxChars || args.allow_large_data_url === true) {
    return { dataUrl, warning: '' }
  }

  if (retryCompressed && screenshotFormat(args) !== 'jpeg') {
    const compressed = await retryCompressed()
    if (compressed.length <= maxChars || args.allow_large_data_url === true) {
      return {
        dataUrl: compressed,
        warning: `Original screenshot payload was ${dataUrl.length} chars; returned compressed JPEG payload ${compressed.length} chars.`,
      }
    }
    throw new Error(`Screenshot payload is too large after JPEG compression: ${compressed.length} chars > max_data_url_chars ${maxChars}`)
  }

  throw new Error(`Screenshot payload is too large: ${dataUrl.length} chars > max_data_url_chars ${maxChars}`)
}

function clipArea(clip: ScreenshotClip) {
  return Math.max(0, clip.width) * Math.max(0, clip.height)
}

function assertValidClip(clip: ScreenshotClip, maxArea: number) {
  if (!Number.isFinite(clip.x) || !Number.isFinite(clip.y) || !Number.isFinite(clip.width) || !Number.isFinite(clip.height)) {
    throw new Error('clip/x/y/width/height must be finite numbers')
  }
  if (clip.width <= 0 || clip.height <= 0) throw new Error('clip width and height must be greater than 0')
  if (clipArea(clip) > maxArea) {
    throw new Error(`Screenshot area is too large: ${Math.round(clipArea(clip))} CSS pixels > max_area ${maxArea}`)
  }
}

async function captureVisibleTab(windowId: number, args: any, retries = 1) {
  let lastErr: any
  const timeoutMs = boundedTimeout(args.visible_timeout_ms ?? args.timeout_ms, 8000)
  for (let i = 0; i <= retries; i++) {
    try {
      return await withTimeout(
        chrome.tabs.captureVisibleTab(windowId, {
          format: screenshotFormat(args) === 'jpeg' ? 'jpeg' : 'png',
          quality: screenshotQuality(args),
        }),
        timeoutMs,
        'chrome.tabs.captureVisibleTab',
      )
    } catch (err: any) {
      lastErr = err
      const message = err?.message || String(err)
      if (i >= retries || !isRetryableCaptureError(message)) break
      await delay(300)
    }
  }
  throw lastErr
}

async function pageClipFromArgs(tab: chrome.tabs.Tab, args: any): Promise<ScreenshotClip | null> {
  const maxArea = Math.max(1, Number(args.max_area || 25_000_000))
  const scale = Number(args.scale || 1)
  const contentTimeoutMs = boundedTimeout(args.content_timeout_ms ?? args.timeout_ms, 5000)
  const cdpTimeoutMs = boundedTimeout(args.cdp_timeout_ms ?? args.timeout_ms, 12000)

  if (args.selector || args.text) {
    const target = await withTimeout(
      contentMsg(tab.id!, {
        action: 'screenshot_target_info',
        selector: args.selector,
        text: args.text,
        margin: args.margin ?? args.padding,
        scroll_into_view: args.scroll_into_view,
        block: args.block,
        inline: args.inline,
      }),
      contentTimeoutMs,
      'screenshot target measurement',
    )
    const rect = target?.rect?.page
    const clip = {
      x: Number(rect?.x),
      y: Number(rect?.y),
      width: Number(rect?.width),
      height: Number(rect?.height),
      scale,
    }
    assertValidClip(clip, maxArea)
    return clip
  }

  const rawClip = args.clip && typeof args.clip === 'object' ? args.clip : args
  const hasRegion = rawClip.x !== undefined && rawClip.y !== undefined && rawClip.width !== undefined && rawClip.height !== undefined
  if (!hasRegion) return null

  const coordinateSpace = String(args.coordinate_space || rawClip.coordinate_space || 'viewport')
  let x = Number(rawClip.x)
  let y = Number(rawClip.y)
  if (coordinateSpace !== 'page') {
    const metrics: any = await withTimeout(
      chrome.debugger.sendCommand({ tabId: tab.id! }, 'Page.getLayoutMetrics'),
      cdpTimeoutMs,
      'CDP Page.getLayoutMetrics',
    )
    const viewport = metrics?.cssLayoutViewport || metrics?.layoutViewport
    x += Number(viewport?.pageX || 0)
    y += Number(viewport?.pageY || 0)
  }

  const clip = {
    x: Math.max(0, x),
    y: Math.max(0, y),
    width: Number(rawClip.width),
    height: Number(rawClip.height),
    scale,
  }
  assertValidClip(clip, maxArea)
  return clip
}

async function captureWithDebugger(tab: chrome.tabs.Tab, args: any = {}) {
  const target = { tabId: tab.id! }
  let attached = false
  const timeoutMs = boundedTimeout(args.cdp_timeout_ms ?? args.timeout_ms, 12000)
  try {
    await withTimeout(chrome.debugger.attach(target, '1.3'), timeoutMs, 'CDP attach')
    attached = true

    await withTimeout(chrome.debugger.sendCommand(target, 'Page.enable'), timeoutMs, 'CDP Page.enable')
    const format = screenshotFormat(args)
    const params: any = { format, fromSurface: args.from_surface !== false }
    const quality = screenshotQuality(args)
    if (format !== 'png' && quality !== undefined) params.quality = quality

    const maxArea = Math.max(1, Number(args.max_area || 25_000_000))
    const clip = await pageClipFromArgs(tab, args)

    if (clip) {
      params.captureBeyondViewport = true
      params.clip = clip
    } else if (args.full_page) {
      const metrics: any = await withTimeout(
        chrome.debugger.sendCommand(target, 'Page.getLayoutMetrics'),
        timeoutMs,
        'CDP Page.getLayoutMetrics',
      )
      const size = metrics?.cssContentSize || metrics?.contentSize
      if (size?.width && size?.height) {
        const fullClip = {
          x: 0,
          y: 0,
          width: Math.ceil(size.width),
          height: Math.ceil(size.height),
          scale: Number(args.scale || 1),
        }
        assertValidClip(fullClip, maxArea)
        params.captureBeyondViewport = true
        params.clip = fullClip
      }
    }

    const result: any = await withTimeout(
      chrome.debugger.sendCommand(target, 'Page.captureScreenshot', params),
      timeoutMs,
      'CDP Page.captureScreenshot',
    )
    if (!result?.data) throw new Error('CDP Page.captureScreenshot returned no image data')
    return `data:image/${format === 'jpeg' ? 'jpeg' : format};base64,${result.data}`
  } finally {
    if (attached) {
      try { await chrome.debugger.detach(target) } catch { /* tab may have closed */ }
    }
  }
}

async function toolScreenshot(args: any = {}): Promise<any> {
  const tab = await getActiveTab()
  const unsupported = unsupportedScreenshotReason(tab.url)
  if (unsupported) {
    return {
      success: false,
      disabled: true,
      unsupported: true,
      error: unsupported,
      tabId: tab.id,
      url: tab.url,
      hint: unsupported,
    }
  }

  const wantsDebuggerCapture = !!(args.full_page || args.selector || args.text || args.clip || (
    args.x !== undefined && args.y !== undefined && args.width !== undefined && args.height !== undefined
  ))
  const attempts: string[] = []
  if (wantsDebuggerCapture) {
    try {
      const dataUrl = await captureWithDebugger(tab, args)
      const optimized = await ensureScreenshotPayloadSize(dataUrl, args, () => captureWithDebugger(tab, {
        ...args,
        format: 'jpeg',
        quality: args.quality ?? 70,
      }))
      return {
        success: true,
        dataUrl: optimized.dataUrl,
        tabId: tab.id,
        url: tab.url,
        method: args.full_page
          ? 'debugger.Page.captureScreenshot.fullPage'
          : args.selector || args.text
            ? 'debugger.Page.captureScreenshot.element'
            : 'debugger.Page.captureScreenshot.clip',
        warning: optimized.warning || undefined,
      }
    } catch (err: any) {
      attempts.push(`debugger.Page.captureScreenshot: ${err?.message || String(err)}`)
    }
    if (args.fallback_visible !== true) {
      const message = attempts.join('; ')
      return {
        success: false,
        disabled: /disabled|permission|not allowed|cannot|restricted|debugger/i.test(message),
        error: message,
        tabId: tab.id,
        url: tab.url,
        hint: '精确截图失败。请检查 selector/text/clip 参数；若要失败时退回可视区域截图，请传 fallback_visible:true。',
      }
    }
  }

  try {
    const dataUrl = await captureVisibleTab(tab.windowId!, args, Number(args.retries ?? 1))
    const optimized = await ensureScreenshotPayloadSize(dataUrl, args, () => captureVisibleTab(tab.windowId!, {
      ...args,
      format: 'jpeg',
      quality: args.quality ?? 70,
      retries: 0,
    }, 0))
    return {
      success: true,
      dataUrl: optimized.dataUrl,
      tabId: tab.id,
      url: tab.url,
      method: 'captureVisibleTab',
      warning: [attempts.length ? attempts.join('; ') : '', optimized.warning].filter(Boolean).join('; ') || undefined,
    }
  } catch (err: any) {
    attempts.push(`captureVisibleTab: ${err?.message || String(err)}`)
  }

  if (!wantsDebuggerCapture) {
    try {
      const dataUrl = await captureWithDebugger(tab, args)
      const optimized = await ensureScreenshotPayloadSize(dataUrl, args, () => captureWithDebugger(tab, {
        ...args,
        format: 'jpeg',
        quality: args.quality ?? 70,
      }))
      return {
        success: true,
        dataUrl: optimized.dataUrl,
        tabId: tab.id,
        url: tab.url,
        method: 'debugger.Page.captureScreenshot',
        warning: [attempts.join('; '), optimized.warning].filter(Boolean).join('; '),
      }
    } catch (err: any) {
      attempts.push(`debugger.Page.captureScreenshot: ${err?.message || String(err)}`)
    }
  }

  const message = attempts.join('; ')
  return {
    success: false,
    disabled: /disabled|permission|not allowed|cannot|restricted|debugger/i.test(message),
    error: message,
    tabId: tab.id,
    url: tab.url,
    hint: '截图不可用。请确认扩展拥有当前页面权限；若页面是浏览器内部页、扩展页、Chrome 网上应用店或受 DRM 保护内容，Chrome 会阻止截图。',
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

// ── Action-dispatching handlers ───────────────────────────────────────────
// State-management ops (tab / cookie / storage / session / profile / history)
// were previously one tool per verb. They're now a single tool that switches on
// an `action` param. Each branch just delegates to the original impl above, so
// behaviour is unchanged — only the tool surface is smaller.
function badAction(tool: string, action: any, allowed: string[]): never {
  const got = action === undefined || action === '' ? '(空)' : String(action)
  throw new Error(`${tool}: 未知 action「${got}」，可选 ${allowed.join(' / ')}`)
}

function toolTab(args: any): Promise<any> {
  switch (args?.action) {
    case 'list':  return toolTabList()
    case 'open':  return toolTabOpen(args)
    case 'close': return toolTabClose(args)
    default:      return badAction('browser_tab', args?.action, ['list', 'open', 'close'])
  }
}

function toolHistory(args: any): Promise<any> {
  switch (args?.action) {
    case 'back':    return toolHistoryBack()
    case 'forward': return toolHistoryForward()
    default:        return badAction('browser_history', args?.action, ['back', 'forward'])
  }
}

function toolCookie(args: any): Promise<any> {
  switch (args?.action) {
    case 'list':   return toolCookieList(args)
    case 'get':    return toolCookieGet(args)
    case 'set':    return toolCookieSet(args)
    case 'delete': return toolCookieDelete(args)
    default:       return badAction('browser_cookie', args?.action, ['list', 'get', 'set', 'delete'])
  }
}

function toolStorage(args: any): Promise<any> {
  switch (args?.action) {
    case 'get':    return toolStorageGet(args)
    case 'set':    return toolStorageSet(args)
    case 'remove': return toolStorageRemove(args)
    case 'list':   return toolStorageList(args)
    default:       return badAction('browser_storage', args?.action, ['get', 'set', 'remove', 'list'])
  }
}

function toolSession(args: any): Promise<any> {
  switch (args?.action) {
    case 'save':    return toolSessionSave(args)
    case 'list':    return toolSessionList()
    case 'restore': return toolSessionRestore(args)
    case 'delete':  return toolSessionDelete(args)
    default:        return badAction('browser_session', args?.action, ['save', 'list', 'restore', 'delete'])
  }
}

function toolProfile(args: any): Promise<any> {
  switch (args?.action) {
    case 'info': return toolProfileInfo()
    case 'set':  return toolProfileSet(args)
    default:     return badAction('browser_profile', args?.action, ['info', 'set'])
  }
}

// ── Browser-only router ───────────────────────────────────────────────────
// Handles browser_* tools only. Each entry returns the tool's promise. Legacy
// per-verb names (browser_cookie_get, …) are kept as aliases that translate to
// the merged "tool + action" form, so older callers keep working.
type ToolHandler = (args: any) => Promise<any>

const HANDLERS: Record<string, ToolHandler> = {
  // Navigation & search
  browser_navigate:      toolNavigate,
  browser_search:        toolSearch,
  browser_history:       toolHistory,
  // Page observation
  browser_screenshot:    toolScreenshot,
  browser_get_content:   toolGetContent,
  browser_dom_snapshot:  toolDomSnapshot,
  browser_page_info:     () => toolPageInfo(),
  browser_find_text:     toolFindText,
  browser_find_popups:   toolFindPopups,
  browser_performance:   () => toolPerformance(),
  browser_network_log:   toolNetworkLog,
  browser_iframe_list:   () => toolIframeList(),
  // Interaction
  browser_click:         toolClick,
  browser_double_click:  toolDoubleClick,
  browser_right_click:   toolRightClick,
  browser_type:          toolType,
  browser_press_key:     toolPressKey,
  browser_hover:         toolHover,
  browser_scroll:        toolScroll,
  browser_wait:          toolWait,
  browser_drag:          toolDrag,
  browser_fill_form:     toolFillForm,
  browser_select:        toolSelect,
  browser_close_popup:   toolClosePopup,
  // Data & scripting
  browser_evaluate:      toolEvaluate,
  browser_extract:       toolExtract,
  browser_clipboard_write: toolClipboardWrite,
  browser_file_upload:   toolFileUpload,
  browser_download:      toolDownload,
  // Browser state (merged action tools)
  browser_tab:           toolTab,
  browser_cookie:        toolCookie,
  browser_storage:       toolStorage,
  browser_session:       toolSession,
  browser_profile:       toolProfile,
}

// Legacy per-verb names → { tool, action } injected into the merged handler.
const LEGACY_ALIASES: Record<string, { tool: string; action: string }> = {
  browser_tab_list:       { tool: 'browser_tab',     action: 'list' },
  browser_tab_open:       { tool: 'browser_tab',     action: 'open' },
  browser_tab_close:      { tool: 'browser_tab',     action: 'close' },
  browser_history_back:   { tool: 'browser_history', action: 'back' },
  browser_history_forward:{ tool: 'browser_history', action: 'forward' },
  browser_cookie_list:    { tool: 'browser_cookie',  action: 'list' },
  browser_cookie_get:     { tool: 'browser_cookie',  action: 'get' },
  browser_cookie_set:     { tool: 'browser_cookie',  action: 'set' },
  browser_cookie_delete:  { tool: 'browser_cookie',  action: 'delete' },
  browser_storage_get:    { tool: 'browser_storage', action: 'get' },
  browser_storage_set:    { tool: 'browser_storage', action: 'set' },
  browser_storage_remove: { tool: 'browser_storage', action: 'remove' },
  browser_storage_list:   { tool: 'browser_storage', action: 'list' },
  browser_session_save:   { tool: 'browser_session', action: 'save' },
  browser_session_list:   { tool: 'browser_session', action: 'list' },
  browser_session_restore:{ tool: 'browser_session', action: 'restore' },
  browser_session_delete: { tool: 'browser_session', action: 'delete' },
  browser_profile_info:   { tool: 'browser_profile', action: 'info' },
  browser_profile_set:    { tool: 'browser_profile', action: 'set' },
}

export async function executeBrowserOnly(name: string, args: any): Promise<any> {
  try {
    const alias = LEGACY_ALIASES[name]
    if (alias) {
      return await HANDLERS[alias.tool]({ ...(args || {}), action: alias.action })
    }
    const handler = HANDLERS[name]
    if (!handler) throw new Error(`Unknown browser tool: ${name}`)
    return await handler(args || {})
  } catch (err: any) {
    if (args?.trace || args?.return_error) {
      return { success: false, error: normalizeToolError(err, name, args) }
    }
    throw err
  }
}
