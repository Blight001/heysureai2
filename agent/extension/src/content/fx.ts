// content/fx.ts — simulated mouse visual effects.
// Renders a virtual cursor that glides to the target before an AI click, emits
// a ripple at the click point, and shows a "grab & pull" feel while scrolling.
// All state is module-private; functions are awaited by action handlers so the
// animation timing reads naturally next to the real click/scroll.

export const FX = '__hs_mouse_fx__'

let fxEnabled = true
let fxCursor: HTMLElement | null = null
let fxX = 0
let fxY = 0
let fxHideTimer: any = null

export const fxSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
export const isFxEnabled = () => fxEnabled

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

export async function fxMoveTo(x: number, y: number) {
  const cur = fxEnsure()
  if (!cur) return
  cur.classList.add('show')
  // force reflow so the first move animates from the resting position
  void cur.offsetWidth
  fxPlace(x, y, true)
  await fxSleep(300)
}

export function fxClickAt(x: number, y: number, variant: 'left' | 'right' | 'double' = 'left') {
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

export async function fxDragPath(sx: number, sy: number, ex: number, ey: number) {
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

export async function fxToElement(el: Element) {
  if (!fxEnabled) return
  const r = (el as HTMLElement).getBoundingClientRect()
  const x = Math.min(Math.max(r.left + r.width / 2, 4), window.innerWidth - 4)
  const y = Math.min(Math.max(r.top + r.height / 2, 4), window.innerHeight - 4)
  await fxMoveTo(x, y)
}

export function fxScrollDrag(direction: string, amount: number) {
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

// Read the current cursor position (used by doType to draw a click animation
// at the input's center after fxToElement has placed the cursor there).
export const getFxPos = () => ({ x: fxX, y: fxY })
