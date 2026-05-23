// content.ts — injected into every web page
// Handles DOM operations dispatched from the background service worker

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleAction(msg).then(sendResponse).catch(err => sendResponse({ error: err.message || String(err) }))
  return true  // keep message channel open for async response
})

async function handleAction(msg: any): Promise<any> {
  switch (msg.action) {
    case 'click':        return doClick(msg)
    case 'double_click': return doDoubleClick(msg)
    case 'right_click':  return doRightClick(msg)
    case 'drag':         return doDrag(msg)
    case 'press_key':    return doPressKey(msg)
    case 'find_popups':  return doFindPopups(msg)
    case 'close_popup':  return doClosePopup(msg)
    case 'page_info':    return doPageInfo()
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

// ── Simulated mouse visual effects ──────────────────────────────────────────
// Renders a virtual cursor that glides to the target before an AI click, emits a
// ripple at the click point, and shows a "grab & pull" feel while scrolling.
const FX = '__hs_mouse_fx__'
let fxEnabled = true
let fxCursor: HTMLElement | null = null
let fxX = 0
let fxY = 0
let fxHideTimer: any = null
const fxSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

try {
  chrome.storage?.local?.get('mouseFx').then((r: any) => {
    if (r && typeof r.mouseFx === 'boolean') fxEnabled = r.mouseFx
  }).catch(() => {})
  chrome.storage?.onChanged?.addListener((changes: any, area: string) => {
    if (area === 'local' && changes.mouseFx) fxEnabled = changes.mouseFx.newValue !== false
  })
} catch { /* storage may be unavailable */ }

function fxEnsure(): HTMLElement | null {
  if (!fxEnabled || !document.body) return null
  if (fxCursor && document.documentElement.contains(fxCursor)) return fxCursor

  if (!document.getElementById(FX + '_style')) {
    const style = document.createElement('style')
    style.id = FX + '_style'
    style.textContent = `
      .${FX}-cur{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;opacity:0;
        transition:transform .3s cubic-bezier(.22,1,.36,1),opacity .2s ease;will-change:transform;}
      .${FX}-cur.show{opacity:1;}
      .${FX}-cur-in{display:block;transform:scale(1);transition:transform .13s ease;
        filter:drop-shadow(0 2px 3px rgba(0,0,0,.45));}
      .${FX}-cur.press .${FX}-cur-in{transform:scale(.72);}
      .${FX}-cur.grab .${FX}-cur-in{transform:scale(.88) rotate(-12deg);}
      .${FX}-cur.noanim{transition:none;}
      .${FX}-ring,.${FX}-dot,.${FX}-trail{position:fixed;left:0;top:0;z-index:2147483646;pointer-events:none;}
      .${FX}-ring{width:16px;height:16px;border-radius:50%;border:2px solid rgba(99,102,241,.9);
        transform:translate(-50%,-50%) scale(.4);opacity:.9;animation:${FX}-ring .62s ease-out forwards;}
      @keyframes ${FX}-ring{to{transform:translate(-50%,-50%) scale(3.4);opacity:0;}}
      .${FX}-dot{width:10px;height:10px;border-radius:50%;background:rgba(99,102,241,.55);
        transform:translate(-50%,-50%) scale(1);opacity:.85;animation:${FX}-dot .46s ease-out forwards;}
      @keyframes ${FX}-dot{to{transform:translate(-50%,-50%) scale(2.6);opacity:0;}}
      .${FX}-trail{width:4px;border-radius:4px;transform:translateX(-50%);opacity:0;
        background:linear-gradient(rgba(99,102,241,0),rgba(99,102,241,.55),rgba(99,102,241,0));
        animation:${FX}-trail .5s ease-out forwards;}
      .${FX}-line{height:3px;border-radius:3px;transform-origin:0 50%;opacity:0;
        background:linear-gradient(90deg,rgba(99,102,241,.15),rgba(99,102,241,.7));
        animation:${FX}-trail .7s ease-out forwards;}
      @keyframes ${FX}-trail{0%{opacity:.7;}100%{opacity:0;}}`
    document.documentElement.appendChild(style)
  }

  const cur = document.createElement('div')
  cur.className = `${FX}-cur noanim`
  cur.innerHTML = `<span class="${FX}-cur-in"><svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M4 2.2 L4 19.6 L8.7 15.2 L11.8 21.9 L14.4 20.7 L11.3 14.1 L17.8 13.9 Z" fill="#fff" stroke="#111827" stroke-width="1.2" stroke-linejoin="round"/></svg></span>`
  document.body.appendChild(cur)
  fxCursor = cur
  if (!fxX && !fxY) { fxX = window.innerWidth / 2; fxY = window.innerHeight / 2 }
  fxPlace(fxX, fxY, false)
  return cur
}

function fxPlace(x: number, y: number, animate: boolean) {
  const cur = fxCursor
  if (!cur) return
  fxX = x; fxY = y
  cur.classList.toggle('noanim', !animate)
  // -3,-2 aligns the SVG arrow tip with the target point.
  cur.style.transform = `translate(${x - 3}px, ${y - 2}px)`
}

function fxScheduleHide() {
  if (fxHideTimer) clearTimeout(fxHideTimer)
  fxHideTimer = setTimeout(() => fxCursor?.classList.remove('show'), 1600)
}

function fxSpawn(cls: string, x: number, y: number, life = 700, extra?: (el: HTMLElement) => void) {
  if (!document.body) return
  const el = document.createElement('div')
  el.className = `${FX}-${cls}`
  el.style.left = `${x}px`
  el.style.top = `${y}px`
  extra?.(el)
  document.body.appendChild(el)
  setTimeout(() => el.remove(), life)
}

async function fxMoveTo(x: number, y: number) {
  const cur = fxEnsure()
  if (!cur) return
  cur.classList.add('show')
  // force reflow so the first move animates from the resting position
  void cur.offsetWidth
  fxPlace(x, y, true)
  await fxSleep(300)
}

function fxClickAt(x: number, y: number, variant: 'left' | 'right' | 'double' = 'left') {
  const cur = fxEnsure()
  if (!cur) return
  cur.classList.add('press')
  const ringColor = variant === 'right' ? 'rgba(245,158,11,.95)' : 'rgba(99,102,241,.9)'
  const dotColor  = variant === 'right' ? 'rgba(245,158,11,.55)' : 'rgba(99,102,241,.55)'
  fxSpawn('ring', x, y, 640, el => { el.style.borderColor = ringColor })
  fxSpawn('dot', x, y, 480, el => { el.style.background = dotColor })
  if (variant === 'double') setTimeout(() => fxSpawn('ring', x, y, 640), 150)
  setTimeout(() => cur.classList.remove('press'), 160)
  fxScheduleHide()
}

async function fxDragPath(sx: number, sy: number, ex: number, ey: number) {
  const cur = fxEnsure()
  if (!cur) return
  cur.classList.add('show')
  fxPlace(sx, sy, false)
  void cur.offsetWidth
  cur.classList.add('grab', 'press')
  const dx = ex - sx, dy = ey - sy
  const dist = Math.hypot(dx, dy)
  const ang = Math.atan2(dy, dx) * 180 / Math.PI
  fxSpawn('line', sx, sy, 720, el => { el.style.width = `${dist}px`; el.style.transform = `rotate(${ang}deg)` })
  fxSpawn('ring', sx, sy, 600)
  await fxMoveTo(ex, ey)
  fxSpawn('ring', ex, ey, 600)
  setTimeout(() => cur.classList.remove('grab', 'press'), 200)
  fxScheduleHide()
}

async function fxToElement(el: Element) {
  if (!fxEnabled) return
  const r = (el as HTMLElement).getBoundingClientRect()
  const x = Math.min(Math.max(r.left + r.width / 2, 4), window.innerWidth - 4)
  const y = Math.min(Math.max(r.top + r.height / 2, 4), window.innerHeight - 4)
  await fxMoveTo(x, y)
}

function fxScrollDrag(direction: string, amount: number) {
  const cur = fxEnsure()
  if (!cur) return
  const cx = window.innerWidth / 2
  const cy = window.innerHeight / 2
  const len = Math.min(Math.max(amount || 0, 80), 220)
  // Pulling feel: grab the page and drag opposite to the content motion.
  let startY = cy, endY = cy
  if (direction === 'down')        { startY = cy + len / 2; endY = cy - len / 2 }
  else if (direction === 'up')     { startY = cy - len / 2; endY = cy + len / 2 }
  else if (direction === 'bottom') { startY = cy + 110;     endY = cy - 110 }
  else if (direction === 'top')    { startY = cy - 110;     endY = cy + 110 }

  cur.classList.add('show')
  fxPlace(cx, startY, false)
  void cur.offsetWidth
  cur.classList.add('grab', 'press')
  fxSpawn('trail', cx, Math.min(startY, endY), 540, el => { el.style.height = `${Math.abs(endY - startY)}px` })
  fxPlace(cx, endY, true)
  setTimeout(() => cur.classList.remove('grab', 'press'), 320)
  fxScheduleHide()
}

// ── DOM helpers ───────────────────────────────────────────────────────────
const POPUP_SELECTOR = [
  'dialog[open]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[aria-modal="true"]',
  '[class*="modal" i]',
  '[class*="dialog" i]',
  '[class*="popup" i]',
  '[class*="popover" i]',
  '[class*="drawer" i]',
  '[class*="toast" i]',
  '[class*="overlay" i]',
  '[class*="ant-modal" i]',
  '[class*="el-dialog" i]',
  '[class*="MuiDialog" i]',
  '[class*="van-popup" i]',
].join(',')

const CLOSE_SELECTOR = [
  'button[aria-label*="close" i]',
  'button[aria-label*="关闭" i]',
  '[role="button"][aria-label*="close" i]',
  '[role="button"][aria-label*="关闭" i]',
  'button[title*="close" i]',
  'button[title*="关闭" i]',
  '[data-dismiss]',
  '[data-bs-dismiss]',
  '[data-testid*="close" i]',
  '[class*="close" i]',
  '[class*="cancel" i]',
  '.ant-modal-close',
  '.el-dialog__headerbtn',
  '.MuiDialog-root button[aria-label]',
  '.btn-close',
].join(',')

const CLOSE_TEXTS = [
  '关闭', '关 闭', '取消', '稍后', '稍后再说', '我知道了', '知道了', '确定', '确认',
  '不再提示', '跳过', '关闭弹窗', 'Close', 'Cancel', 'OK', 'Ok', 'Got it', 'Dismiss',
  '×', 'x', 'X',
]

function isVisible(el: Element | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false
  if (el.id?.startsWith(FX)) return false
  const s = getComputedStyle(el)
  if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 && r.bottom >= 0 && r.right >= 0 && r.top <= window.innerHeight && r.left <= window.innerWidth
}

function textOf(el: Element, max = 200): string {
  const h = el as HTMLElement
  const parts = [
    h.innerText,
    h.getAttribute('aria-label'),
    h.getAttribute('title'),
    (h as HTMLInputElement).value,
    h.textContent,
  ]
  return parts.map(v => String(v || '').replace(/\s+/g, ' ').trim()).find(Boolean)?.slice(0, max) || ''
}

function cssPath(el: Element): string {
  if ((el as HTMLElement).id) return `#${CSS.escape((el as HTMLElement).id)}`
  const parts: string[] = []
  let cur: Element | null = el
  while (cur && cur !== document.body && parts.length < 5) {
    const tag = cur.tagName.toLowerCase()
    const cls = String((cur as HTMLElement).className || '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(c => `.${CSS.escape(c)}`)
      .join('')
    const parent = cur.parentElement
    const same = parent ? Array.from(parent.children).filter(c => c.tagName === cur!.tagName) : []
    const nth = same.length > 1 && parent ? `:nth-of-type(${same.indexOf(cur) + 1})` : ''
    parts.unshift(`${tag}${cls}${nth}`)
    cur = parent
  }
  return parts.length ? parts.join(' > ') : el.tagName.toLowerCase()
}

function zIndexOf(el: Element): number {
  const z = Number.parseInt(getComputedStyle(el).zIndex || '0', 10)
  return Number.isFinite(z) ? z : 0
}

function elementArea(el: Element): number {
  const r = (el as HTMLElement).getBoundingClientRect()
  return Math.max(0, r.width) * Math.max(0, r.height)
}

function clickableAncestor(el: Element): Element {
  return el.closest('button,a,[role="button"],input[type="button"],input[type="submit"],[onclick],[tabindex]') || el
}

function textMatches(el: HTMLElement, text: string, exact = false): boolean {
  const target = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase()
  if (!target) return false
  const haystack = [
    el.innerText,
    el.textContent,
    el.getAttribute('aria-label'),
    el.getAttribute('title'),
    (el as HTMLInputElement).value,
    el.getAttribute('placeholder'),
  ].map(v => String(v || '').replace(/\s+/g, ' ').trim().toLowerCase()).filter(Boolean)
  return haystack.some(v => exact ? v === target : (v === target || v.includes(target)))
}

function findEl(selector?: string, text?: string): Element | null {
  if (selector) {
    const bySelector = document.querySelector(selector)
    if (bySelector && isVisible(bySelector)) return bySelector
    return bySelector
  }
  if (text) {
    const preferred = Array.from(document.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"],[aria-label],[title]')) as HTMLElement[]
    const exact = preferred.find(el => isVisible(el) && textMatches(el, text, true))
    if (exact) return exact
    const partial = preferred.find(el => isVisible(el) && textMatches(el, text, false))
    if (partial) return partial

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
    while (walker.nextNode()) {
      const el = walker.currentNode as HTMLElement
      if (isVisible(el) && textMatches(el, text, true)) return clickableAncestor(el)
    }
    const walker2 = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
    while (walker2.nextNode()) {
      const el = walker2.currentNode as HTMLElement
      if (isVisible(el) && textMatches(el, text, false)) return clickableAncestor(el)
    }
  }
  return null
}

function clickLikeUser(el: Element) {
  const c = elCenter(el)
  const opts = { bubbles: true, cancelable: true, view: window, clientX: c.x, clientY: c.y } as MouseEventInit
  el.dispatchEvent(new PointerEvent('pointerdown', opts))
  el.dispatchEvent(new MouseEvent('mousedown', opts))
  el.dispatchEvent(new PointerEvent('pointerup', opts))
  el.dispatchEvent(new MouseEvent('mouseup', opts))
  el.dispatchEvent(new MouseEvent('click', opts))
  ;(el as HTMLElement).click?.()
}

function elCenter(el: Element): { x: number; y: number } {
  const r = (el as HTMLElement).getBoundingClientRect()
  return {
    x: Math.min(Math.max(r.left + r.width / 2, 1), window.innerWidth - 1),
    y: Math.min(Math.max(r.top + r.height / 2, 1), window.innerHeight - 1),
  }
}

// Resolve a target from selector / text / explicit coords.
function resolveTarget(msg: { selector?: string; text?: string; x?: number; y?: number }): { el: Element | null; x: number; y: number } {
  if (msg.x !== undefined && msg.y !== undefined) {
    const el = document.elementFromPoint(Number(msg.x), Number(msg.y))
    return { el, x: Number(msg.x), y: Number(msg.y) }
  }
  const el = findEl(msg.selector, msg.text)
  if (!el) return { el: null, x: 0, y: 0 }
  const c = elCenter(el)
  return { el, x: c.x, y: c.y }
}

// ── Viewport / page position context ─────────────────────────────────────────
function viewportContext() {
  const doc = document.documentElement
  const scrollY = Math.round(window.scrollY)
  const scrollX = Math.round(window.scrollX)
  const innerH = window.innerHeight
  const innerW = window.innerWidth
  const scrollHeight = Math.max(doc.scrollHeight, document.body ? document.body.scrollHeight : 0)
  const maxScroll = Math.max(0, scrollHeight - innerH)
  const scrollPercent = maxScroll > 0 ? Math.round((scrollY / maxScroll) * 100) : 100
  const atTop = scrollY <= 2
  const atBottom = scrollY >= maxScroll - 2

  const heads = Array.from(document.querySelectorAll('h1,h2,h3,h4')) as HTMLElement[]
  const visibleHeadings: Array<{ tag: string; text: string; top: number }> = []
  let currentSection = ''
  for (const h of heads) {
    const r = h.getBoundingClientRect()
    const txt = (h.innerText || '').trim().slice(0, 120)
    if (!txt) continue
    if (r.top <= 90) currentSection = txt           // last heading at/above the fold
    if (r.bottom > 0 && r.top < innerH && visibleHeadings.length < 10) {
      visibleHeadings.push({ tag: h.tagName, text: txt, top: Math.round(r.top) })
    }
  }

  return {
    url: location.href,
    title: document.title,
    scrollX, scrollY,
    innerWidth: innerW,
    innerHeight: innerH,
    scrollHeight,
    maxScroll,
    scrollPercent,
    atTop,
    atBottom,
    currentSection,
    visibleHeadings,
    counts: {
      links: document.querySelectorAll('a[href]').length,
      buttons: document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]').length,
      inputs: document.querySelectorAll('input, textarea, select').length,
    },
  }
}

async function waitScrollSettle(timeout = 900): Promise<void> {
  const start = Date.now()
  let last = window.scrollY
  let stable = 0
  while (Date.now() - start < timeout) {
    await fxSleep(80)
    if (Math.abs(window.scrollY - last) < 1) { if (++stable >= 2) break }
    else stable = 0
    last = window.scrollY
  }
}

function doPageInfo() {
  return { success: true, ...viewportContext() }
}

// ── Click ─────────────────────────────────────────────────────────────────
async function doClick(msg: any) {
  const { selector, text, x, y } = msg
  let el: Element | null = null

  if (x !== undefined && y !== undefined) {
    el = document.elementFromPoint(Number(x), Number(y))
  } else {
    el = findEl(selector, text)
  }

  if (!el) throw new Error(`Element not found: selector=${selector || ''} text=${text || ''} coords=${x},${y}`)
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  if (fxEnabled) {
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
async function doDoubleClick(msg: any) {
  const { el, x, y } = resolveTarget(msg)
  if (!el) throw new Error(`Element not found: selector=${msg.selector || ''} text=${msg.text || ''} coords=${msg.x},${msg.y}`)
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  if (fxEnabled) { await fxSleep(220); await fxToElement(el); const c = elCenter(el); fxClickAt(c.x, c.y, 'double'); await fxSleep(120) }
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
async function doRightClick(msg: any) {
  const { el, x, y } = resolveTarget(msg)
  if (!el) throw new Error(`Element not found: selector=${msg.selector || ''} text=${msg.text || ''} coords=${msg.x},${msg.y}`)
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  if (fxEnabled) { await fxSleep(220); await fxToElement(el); const c = elCenter(el); fxClickAt(c.x, c.y, 'right'); await fxSleep(120) }
  const c = elCenter(el)
  const opts = { bubbles: true, cancelable: true, view: window, button: 2, buttons: 2, clientX: c.x, clientY: c.y } as MouseEventInit
  el.dispatchEvent(new MouseEvent('mousedown', opts))
  el.dispatchEvent(new MouseEvent('mouseup', opts))
  el.dispatchEvent(new MouseEvent('contextmenu', opts))
  return { success: true, tag: el.tagName, text: (el as HTMLElement).innerText?.slice(0, 100) }
}

// ── Drag and drop ─────────────────────────────────────────────────────────────
async function doDrag(msg: any) {
  const src = resolveTarget({ selector: msg.selector, text: msg.text, x: msg.x, y: msg.y })
  const dst = resolveTarget({ selector: msg.toSelector, text: msg.toText, x: msg.toX, y: msg.toY })
  if (!src.el && (msg.x === undefined)) throw new Error('Drag source not found')
  if (!dst.el && (msg.toX === undefined)) throw new Error('Drag target not found')
  if (src.el) src.el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  if (fxEnabled) await fxSleep(200)
  const s = src.el ? elCenter(src.el) : { x: src.x, y: src.y }
  const d = dst.el ? elCenter(dst.el) : { x: dst.x, y: dst.y }
  if (fxEnabled) await fxDragPath(s.x, s.y, d.x, d.y)

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
function doPressKey(msg: any) {
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

// ── Popups / dialogs ─────────────────────────────────────────────────────
function isLikelyPopup(el: Element): boolean {
  if (!isVisible(el) || el === document.body || el === document.documentElement) return false
  const h = el as HTMLElement
  const tag = h.tagName.toLowerCase()
  const role = h.getAttribute('role')
  const cls = String(h.className || '').toLowerCase()
  const explicit = tag === 'dialog'
    || role === 'dialog'
    || role === 'alertdialog'
    || h.getAttribute('aria-modal') === 'true'
    || /(modal|dialog|popup|popover|drawer|toast|overlay|ant-modal|el-dialog|muidialog|van-popup)/i.test(cls)
  if (explicit) return true

  const s = getComputedStyle(h)
  if (!['fixed', 'sticky'].includes(s.position)) return false
  const z = zIndexOf(h)
  const r = h.getBoundingClientRect()
  const viewportArea = Math.max(1, window.innerWidth * window.innerHeight)
  const areaRatio = (r.width * r.height) / viewportArea
  const coversCenter = r.left <= window.innerWidth / 2 && r.right >= window.innerWidth / 2
    && r.top <= window.innerHeight / 2 && r.bottom >= window.innerHeight / 2
  const hasClose = findCloseCandidates(h, 1).length > 0
  return z >= 10 && (hasClose || coversCenter || areaRatio >= 0.12)
}

function findCloseCandidates(root: Element, limit = 12): Element[] {
  const candidates: Element[] = []
  const seen = new Set<Element>()
  const add = (el: Element | null) => {
    if (!el || seen.has(el) || !isVisible(el)) return
    const clickable = clickableAncestor(el)
    if (!isVisible(clickable) || seen.has(clickable)) return
    seen.add(clickable)
    candidates.push(clickable)
  }

  root.querySelectorAll(CLOSE_SELECTOR).forEach(add)
  const clickable = root.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"],[aria-label],[title]')
  clickable.forEach(el => {
    const txt = textOf(el, 80)
    const cls = String((el as HTMLElement).className || '').toLowerCase()
    const labelledClose = /(close|cancel|dismiss)/.test(cls) || /关闭|取消/.test(txt)
    if (labelledClose || CLOSE_TEXTS.some(t => txt.toLowerCase() === t.toLowerCase())) add(el)
  })

  return candidates
    .sort((a, b) => {
      const ta = textOf(a, 80)
      const tb = textOf(b, 80)
      const score = (t: string) => {
        if (/^(×|x)$/i.test(t)) return 0
        if (/关闭|close/i.test(t)) return 1
        if (/取消|cancel|dismiss|稍后|知道了|ok/i.test(t)) return 2
        return 3
      }
      return score(ta) - score(tb)
    })
    .slice(0, limit)
}

function collectPopupElements(): Element[] {
  const raw = new Set<Element>()
  document.querySelectorAll(POPUP_SELECTOR).forEach(el => raw.add(el))
  document.querySelectorAll('body *').forEach(el => {
    if (isLikelyPopup(el)) raw.add(el)
  })

  const popups = Array.from(raw)
    .filter(isLikelyPopup)
    .sort((a, b) => {
      const z = zIndexOf(b) - zIndexOf(a)
      if (z !== 0) return z
      return elementArea(a) - elementArea(b)
    })

  const out: Element[] = []
  for (const el of popups) {
    if (out.some(existing => existing === el || (existing.contains(el) && findCloseCandidates(existing, 1).length > 0))) continue
    out.push(el)
  }
  return out.slice(0, 10)
}

function popupInfo(el: Element, index: number) {
  const r = (el as HTMLElement).getBoundingClientRect()
  const closes = findCloseCandidates(el, 6)
  return {
    index,
    selector: cssPath(el),
    tag: el.tagName,
    role: el.getAttribute('role') || '',
    ariaModal: el.getAttribute('aria-modal') || '',
    zIndex: zIndexOf(el),
    rect: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
    text: textOf(el, 260),
    closeCandidates: closes.map(c => ({ selector: cssPath(c), text: textOf(c, 80), tag: c.tagName })),
  }
}

function doFindPopups(msg: any) {
  const limit = Math.max(1, Math.min(Number(msg.limit || 10), 20))
  const popups = collectPopupElements().slice(0, limit).map(popupInfo)
  return { success: true, count: popups.length, popups }
}

async function doClosePopup(msg: any) {
  const strategy = String(msg.strategy || 'auto')
  const before = collectPopupElements()
  let target: Element | null = null
  if (msg.selector) target = document.querySelector(String(msg.selector))
  if (!target && msg.text) {
    const needle = String(msg.text)
    target = before.find(el => textOf(el, 1000).includes(needle)) || null
  }
  if (!target) target = before[Math.max(0, Number(msg.index || 0))] || null
  if (!target) return { success: false, closed: false, reason: 'no_popup_found', beforeCount: 0, afterCount: 0 }

  const beforeSelector = cssPath(target)
  const tryCloseButton = async () => {
    const candidates = findCloseCandidates(target!, 8)
    const btn = candidates[0]
    if (!btn) return false
    if (fxEnabled) { await fxToElement(btn); const c = elCenter(btn); fxClickAt(c.x, c.y); await fxSleep(80) }
    clickLikeUser(btn)
    return true
  }
  const pressEscape = () => {
    const init: KeyboardEventInit = { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', init))
    document.dispatchEvent(new KeyboardEvent('keydown', init))
    document.dispatchEvent(new KeyboardEvent('keyup', init))
  }
  const clickBackdrop = () => {
    const r = (target as HTMLElement).getBoundingClientRect()
    const points = [
      { x: Math.max(2, r.left + 8), y: Math.max(2, r.top + 8) },
      { x: Math.min(window.innerWidth - 2, r.right - 8), y: Math.max(2, r.top + 8) },
      { x: window.innerWidth / 2, y: Math.min(window.innerHeight - 2, r.bottom - 8) },
    ]
    const pt = points.find(p => {
      const hit = document.elementFromPoint(p.x, p.y)
      return hit === target || (!!hit && target!.contains(hit))
    }) || points[0]
    const hit = document.elementFromPoint(pt.x, pt.y) || target!
    hit.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, clientX: pt.x, clientY: pt.y }))
    hit.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, clientX: pt.x, clientY: pt.y }))
    hit.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: pt.x, clientY: pt.y }))
  }
  const targetGone = () => !document.documentElement.contains(target!) || !isVisible(target)

  let method = ''
  if (strategy === 'close_button' || strategy === 'auto') {
    if (await tryCloseButton()) method = 'close_button'
    else if (strategy === 'close_button') throw new Error('No close button found in popup')
  }
  if (!method && (strategy === 'escape' || strategy === 'auto')) {
    pressEscape()
    method = 'escape'
  }
  await fxSleep(260)
  if (!targetGone() && (strategy === 'backdrop' || strategy === 'auto')) {
    clickBackdrop()
    method = method ? `${method}+backdrop` : 'backdrop'
    await fxSleep(260)
  }
  if (!targetGone() && msg.force_remove === true) {
    ;(target as HTMLElement).remove()
    method = method ? `${method}+force_remove` : 'force_remove'
    await fxSleep(60)
  }

  const after = collectPopupElements()
  return {
    success: targetGone() || after.length < before.length,
    closed: targetGone() || after.length < before.length,
    reason: targetGone() || after.length < before.length ? '' : 'popup_still_visible',
    method: method || 'none',
    selector: beforeSelector,
    beforeCount: before.length,
    afterCount: after.length,
    remainingPopups: after.map(popupInfo),
  }
}

// ── Type ──────────────────────────────────────────────────────────────────
async function doType(msg: any) {
  const selector   = msg.selector || 'input:focus, textarea:focus, [contenteditable]:focus'
  const text       = String(msg.text ?? '')
  const clearFirst = msg.clearFirst !== false

  let el = selector ? document.querySelector(selector) as HTMLInputElement | null : null
  if (!el) el = document.activeElement as HTMLInputElement | null

  if (!el) throw new Error('No input element found — try providing a selector')

  if (fxEnabled) { await fxToElement(el); fxClickAt(fxX, fxY) }
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
async function doScroll(msg: any) {
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
  const opt = Array.from(el.options).find(o => o.value === value || o.text.trim() === value)
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
async function doHover(msg: any) {
  const el = document.querySelector(msg.selector) as HTMLElement | null
  if (!el) throw new Error(`Element not found: ${msg.selector}`)
  if (fxEnabled) await fxToElement(el)
  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
  return { success: true, selector: msg.selector }
}
