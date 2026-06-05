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

import { isHittable, cssPath, textOf } from './dom'
import { setMarks } from './marks'
import { viewportContext } from './viewport'

const INTERACTIVE = [
  'a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea',
  '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
  '[role="tab"]', '[role="menuitem"]', '[role="menuitemcheckbox"]', '[role="menuitemradio"]',
  '[role="switch"]', '[role="option"]', '[contenteditable=""]', '[contenteditable="true"]',
  '[onclick]', '[tabindex]:not([tabindex="-1"])', 'summary', 'label[for]',
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
  // Cap the candidate scan: isHittable does up to 4 elementFromPoint hit-tests
  // each, so on pages with thousands of controls we'd rather bound the cost than
  // hit-test everything. Off-screen controls fail isHittable anyway.
  const all = (Array.from(document.querySelectorAll(INTERACTIVE)) as HTMLElement[]).slice(0, 800)
  const hittable = all.filter(isHittable)
  const set = new Set<HTMLElement>(hittable)
  // Keep the outer-most interactive element of a nest (the <a>/<button>, not its
  // inner <span>) to avoid duplicate marks pointing at the same control.
  const pruned = hittable.filter(el => {
    let p = el.parentElement
    while (p) { if (set.has(p)) return false; p = p.parentElement }
    return true
  })

  const limit = Math.min(Math.max(Number(msg.limit ?? 60), 1), 200)
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
    truncated: pruned.length > chosen.length,
    marked,
    scroll: { y: ctx.scrollY, percent: ctx.scrollPercent, atTop: ctx.atTop, atBottom: ctx.atBottom },
    currentSection: ctx.currentSection,
    elements,
    hint: '只列出用户当前能看到、未被遮挡的可交互元素。用 browser_click {ref:id} 按编号点击最稳。' +
      (marked ? ' 页面上已画出对应编号，调用 browser_screenshot 即可看到。' : ''),
  }
}
