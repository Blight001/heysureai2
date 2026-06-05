// content/dom.ts — pure DOM helpers shared by action and popup modules.
// All functions here are stateless and have no side effects beyond reading
// computed styles / bounding boxes.

import { FX } from './fx'
import { getMarkTarget } from './marks'

export function isVisible(el: Element | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false
  if (el.id?.startsWith(FX)) return false
  const s = getComputedStyle(el)
  if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 && r.bottom >= 0 && r.right >= 0 && r.top <= window.innerHeight && r.left <= window.innerWidth
}

// ── Occlusion / hit-testing ─────────────────────────────────────────────────
// isVisible only checks computed style + viewport bounds; it cannot tell whether
// another element (an ad, popup, sticky overlay, …) is painted *on top* of the
// target. The helpers below answer "is this the element a real user would hit?"
// — which is what we want the AI to see and click, instead of leaked background
// elements that look visible in the DOM but are covered on screen.

function clampX(x: number) { return Math.min(Math.max(x, 1), window.innerWidth - 1) }
function clampY(y: number) { return Math.min(Math.max(y, 1), window.innerHeight - 1) }

/** True when `el` is (or contains / is contained by) the top-most element at (x,y). */
export function isTopmostAt(el: Element, x: number, y: number): boolean {
  const hit = document.elementFromPoint(clampX(x), clampY(y))
  if (!hit) return false
  return hit === el || el.contains(hit) || hit.contains(el)
}

/**
 * An element a user could actually click: visible, accepting pointer events, and
 * the top-most paint at one of a few sample points (center + edges, since the
 * exact center can fall on a gap or a non-interactive child).
 */
export function isHittable(el: Element): boolean {
  if (!isVisible(el)) return false
  const html = el as HTMLElement
  if (getComputedStyle(html).pointerEvents === 'none') return false
  const r = html.getBoundingClientRect()
  const pts: Array<[number, number]> = [
    [r.left + r.width / 2, r.top + r.height / 2],
    [r.left + r.width / 2, r.top + Math.min(r.height * 0.2, 6)],
    [r.left + r.width * 0.2, r.top + r.height / 2],
    [r.left + r.width * 0.8, r.top + r.height / 2],
  ]
  return pts.some(([px, py]) => isTopmostAt(el, px, py))
}

/** The element painted over `el`'s center, if any (used for click diagnostics). */
export function occluderOf(el: Element): Element | null {
  const r = (el as HTMLElement).getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return null
  const hit = document.elementFromPoint(clampX(r.left + r.width / 2), clampY(r.top + r.height / 2))
  if (!hit || hit === el || el.contains(hit) || hit.contains(el)) return null
  return hit
}

export function textOf(el: Element, max = 200): string {
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

// True when `selector` resolves to exactly `el` and nothing else — i.e. it will
// round-trip back to the same node via document.querySelector.
function selectorResolvesTo(selector: string, el: Element): boolean {
  try {
    const hits = document.querySelectorAll(selector)
    return hits.length === 1 && hits[0] === el
  } catch {
    return false
  }
}

// Stable single-attribute selectors, tried before any structural path. Hashed
// class names (Tailwind / CSS-modules / styled-components) churn on every build
// and don't survive re-renders, but ids and these semantic attributes usually do
// — so a selector built from them is what makes a click round-trip reliably.
function stableAttrSelector(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const id = (el as HTMLElement).id
  if (id && selectorResolvesTo(`#${CSS.escape(id)}`, el)) return `#${CSS.escape(id)}`
  for (const attr of ['data-testid', 'data-test', 'data-test-id', 'data-qa', 'data-cy', 'name', 'aria-label']) {
    const v = el.getAttribute(attr)
    if (!v) continue
    const sel = `${tag}[${attr}="${CSS.escape(v)}"]`
    if (selectorResolvesTo(sel, el)) return sel
  }
  return ''
}

// Build a selector that uniquely identifies `el`. Strategy, in order:
//   1. a stable single-attribute selector (id / data-* / name / aria-label),
//   2. an ancestor-anchored structural path, extended (with :nth-of-type and more
//      ancestors) until it resolves to exactly one node.
// The previous version stopped after 5 ancestors and skipped uniqueness checks,
// so the chain could match the *wrong* element (the first in document order) —
// the click would then hit something else or "not be found". We now verify the
// round-trip and keep climbing/anchoring until the selector is unique.
export function cssPath(el: Element): string {
  if (!(el instanceof Element)) return ''
  const attrSel = stableAttrSelector(el)
  if (attrSel) return attrSel

  const segment = (node: Element): string => {
    const tag = node.tagName.toLowerCase()
    const id = (node as HTMLElement).id
    if (id) return `#${CSS.escape(id)}`
    const cls = String((node as HTMLElement).className || '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(c => `.${CSS.escape(c)}`)
      .join('')
    const parent = node.parentElement
    const same = parent ? Array.from(parent.children).filter(c => c.tagName === node.tagName) : []
    const nth = same.length > 1 ? `:nth-of-type(${same.indexOf(node) + 1})` : ''
    return `${tag}${cls}${nth}`
  }

  const parts: string[] = []
  let cur: Element | null = el
  // Climb up to the document root (not just 5 levels), checking uniqueness after
  // each ancestor so we stop as soon as the path is unambiguous. Anchoring on an
  // id ancestor short-circuits and keeps the selector short and resilient.
  while (cur && cur !== document.documentElement && parts.length < 12) {
    parts.unshift(segment(cur))
    const path = parts.join(' > ')
    if (selectorResolvesTo(path, el)) return path
    if ((cur as HTMLElement).id) break  // id segment is already as anchored as it gets
    cur = cur.parentElement
  }
  return parts.length ? parts.join(' > ') : el.tagName.toLowerCase()
}

export function zIndexOf(el: Element): number {
  const z = Number.parseInt(getComputedStyle(el).zIndex || '0', 10)
  return Number.isFinite(z) ? z : 0
}

export function elementArea(el: Element): number {
  const r = (el as HTMLElement).getBoundingClientRect()
  return Math.max(0, r.width) * Math.max(0, r.height)
}

export function clickableAncestor(el: Element): Element {
  return el.closest('button,a,[role="button"],input[type="button"],input[type="submit"],[onclick],[tabindex]') || el
}

export function textMatches(el: HTMLElement, text: string, exact = false): boolean {
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

export function findEl(selector?: string, text?: string): Element | null {
  if (selector) {
    const matches = Array.from(document.querySelectorAll(selector))
    // Prefer the match a user could actually hit (top-most, not occluded), then
    // any visible match, then the first raw match (kept for diagnostics — the
    // click handler reports if it turns out hidden/covered).
    return matches.find(isHittable) || matches.find(isVisible) || matches[0] || null
  }
  if (text) {
    // Text targets are matched against the *top-most* layer first so the AI
    // never lands on a background button hidden behind a popup/overlay. Only if
    // nothing on the top layer matches do we fall back to merely-visible.
    const preferred = Array.from(document.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"],[aria-label],[title]')) as HTMLElement[]
    const byPreferred = (pred: (el: HTMLElement) => boolean, exact: boolean) =>
      preferred.find(el => pred(el) && textMatches(el, text, exact))
    const byWalk = (pred: (el: Element) => boolean, exact: boolean) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
      while (walker.nextNode()) {
        const el = walker.currentNode as HTMLElement
        if (pred(el) && textMatches(el, text, exact)) return clickableAncestor(el)
      }
      return null
    }
    for (const pred of [isHittable, isVisible] as const) {
      const hit = byPreferred(pred as any, true) || byPreferred(pred as any, false)
        || byWalk(pred, true) || byWalk(pred, false)
      if (hit) return hit
    }
  }
  return null
}

export function elCenter(el: Element): { x: number; y: number } {
  const r = (el as HTMLElement).getBoundingClientRect()
  return {
    x: Math.min(Math.max(r.left + r.width / 2, 1), window.innerWidth - 1),
    y: Math.min(Math.max(r.top + r.height / 2, 1), window.innerHeight - 1),
  }
}

// Dispatch the full pointer + mouse sequence a real user gesture produces, then
// the native .click(). A bare el.click() only fires a synthetic "click" and is
// ignored by anything listening to pointerdown/mousedown (custom dropdowns,
// drag-aware widgets, canvas/map controls, many React/Vue handlers) — that was
// the root cause of "clicked but nothing happened". An optional point lets
// coordinate clicks land exactly where requested instead of at the box center.
export function clickLikeUser(el: Element, at?: { x: number; y: number }) {
  const c = at || elCenter(el)
  ;(el as HTMLElement).focus?.()
  const base = { bubbles: true, cancelable: true, view: window, clientX: c.x, clientY: c.y, button: 0 }
  const pointer = { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true }
  el.dispatchEvent(new PointerEvent('pointerover', pointer))
  el.dispatchEvent(new MouseEvent('mouseover', base))
  el.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, buttons: 1 }))
  el.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }))
  el.dispatchEvent(new PointerEvent('pointerup', { ...pointer, buttons: 0 }))
  el.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }))
  el.dispatchEvent(new MouseEvent('click', base))
  ;(el as HTMLElement).click?.()
}

// Resolve a target from observe-id (ref) / selector / text / explicit coords.
// ref is most reliable (captured at observe time); coords return the top-most
// element painted at the point — i.e. exactly what the user would hit there.
//
// Self-healing ref: an observe id whose original node was detached by a re-render
// no longer aborts the click. We re-find it by the selector/text captured at
// observe time, then by any selector/text the caller passed, and only fall back
// to the recorded center point as a last resort. This is what lets "observe →
// click {ref}" survive the SPA re-renders that previously made refs go stale.
export function resolveTarget(msg: { ref?: any; selector?: string; text?: string; x?: number; y?: number }): { el: Element | null; x: number; y: number } {
  const byEl = (el: Element) => { const c = elCenter(el); return { el, x: c.x, y: c.y } }
  const hasRef = msg.ref !== undefined && msg.ref !== null && msg.ref !== ''

  if (hasRef) {
    const mark = getMarkTarget(msg.ref)
    if (mark) {
      if (mark.el && mark.el.isConnected) return byEl(mark.el)
      // Original node is gone (re-render) — re-find it from the captured descriptor.
      const healed = findEl(mark.selector, mark.text)
      if (healed) return byEl(healed)
    }
  }

  if (msg.selector || msg.text) {
    const el = findEl(msg.selector, msg.text)
    if (el) return byEl(el)
  }

  if (msg.x !== undefined && msg.y !== undefined) {
    const el = document.elementFromPoint(Number(msg.x), Number(msg.y))
    return { el, x: Number(msg.x), y: Number(msg.y) }
  }

  // Last resort for a stale ref: aim at the point it occupied at observe time.
  if (hasRef) {
    const mark = getMarkTarget(msg.ref)
    if (mark && mark.center) {
      const el = document.elementFromPoint(mark.center.x, mark.center.y)
      if (el) return { el, x: mark.center.x, y: mark.center.y }
    }
  }

  return { el: null, x: 0, y: 0 }
}
