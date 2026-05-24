// content/actions.ts — page-action handlers (click, type, scroll, …).
// Each function is invoked by content/index.ts in response to a chrome.runtime
// message from the background worker, and returns the JSON that browser.ts
// forwards back to the AI / popup.

import { findEl, resolveTarget, elCenter } from './dom'
import { fxToElement, fxClickAt, fxSleep, fxDragPath, fxScrollDrag, isFxEnabled, getFxPos } from './fx'
import { viewportContext, waitScrollSettle } from './viewport'

// ── Click ─────────────────────────────────────────────────────────────────
export async function doClick(msg: any) {
  const { selector, text, x, y } = msg
  let el: Element | null = null

  if (x !== undefined && y !== undefined) {
    el = document.elementFromPoint(Number(x), Number(y))
  } else {
    el = findEl(selector, text)
  }

  if (!el) throw new Error(`Element not found: selector=${selector || ''} text=${text || ''} coords=${x},${y}`)
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  if (isFxEnabled()) {
    await fxSleep(220)            // let the smooth scroll settle before aiming
    await fxToElement(el)         // glide the virtual cursor to the element
    const r = (el as HTMLElement).getBoundingClientRect()
    fxClickAt(r.left + r.width / 2, r.top + r.height / 2)
    await fxSleep(120)            // brief press beat before the real click
  }
  ;(el as HTMLElement).click()
  const ctx = viewportContext()
  return {
    success: true,
    tag: el.tagName,
    text: (el as HTMLElement).innerText?.slice(0, 100),
    position: { scrollY: ctx.scrollY, scrollPercent: ctx.scrollPercent, currentSection: ctx.currentSection },
  }
}

// ── Double click ────────────────────────────────────────────────────────────
export async function doDoubleClick(msg: any) {
  const { el } = resolveTarget(msg)
  if (!el) throw new Error(`Element not found: selector=${msg.selector || ''} text=${msg.text || ''} coords=${msg.x},${msg.y}`)
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  if (isFxEnabled()) { await fxSleep(220); await fxToElement(el); const c = elCenter(el); fxClickAt(c.x, c.y, 'double'); await fxSleep(120) }
  const c = elCenter(el)
  const opts = { bubbles: true, cancelable: true, view: window, clientX: c.x, clientY: c.y } as MouseEventInit
  el.dispatchEvent(new MouseEvent('mousedown', opts))
  el.dispatchEvent(new MouseEvent('mouseup', opts))
  el.dispatchEvent(new MouseEvent('click', { ...opts, detail: 1 }))
  el.dispatchEvent(new MouseEvent('mousedown', opts))
  el.dispatchEvent(new MouseEvent('mouseup', opts))
  el.dispatchEvent(new MouseEvent('click', { ...opts, detail: 2 }))
  el.dispatchEvent(new MouseEvent('dblclick', { ...opts, detail: 2 }))
  return { success: true, tag: el.tagName, text: (el as HTMLElement).innerText?.slice(0, 100) }
}

// ── Right click (context menu) ────────────────────────────────────────────────
export async function doRightClick(msg: any) {
  const { el } = resolveTarget(msg)
  if (!el) throw new Error(`Element not found: selector=${msg.selector || ''} text=${msg.text || ''} coords=${msg.x},${msg.y}`)
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  if (isFxEnabled()) { await fxSleep(220); await fxToElement(el); const c = elCenter(el); fxClickAt(c.x, c.y, 'right'); await fxSleep(120) }
  const c = elCenter(el)
  const opts = { bubbles: true, cancelable: true, view: window, button: 2, buttons: 2, clientX: c.x, clientY: c.y } as MouseEventInit
  el.dispatchEvent(new MouseEvent('mousedown', opts))
  el.dispatchEvent(new MouseEvent('mouseup', opts))
  el.dispatchEvent(new MouseEvent('contextmenu', opts))
  return { success: true, tag: el.tagName, text: (el as HTMLElement).innerText?.slice(0, 100) }
}

// ── Drag and drop ─────────────────────────────────────────────────────────────
export async function doDrag(msg: any) {
  const src = resolveTarget({ selector: msg.selector, text: msg.text, x: msg.x, y: msg.y })
  const dst = resolveTarget({ selector: msg.toSelector, text: msg.toText, x: msg.toX, y: msg.toY })
  if (!src.el && (msg.x === undefined)) throw new Error('Drag source not found')
  if (!dst.el && (msg.toX === undefined)) throw new Error('Drag target not found')
  if (src.el) src.el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  if (isFxEnabled()) await fxSleep(200)
  const s = src.el ? elCenter(src.el) : { x: src.x, y: src.y }
  const d = dst.el ? elCenter(dst.el) : { x: dst.x, y: dst.y }
  if (isFxEnabled()) await fxDragPath(s.x, s.y, d.x, d.y)

  const dt = (() => { try { return new DataTransfer() } catch { return null } })()
  const mk = (type: string, x: number, y: number, target: Element | null) => {
    if (!target) return
    const init: any = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 }
    if (dt) init.dataTransfer = dt
    const ev = (type.startsWith('drag') || type === 'drop')
      ? new DragEvent(type, init)
      : new MouseEvent(type, init)
    target.dispatchEvent(ev)
  }
  // Pointer/mouse sequence (for libraries using mouse events)
  mk('pointerdown', s.x, s.y, src.el)
  mk('mousedown', s.x, s.y, src.el)
  // HTML5 native drag-and-drop sequence
  mk('dragstart', s.x, s.y, src.el)
  mk('drag', s.x, s.y, src.el)
  mk('mousemove', d.x, d.y, dst.el || src.el)
  mk('dragenter', d.x, d.y, dst.el)
  mk('dragover', d.x, d.y, dst.el)
  mk('drop', d.x, d.y, dst.el)
  mk('dragend', d.x, d.y, src.el)
  mk('pointerup', d.x, d.y, dst.el || src.el)
  mk('mouseup', d.x, d.y, dst.el || src.el)
  return { success: true, from: { x: Math.round(s.x), y: Math.round(s.y) }, to: { x: Math.round(d.x), y: Math.round(d.y) } }
}

// ── Press key ─────────────────────────────────────────────────────────────────
export function doPressKey(msg: any) {
  const key = String(msg.key || '')
  if (!key) throw new Error('key is required')
  let el: Element | null = msg.selector ? document.querySelector(msg.selector) : null
  if (!el) el = (document.activeElement && document.activeElement !== document.body) ? document.activeElement : document.body
  ;(el as HTMLElement).focus?.()
  const init: KeyboardEventInit = {
    key,
    code: /^[a-zA-Z]$/.test(key) ? `Key${key.toUpperCase()}` : key,
    bubbles: true,
    cancelable: true,
    ctrlKey: !!msg.ctrl,
    shiftKey: !!msg.shift,
    altKey: !!msg.alt,
    metaKey: !!msg.meta,
  }
  el!.dispatchEvent(new KeyboardEvent('keydown', init))
  el!.dispatchEvent(new KeyboardEvent('keypress', init))
  el!.dispatchEvent(new KeyboardEvent('keyup', init))
  return { success: true, key, target: (el as HTMLElement).tagName }
}

// ── Type ──────────────────────────────────────────────────────────────────
export async function doType(msg: any) {
  const selector   = msg.selector || 'input:focus, textarea:focus, [contenteditable]:focus'
  const text       = String(msg.text ?? '')
  const clearFirst = msg.clearFirst !== false

  let el = selector ? document.querySelector(selector) as HTMLInputElement | null : null
  if (!el) el = document.activeElement as HTMLInputElement | null

  if (!el) throw new Error('No input element found — try providing a selector')

  if (isFxEnabled()) { await fxToElement(el); const p = getFxPos(); fxClickAt(p.x, p.y) }
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
export function getContent(msg: any) {
  const root = msg.selector ? document.querySelector(msg.selector) : document.body
  if (!root) throw new Error(`Element not found: ${msg.selector}`)

  const text = (root as HTMLElement).innerText?.slice(0, 50000) || ''
  const result: any = {
    success: true,
    url:   location.href,
    title: document.title,
    text,
    links: Array.from(document.querySelectorAll('a[href]'))
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
export async function doScroll(msg: any) {
  const amount = Number(msg.amount || 400)
  const beforeY = Math.round(window.scrollY)

  if (msg.selector) {
    const el = document.querySelector(msg.selector)
    if (!el) throw new Error(`Element not found: ${msg.selector}`)
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  } else {
    switch (msg.direction) {
      case 'up':     window.scrollBy({ top: -amount, behavior: 'smooth' }); break
      case 'down':   window.scrollBy({ top: amount,  behavior: 'smooth' }); break
      case 'top':    window.scrollTo({ top: 0,                  behavior: 'smooth' }); break
      case 'bottom': window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); break
      default: throw new Error(`Unknown scroll direction: ${msg.direction}`)
    }
  }
  fxScrollDrag(msg.direction, amount)   // visual "grab & pull" feedback
  await waitScrollSettle()
  const ctx = viewportContext()
  const scrolledBy = ctx.scrollY - beforeY
  return {
    success: true,
    direction: msg.direction,
    requestedAmount: amount,
    scrolledBy,                          // actual pixels moved (0 = nothing happened)
    reachedEdge: ctx.atTop ? 'top' : (ctx.atBottom ? 'bottom' : null),
    ...ctx,
  }
}

// ── Wait ──────────────────────────────────────────────────────────────────
export async function doWait(msg: any) {
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
export function doEvaluate(msg: any) {
  const code = String(msg.code || '')
  if (!code) throw new Error('code is required')
  // eslint-disable-next-line no-eval
  const result = (0, eval)(code)
  return { success: true, result: typeof result === 'function' ? '[Function]' : result }
}

// ── Extract ───────────────────────────────────────────────────────────────
export function doExtract(msg: any) {
  const { selector, attributes, limit = 50 } = msg
  if (!selector) throw new Error('selector is required')
  const els = Array.from(document.querySelectorAll(selector)).slice(0, limit)
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
export function findText(msg: any) {
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
export function fillForm(msg: any) {
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
export function doSelect(msg: any) {
  const el = document.querySelector(msg.selector) as HTMLSelectElement | null
  if (!el || el.tagName !== 'SELECT') throw new Error(`<select> not found: ${msg.selector}`)

  const value = String(msg.value)
  // Try by value first, then by visible text
  const opt = Array.from(el.options).find(o => o.value === value || o.text.trim() === value)
  if (!opt) throw new Error(`Option "${value}" not found in ${msg.selector}`)
  el.value = opt.value
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return { success: true, selector: msg.selector, selected: opt.text }
}

// ── Storage ────────────────────────────────────────────────────────────────
export function storageGet(msg: any) {
  const store = msg.storageType === 'session' ? sessionStorage : localStorage
  const value = store.getItem(msg.key)
  return { success: true, key: msg.key, value, found: value !== null }
}

// ── Hover ─────────────────────────────────────────────────────────────────
export async function doHover(msg: any) {
  const el = document.querySelector(msg.selector) as HTMLElement | null
  if (!el) throw new Error(`Element not found: ${msg.selector}`)
  if (isFxEnabled()) await fxToElement(el)
  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
  return { success: true, selector: msg.selector }
}
