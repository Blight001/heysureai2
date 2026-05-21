// content.ts — injected into every web page
// Handles DOM operations dispatched from the background service worker

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleAction(msg).then(sendResponse).catch(err => sendResponse({ error: err.message || String(err) }))
  return true  // keep message channel open for async response
})

async function handleAction(msg: any): Promise<any> {
  switch (msg.action) {
    case 'click':        return doClick(msg)
    case 'type':         return doType(msg)
    case 'get_content':  return getContent(msg)
    case 'scroll':       return doScroll(msg)
    case 'wait':         return doWait(msg)
    case 'evaluate':     return doEvaluate(msg)
    case 'extract':      return doExtract(msg)
    case 'find_text':    return findText(msg)
    case 'fill_form':    return fillForm(msg)
    case 'select':       return doSelect(msg)
    case 'hover':        return doHover(msg)
    case 'storage_get':  return storageGet(msg)
    default:
      throw new Error(`Unknown content action: ${msg.action}`)
  }
}

// ── DOM helpers ───────────────────────────────────────────────────────────
function findEl(selector?: string, text?: string): Element | null {
  if (selector) return document.querySelector(selector)
  if (text) {
    // Try exact text match via XPath
    const xp = `.//*[normalize-space(.)='${text.replace(/'/g, "\\'")}'][not(.//*)]`
    const r = document.evaluate(xp, document.body, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
    if (r.singleNodeValue) return r.singleNodeValue as Element
    // Fallback: partial text match in leaf nodes
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
    while (walker.nextNode()) {
      const el = walker.currentNode as HTMLElement
      if (!el.children.length && el.innerText?.trim() === text) return el
    }
  }
  return null
}

// ── Click ─────────────────────────────────────────────────────────────────
function doClick(msg: any) {
  const { selector, text, x, y } = msg
  let el: Element | null = null

  if (x !== undefined && y !== undefined) {
    el = document.elementFromPoint(Number(x), Number(y))
  } else {
    el = findEl(selector, text)
  }

  if (!el) throw new Error(`Element not found: selector=${selector || ''} text=${text || ''} coords=${x},${y}`)
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  ;(el as HTMLElement).click()
  return { success: true, tag: el.tagName, text: (el as HTMLElement).innerText?.slice(0, 100) }
}

// ── Type ──────────────────────────────────────────────────────────────────
function doType(msg: any) {
  const selector   = msg.selector || 'input:focus, textarea:focus, [contenteditable]:focus'
  const text       = String(msg.text ?? '')
  const clearFirst = msg.clearFirst !== false

  let el = selector ? document.querySelector(selector) as HTMLInputElement | null : null
  if (!el) el = document.activeElement as HTMLInputElement | null

  if (!el) throw new Error('No input element found — try providing a selector')

  el.focus()

  if (el.isContentEditable) {
    if (clearFirst) el.textContent = ''
    el.textContent += text
    el.dispatchEvent(new Event('input', { bubbles: true }))
  } else {
    if (clearFirst) {
      el.value = ''
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    el.value += text
    el.dispatchEvent(new Event('input',  { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  if (msg.submit) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

  return { success: true, text, length: text.length }
}

// ── Get content ───────────────────────────────────────────────────────────
function getContent(msg: any) {
  const root = msg.selector ? document.querySelector(msg.selector) : document.body
  if (!root) throw new Error(`Element not found: ${msg.selector}`)

  const text = (root as HTMLElement).innerText?.slice(0, 50000) || ''
  const result: any = {
    success: true,
    url:   location.href,
    title: document.title,
    text,
    links: [...document.querySelectorAll('a[href]')]
      .slice(0, 50)
      .map(a => ({ text: (a as HTMLElement).innerText?.trim().slice(0, 100), href: (a as HTMLAnchorElement).href })),
    meta: {
      description: document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
      keywords:    document.querySelector('meta[name="keywords"]')?.getAttribute('content') || '',
    },
  }
  if (msg.includeHtml) result.html = (root as HTMLElement).innerHTML?.slice(0, 100000)
  return result
}

// ── Scroll ────────────────────────────────────────────────────────────────
function doScroll(msg: any) {
  const amount = Number(msg.amount || 400)
  switch (msg.direction) {
    case 'up':     window.scrollBy({ top: -amount, behavior: 'smooth' }); break
    case 'down':   window.scrollBy({ top: amount,  behavior: 'smooth' }); break
    case 'top':    window.scrollTo({ top: 0,                  behavior: 'smooth' }); break
    case 'bottom': window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); break
    default: throw new Error(`Unknown scroll direction: ${msg.direction}`)
  }
  return { success: true, direction: msg.direction, amount }
}

// ── Wait ──────────────────────────────────────────────────────────────────
async function doWait(msg: any) {
  if (msg.ms) {
    await new Promise(r => setTimeout(r, Math.min(Number(msg.ms), 10000)))
    return { success: true, waited_ms: msg.ms }
  }
  if (msg.selector) {
    const start = Date.now()
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Element "${msg.selector}" not found after 10s`)), 10000)
      function check() {
        if (document.querySelector(msg.selector)) { clearTimeout(timeout); resolve() }
        else requestAnimationFrame(check)
      }
      check()
    })
    return { success: true, selector: msg.selector, waited_ms: Date.now() - start }
  }
  return { success: true, waited_ms: 0 }
}

// ── Evaluate ──────────────────────────────────────────────────────────────
function doEvaluate(msg: any) {
  const code = String(msg.code || '')
  if (!code) throw new Error('code is required')
  // eslint-disable-next-line no-eval
  const result = (0, eval)(code)
  return { success: true, result: typeof result === 'function' ? '[Function]' : result }
}

// ── Extract ───────────────────────────────────────────────────────────────
function doExtract(msg: any) {
  const { selector, attributes, limit = 50 } = msg
  if (!selector) throw new Error('selector is required')
  const els = [...document.querySelectorAll(selector)].slice(0, limit)
  const items = els.map(el => {
    const item: any = { text: (el as HTMLElement).innerText?.trim().slice(0, 500) }
    const attrs: string[] = attributes || ['href', 'src', 'id', 'class', 'value', 'data-id', 'name']
    for (const attr of attrs) {
      const v = el.getAttribute(attr)
      if (v !== null) item[attr] = v
    }
    return item
  })
  return { success: true, selector, count: items.length, items }
}

// ── Find text ─────────────────────────────────────────────────────────────
function findText(msg: any) {
  const target = String(msg.text || '')
  if (!target) throw new Error('text is required')
  const exact   = !!msg.exact
  const walker  = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
  const found: any[] = []

  while (walker.nextNode() && found.length < 20) {
    const el = walker.currentNode as HTMLElement
    const inner = el.innerText?.trim() || ''
    const match = exact ? inner === target : inner.includes(target)
    if (match && inner.length > 0 && inner.length < 500) {
      found.push({
        tag:      el.tagName,
        text:     inner.slice(0, 200),
        selector: el.id ? `#${el.id}` : el.className ? `.${el.className.trim().split(' ')[0]}` : el.tagName.toLowerCase(),
      })
    }
  }
  return { success: true, query: target, count: found.length, elements: found }
}

// ── Fill form ─────────────────────────────────────────────────────────────
function fillForm(msg: any) {
  const fields: Array<{ selector: string; value: string }> = msg.fields || []
  const filled: string[] = []
  const errors: string[] = []

  for (const field of fields) {
    const el = document.querySelector(field.selector) as HTMLInputElement | null
    if (!el) { errors.push(`Not found: ${field.selector}`); continue }
    el.focus()
    el.value = field.value
    el.dispatchEvent(new Event('input',  { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    filled.push(field.selector)
  }

  if (msg.submitSelector) {
    const btn = document.querySelector(msg.submitSelector) as HTMLElement | null
    if (btn) btn.click()
  }

  return { success: errors.length === 0, filled, errors }
}

// ── Select dropdown ────────────────────────────────────────────────────────
function doSelect(msg: any) {
  const el = document.querySelector(msg.selector) as HTMLSelectElement | null
  if (!el || el.tagName !== 'SELECT') throw new Error(`<select> not found: ${msg.selector}`)

  const value = String(msg.value)
  // Try by value first, then by visible text
  const opt = [...el.options].find(o => o.value === value || o.text.trim() === value)
  if (!opt) throw new Error(`Option "${value}" not found in ${msg.selector}`)
  el.value = opt.value
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return { success: true, selector: msg.selector, selected: opt.text }
}

// ── Storage ────────────────────────────────────────────────────────────────
function storageGet(msg: any) {
  const store = msg.storageType === 'session' ? sessionStorage : localStorage
  const value = store.getItem(msg.key)
  return { success: true, key: msg.key, value, found: value !== null }
}

// ── Hover ─────────────────────────────────────────────────────────────────
function doHover(msg: any) {
  const el = document.querySelector(msg.selector) as HTMLElement | null
  if (!el) throw new Error(`Element not found: ${msg.selector}`)
  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
  return { success: true, selector: msg.selector }
}
