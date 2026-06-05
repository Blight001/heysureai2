// content/observe.ts — the perception primitive behind browser_observe.
//
// Returns only the elements a real user could see and interact with on the
// current screen: top-most (un-occluded), visible, pointer-accepting controls.
// Each gets a 1-based id so the AI can click it precisely with
// browser_click {ref:id} — the "see the page, click by number" loop that avoids
// both background-element leakage and fragile selector/coordinate guessing.
//
// When mark!==false it also paints numbered badges + outlines on the page so a
// follow-up browser_screenshot shows the same ids (Set-of-Marks). The overlay is
// attached to <html> (not <body>), pointer-events:none, so it never pollutes
// browser_get_content / browser_dom_snapshot (which read from <body>) and never
// intercepts clicks or future hit-tests.

import { isHittable, isVisible, cssPath, textOf, elementArea } from './dom'
import { setMarks } from './marks'
import { viewportContext } from './viewport'

const INTERACTIVE = [
  'a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea',
  '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
  '[role="tab"]', '[role="menuitem"]', '[role="menuitemcheckbox"]', '[role="menuitemradio"]',
  '[role="switch"]', '[role="option"]', '[contenteditable=""]', '[contenteditable="true"]',
  '[onclick]', '[tabindex]:not([tabindex="-1"])', 'summary', 'label[for]',
  '[aria-expanded]', '[aria-haspopup]', '[aria-controls]', '[aria-pressed]', '[aria-selected]',
  '[draggable="true"]',
].join(',')

const MARK_LAYER_ID = '__hs_marks_layer'

function implicitRole(el: Element): string {
  const tag = el.tagName.toLowerCase()
  if (tag === 'a') return 'link'
  if (tag === 'button' || tag === 'summary') return 'button'
  if (tag === 'select') return 'combobox'
  if (tag === 'textarea') return 'textbox'
  if (tag === 'input') {
    const t = (el as HTMLInputElement).type
    if (t === 'checkbox' || t === 'radio' || t === 'button' || t === 'submit') return t
    return 'textbox'
  }
  return ''
}

function isDisabled(el: Element): boolean {
  const html = el as HTMLElement
  return html.hasAttribute('disabled') ||
    html.getAttribute('aria-disabled') === 'true' ||
    html.closest('[disabled],[aria-disabled="true"]') !== null
}

function hasInteractiveSemantics(el: Element): boolean {
  if (!(el instanceof HTMLElement) || isDisabled(el)) return false
  if (el.matches(INTERACTIVE)) return true
  const s = getComputedStyle(el)
  return s.cursor === 'pointer'
}

function collectCandidates(): HTMLElement[] {
  const out: HTMLElement[] = []
  const seen = new Set<Element>()
  const add = (el: Element | null) => {
    if (!(el instanceof HTMLElement) || seen.has(el)) return
    seen.add(el)
    if (hasInteractiveSemantics(el) && isVisible(el)) out.push(el)
  }

  document.querySelectorAll(INTERACTIVE).forEach(add)

  // Many React/Vue component libraries bind click handlers in JS without
  // leaving onclick/role/tabindex attributes. `cursor:pointer` is the most
  // reliable DOM-observable signal for those controls.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
  let scanned = 0
  while (walker.nextNode() && scanned < 6000) {
    scanned += 1
    add(walker.currentNode as Element)
  }

  return out
}

function isStrongControl(el: Element): boolean {
  return el.matches('a[href],button,input:not([type="hidden"]),select,textarea,summary,label[for],[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="tab"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="switch"],[contenteditable=""],[contenteditable="true"]')
}

function shouldDropNested(child: HTMLElement, parent: HTMLElement): boolean {
  if (isStrongControl(child)) return false
  if (isStrongControl(parent)) return true

  const childText = textOf(child, 120)
  const parentText = textOf(parent, 120)
  const childArea = elementArea(child)
  const parentArea = elementArea(parent)

  if (childText && parentText && childText !== parentText) return false
  if (parentArea > 0 && childArea / parentArea < 0.65) return false
  return true
}

export function clearMarksOverlay(): void {
  document.getElementById(MARK_LAYER_ID)?.remove()
}

function drawMarksOverlay(els: Element[]): void {
  clearMarksOverlay()
  const layer = document.createElement('div')
  layer.id = MARK_LAYER_ID
  layer.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;margin:0;padding:0;border:0;z-index:2147483646;pointer-events:none;'
  els.forEach((el, i) => {
    const r = (el as HTMLElement).getBoundingClientRect()
    const box = document.createElement('div')
    box.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${Math.max(0, r.width)}px;height:${Math.max(0, r.height)}px;box-sizing:border-box;border:1px solid rgba(37,99,235,.7);background:rgba(37,99,235,.06);pointer-events:none;`
    const badge = document.createElement('div')
    badge.textContent = String(i + 1)
    badge.style.cssText = `position:fixed;left:${Math.max(0, r.left)}px;top:${Math.max(0, r.top)}px;background:#2563eb;color:#fff;font:bold 11px/14px ui-monospace,monospace;padding:0 4px;border-radius:0 0 3px 0;pointer-events:none;box-shadow:0 0 0 1px #fff;`
    layer.appendChild(box)
    layer.appendChild(badge)
  })
  document.documentElement.appendChild(layer)
}

export function doObserve(msg: any) {
  clearMarksOverlay()  // never include our own previous overlay in the next scan
  const all = collectCandidates()
  const hittable = all.filter(isHittable)
  const set = new Set<HTMLElement>(hittable)
  // Remove only obvious duplicate wrappers. The old rule dropped every nested
  // interactive child when its parent was also interactive, which hides common
  // UI like cards that contain their own buttons/menus.
  const pruned = hittable.filter(el => {
    let p = el.parentElement
    while (p) {
      if (set.has(p) && shouldDropNested(el, p)) return false
      p = p.parentElement
    }
    return true
  })

  const limit = Math.min(Math.max(Number(msg.limit ?? 120), 1), 200)
  const chosen = pruned.slice(0, limit)

  const elements = chosen.map((el, i) => {
    const r = el.getBoundingClientRect()
    const item: any = {
      id: i + 1,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || implicitRole(el),
      text: textOf(el, 80),
      selector: cssPath(el),
      center: { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) },
      rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    }
    const type = (el as HTMLInputElement).type
    if (type) item.type = type
    if ((el as HTMLInputElement).value) item.value = String((el as HTMLInputElement).value).slice(0, 60)
    return item
  })

  // Record each mark with its re-find descriptor so browser_click {ref} can heal
  // itself if the page re-renders before the click (see marks.ts / resolveTarget).
  setMarks(chosen.map((el, i) => ({
    el,
    selector: elements[i].selector,
    text: elements[i].text,
    center: elements[i].center,
  })))

  const marked = msg.mark !== false
  if (marked) drawMarksOverlay(chosen)

  const ctx = viewportContext()
  return {
    success: true,
    source: 'browser_observe',
    url: location.href,
    title: document.title,
    count: elements.length,
    stats: {
      candidates: all.length,
      hittable: hittable.length,
      afterDedupe: pruned.length,
      limit,
    },
    truncated: pruned.length > chosen.length,
    marked,
    scroll: { y: ctx.scrollY, percent: ctx.scrollPercent, atTop: ctx.atTop, atBottom: ctx.atBottom },
    currentSection: ctx.currentSection,
    elements,
    hint: '只列出用户当前能看到、未被遮挡的可交互元素。用 browser_click {ref:id} 按编号点击最稳。' +
      (marked ? ' 页面上已画出对应编号，调用 browser_screenshot 即可看到。' : ''),
  }
}
