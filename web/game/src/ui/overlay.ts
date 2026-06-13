/**
 * DOM 覆盖层：悬浮 tooltip + 右下角 HUD。
 * P0 只读；P1 的设置抽屉 / 操作菜单也挂在这一层（Vue 化）。
 */

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export interface TooltipRow {
  label: string
  value: string
}

export interface TooltipData {
  title: string
  badge?: string
  rows: TooltipRow[]
  /** 0..1，显示 token 进度条 */
  tokenRatio?: number
  tokenText?: string
}

export class Overlay {
  private tooltip: HTMLDivElement
  private hud: HTMLDivElement

  constructor(parent: HTMLElement) {
    const style = document.createElement('style')
    style.textContent = `
      .gw-tooltip {
        position: fixed; z-index: 40; pointer-events: none; display: none;
        min-width: 180px; max-width: 280px;
        background: rgba(28, 30, 38, 0.95); border: 2px solid #4a4f5e; border-radius: 4px;
        color: #d6dae2; font: 12px/1.6 ui-monospace, "Cascadia Mono", Consolas, monospace;
        padding: 8px 10px; box-shadow: 0 4px 14px rgba(0,0,0,0.5);
        image-rendering: pixelated;
      }
      .gw-tooltip .t-title { color: #f0c060; font-weight: bold; margin-bottom: 2px; }
      .gw-tooltip .t-badge {
        display: inline-block; margin-left: 6px; padding: 0 5px; border-radius: 3px;
        background: #3a4156; color: #9fc6ff; font-size: 10px; vertical-align: 1px;
      }
      .gw-tooltip .t-row { display: flex; gap: 8px; }
      .gw-tooltip .t-row .k { color: #8a90a0; flex: none; }
      .gw-tooltip .t-row .v { word-break: break-all; }
      .gw-tooltip .t-bar { height: 6px; background: #3a3f4c; border-radius: 3px; margin: 4px 0 2px; overflow: hidden; }
      .gw-tooltip .t-bar > div { height: 100%; }
      .gw-hud {
        position: fixed; right: 12px; bottom: 12px; z-index: 30;
        background: rgba(28, 30, 38, 0.88); border: 2px solid #4a4f5e; border-radius: 4px;
        color: #d6dae2; font: 12px/1.7 ui-monospace, "Cascadia Mono", Consolas, monospace;
        padding: 8px 12px; max-width: 320px; text-align: right;
      }
      .gw-hud .h-dim { color: #8a90a0; }
      .gw-hud .h-err { color: #e08484; }
      .gw-mute {
        position: fixed; left: 12px; bottom: 12px; z-index: 30; cursor: pointer;
        background: rgba(28, 30, 38, 0.88); border: 2px solid #4a4f5e; border-radius: 4px;
        color: #d6dae2; font: 12px ui-monospace, "Cascadia Mono", Consolas, monospace;
        padding: 5px 10px;
      }
      .gw-mute:hover { border-color: #5a6175; }
    `
    document.head.appendChild(style)

    this.tooltip = document.createElement('div')
    this.tooltip.className = 'gw-tooltip'
    parent.appendChild(this.tooltip)

    this.hud = document.createElement('div')
    this.hud.className = 'gw-hud'
    parent.appendChild(this.hud)
  }

  showTooltip(data: TooltipData, clientX: number, clientY: number) {
    let html = `<div class="t-title">${esc(data.title)}${data.badge ? `<span class="t-badge">${esc(data.badge)}</span>` : ''}</div>`
    if (data.tokenRatio !== undefined) {
      const pct = Math.min(1, Math.max(0, data.tokenRatio))
      const color = pct >= 0.95 ? '#e05a5a' : pct >= 0.8 ? '#e0a23c' : '#5aa9e0'
      html += `<div class="t-bar"><div style="width:${(pct * 100).toFixed(0)}%;background:${color}"></div></div>`
      if (data.tokenText) html += `<div class="t-row"><span class="k">token</span><span class="v">${esc(data.tokenText)}</span></div>`
    }
    for (const row of data.rows) {
      if (!row.value) continue
      html += `<div class="t-row"><span class="k">${esc(row.label)}</span><span class="v">${esc(row.value)}</span></div>`
    }
    this.tooltip.innerHTML = html
    this.tooltip.style.display = 'block'
    this.moveTooltip(clientX, clientY)
  }

  moveTooltip(clientX: number, clientY: number) {
    if (this.tooltip.style.display === 'none') return
    const pad = 14
    const rect = this.tooltip.getBoundingClientRect()
    let x = clientX + pad
    let y = clientY + pad
    if (x + rect.width > window.innerWidth - 8) x = clientX - rect.width - pad
    if (y + rect.height > window.innerHeight - 8) y = clientY - rect.height - pad
    this.tooltip.style.left = `${Math.max(4, x)}px`
    this.tooltip.style.top = `${Math.max(4, y)}px`
  }

  hideTooltip() {
    this.tooltip.style.display = 'none'
  }

  setHud(html: string) {
    this.hud.innerHTML = html
  }

  /** 左下角静音开关（P2 声音） */
  initMuteButton(parent: HTMLElement, initialMuted: boolean, onChange: (muted: boolean) => void) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'gw-mute'
    let muted = initialMuted
    const render = () => {
      btn.textContent = muted ? '🔇 声音关' : '🔊 声音开'
    }
    render()
    btn.onclick = () => {
      muted = !muted
      render()
      onChange(muted)
    }
    parent.appendChild(btn)
  }
}
