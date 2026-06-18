/**
 * 底部信息面板：点击成员/建筑后的查看 + 操作面板。
 *
 * 游戏化改造（2026-06-13）：
 *  - 由右侧抽屉改为**底部面板**，左上角显示被点对象的"上半身"头像（角色/建筑）。
 *  - 内容按"栏目（标签页）"组织——底部高度有限，内容多时用户切标签查看，不再被截断。
 *
 * 设计原则（方案 §0①）：面板只是现有 REST 链路的调用方——
 * 启停=toggleAiRun、绑定=assignDeviceAi、审批=librarian approve/reject、
 * 派任务=task-trigger、皮肤=world meta。操作完成后 store.refreshNow()，
 * 地图与主控制台两边自然同步。
 */
import type { WorldMember, WorldSnapshot } from '../world/store'
import { renderPortrait, type PortraitSpec } from './portrait'
import { openLibraryPanel, openSpawnPanel } from './drawer/buildingPanel'
import { esc } from './drawer/dom'
import { openMemberPanel } from './drawer/memberPanel'
import { installDrawerStyles } from './drawer/styles'
import type { DrawerActions, PanelTab, PanelController } from './drawer/types'
import { openWorkshopPanel } from './drawer/workshopPanel'

export type { AppearanceDraft, DrawerActions } from './drawer/types'

export class Drawer implements PanelController {
  activeMemberId: number | null = null
  private el: HTMLDivElement
  /** 当前激活标签页的内容容器；section()/feedback() 都挂到这里 */
  private host!: HTMLElement
  private portraitFrame: HTMLDivElement
  private portraitName: HTMLDivElement
  private portraitSub: HTMLDivElement
  private portraitInfo: HTMLDivElement
  private tabsEl: HTMLDivElement
  private bodyEl: HTMLDivElement
  readonly actions: DrawerActions

  constructor(parent: HTMLElement, actions: DrawerActions) {
    this.actions = actions
    installDrawerStyles()

    this.el = document.createElement('div')
    this.el.className = 'gw-panel'
    this.el.innerHTML = `
      <div class="gp-portrait">
        <div class="gp-port-frame"></div>
        <div class="gp-port-name"></div>
        <div class="gp-port-sub"></div>
        <div class="gp-port-info"></div>
      </div>
      <div class="gp-main">
        <div class="gp-tabbar">
          <div class="gp-tabs"></div>
          <button class="gp-close" type="button">✕</button>
        </div>
        <div class="gp-body"></div>
      </div>
    `
    parent.appendChild(this.el)
    this.portraitFrame = this.el.querySelector('.gp-port-frame') as HTMLDivElement
    this.portraitName = this.el.querySelector('.gp-port-name') as HTMLDivElement
    this.portraitSub = this.el.querySelector('.gp-port-sub') as HTMLDivElement
    this.portraitInfo = this.el.querySelector('.gp-port-info') as HTMLDivElement
    this.tabsEl = this.el.querySelector('.gp-tabs') as HTMLDivElement
    this.bodyEl = this.el.querySelector('.gp-body') as HTMLDivElement
    this.host = this.bodyEl
    ;(this.el.querySelector('.gp-close') as HTMLButtonElement).onclick = () => this.close()
  }

  close() {
    this.activeMemberId = null
    this.el.classList.remove('open')
    this.bodyEl.innerHTML = ''
    this.tabsEl.innerHTML = ''
    this.portraitInfo.innerHTML = ''
  }

  get isOpen(): boolean {
    return this.el.classList.contains('open')
  }

  get memberInfoHost(): HTMLElement {
    return this.portraitInfo
  }

  setActiveMemberId(id: WorldMember['id'] | null) {
    this.activeMemberId = id
  }

  /** 打开面板：设置头像 + 标题 + 标签页，默认展示第一栏。 */
  openPanel(opts: { title: string; subtitle?: string; portrait?: PortraitSpec | null; tabs: PanelTab[] }) {
    this.activeMemberId = null
    this.portraitName.textContent = opts.title
    this.portraitSub.textContent = opts.subtitle || ''
    this.portraitFrame.innerHTML = ''
    this.portraitInfo.innerHTML = ''
    if (opts.portrait) this.portraitFrame.appendChild(renderPortrait(opts.portrait))

    this.tabsEl.innerHTML = ''
    this.bodyEl.innerHTML = ''
    const tabButtons: HTMLButtonElement[] = []
    const show = (i: number) => {
      tabButtons.forEach((b, j) => b.classList.toggle('active', i === j))
      this.bodyEl.innerHTML = ''
      this.host = this.bodyEl
      opts.tabs[i].build(this.bodyEl)
      this.bodyEl.scrollTop = 0
    }
    opts.tabs.forEach((tab, i) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'gp-tab'
      b.textContent = tab.name
      b.onclick = () => show(i)
      tabButtons.push(b)
      this.tabsEl.appendChild(b)
    })
    this.el.classList.add('open')
    if (opts.tabs.length) show(0)
  }

  // ---------------------------------------------------------------- 通用小件
  section(titleText: string): HTMLDivElement {
    const sec = document.createElement('div')
    sec.className = 'd-sec'
    if (titleText) {
      const t = document.createElement('div')
      t.className = 'd-sec-title'
      t.textContent = titleText
      sec.appendChild(t)
    }
    this.host.appendChild(sec)
    return sec
  }

  rows(sec: HTMLElement, rows: Array<[string, string]>) {
    for (const [k, v] of rows) {
      if (!v) continue
      const row = document.createElement('div')
      row.className = 'd-row'
      row.innerHTML = `<span class="k">${esc(k)}</span><span class="v">${esc(v)}</span>`
      sec.appendChild(row)
    }
  }

  feedback(sec: HTMLElement): HTMLDivElement {
    const fb = document.createElement('div')
    sec.appendChild(fb)
    return fb
  }

  /** 包装动作：禁用按钮 → 执行 → 报错/成功反馈；返回是否成功 */
  async runAction(btn: HTMLButtonElement | null, fb: HTMLElement, fn: () => Promise<void>, okMsg = '已完成'): Promise<boolean> {
    if (btn) btn.disabled = true
    fb.className = 'd-dim'
    fb.textContent = '执行中…'
    try {
      await fn()
      fb.className = 'd-okmsg'
      fb.textContent = okMsg
      return true
    } catch (err) {
      fb.className = 'd-err'
      fb.textContent = err instanceof Error ? err.message : '操作失败'
      return false
    } finally {
      if (btn) btn.disabled = false
    }
  }

  openMember(m: WorldMember, snap: WorldSnapshot, portrait?: PortraitSpec | null) {
    openMemberPanel(this, m, snap, portrait)
  }

  openWorkshop(deviceId: string, snap: WorldSnapshot, portrait?: PortraitSpec | null) {
    openWorkshopPanel(this, deviceId, snap, portrait)
  }

  openLibrary(snap: WorldSnapshot, portrait?: PortraitSpec | null) {
    openLibraryPanel(this, snap, portrait)
  }

  openSpawn(snap: WorldSnapshot, portrait?: PortraitSpec | null) {
    openSpawnPanel(this, snap, portrait)
  }
}
