// content/marks.ts — element-id store shared by observe (writer) and the click
// handlers (reader). Kept dependency-free so both dom.ts and observe.ts can
// import it without creating an import cycle.
//
// browser_observe assigns each top-most interactable element a 1-based id and
// records it here. A follow-up browser_click {ref:id} resolves that id back to
// the live element — the most reliable way to click "the thing the user sees",
// because the element reference is captured at observe time and re-validated
// (isConnected) at click time.

let marks: Element[] = []

export function setMarks(els: Element[]): void {
  marks = els.slice()
}

export function clearMarkRefs(): void {
  marks = []
}

export function markCount(): number {
  return marks.length
}

/** Resolve an observe id (1-based) to a still-attached element, or null. */
export function getMarked(ref: any): Element | null {
  const i = Number(ref)
  if (!Number.isFinite(i) || i < 1 || i > marks.length) return null
  const el = marks[i - 1]
  return el && el.isConnected ? el : null
}
