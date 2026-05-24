// content/dom.ts — pure DOM helpers shared by action and popup modules.
// All functions here are stateless and have no side effects beyond reading
// computed styles / bounding boxes.

import { FX } from './fx'

export function isVisible(el: Element | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false
  if (el.id?.startsWith(FX)) return false
  const s = getComputedStyle(el)
  if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 && r.bottom >= 0 && r.right >= 0 && r.top <= window.innerHeight && r.left <= window.innerWidth
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

export function cssPath(el: Element): string {
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

export function elCenter(el: Element): { x: number; y: number } {
  const r = (el as HTMLElement).getBoundingClientRect()
  return {
    x: Math.min(Math.max(r.left + r.width / 2, 1), window.innerWidth - 1),
    y: Math.min(Math.max(r.top + r.height / 2, 1), window.innerHeight - 1),
  }
}

export function clickLikeUser(el: Element) {
  const c = elCenter(el)
  const opts = { bubbles: true, cancelable: true, view: window, clientX: c.x, clientY: c.y } as MouseEventInit
  el.dispatchEvent(new PointerEvent('pointerdown', opts))
  el.dispatchEvent(new MouseEvent('mousedown', opts))
  el.dispatchEvent(new PointerEvent('pointerup', opts))
  el.dispatchEvent(new MouseEvent('mouseup', opts))
  el.dispatchEvent(new MouseEvent('click', opts))
  ;(el as HTMLElement).click?.()
}

// Resolve a target from selector / text / explicit coords.
export function resolveTarget(msg: { selector?: string; text?: string; x?: number; y?: number }): { el: Element | null; x: number; y: number } {
  if (msg.x !== undefined && msg.y !== undefined) {
    const el = document.elementFromPoint(Number(msg.x), Number(msg.y))
    return { el, x: Number(msg.x), y: Number(msg.y) }
  }
  const el = findEl(msg.selector, msg.text)
  if (!el) return { el: null, x: 0, y: 0 }
  const c = elCenter(el)
  return { el, x: c.x, y: c.y }
}
