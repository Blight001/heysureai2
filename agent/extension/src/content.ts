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

function fxClickAt(x: number, y: number) {
  const cur = fxEnsure()
  if (!cur) return
  cur.classList.add('press')
  fxSpawn('ring', x, y, 640)
  fxSpawn('dot', x, y, 480)
  setTimeout(() => cur.classList.remove('press'), 160)
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
  return { success: true, tag: el.tagName, text: (el as HTMLElement).innerText?.slice(0, 100) }
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
  fxScrollDrag(msg.direction, amount)   // visual "grab & pull" feedback
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
async function doHover(msg: any) {
  const el = document.querySelector(msg.selector) as HTMLElement | null
  if (!el) throw new Error(`Element not found: ${msg.selector}`)
  if (fxEnabled) await fxToElement(el)
  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
  return { success: true, selector: msg.selector }
}
