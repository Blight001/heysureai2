/**
 * 右侧操作抽屉：点击成员/建筑后的查看 + 操作面板。
 *
 * 设计原则（方案 §0①）：抽屉只是现有 REST 链路的调用方——
 * 启停=toggleAiRun、绑定=assignAgentAi、审批=librarian approve/reject、
 * 派任务=task-trigger、皮肤=world meta。操作完成后 store.refreshNow()，
 * 地图与主控制台两边自然同步。
 */
import { MEMBER_SKINS } from '../assetManifest'
import type { WorldMember, WorldSnapshot } from '../world/store'

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const SKIN_LABELS: Record<string, string> = {
  'char_member_blue.png': '蓝',
  'char_member_red.png': '红',
  'char_member_amber.png': '黄',
  'char_member_slate.png': '灰',
}

export interface DrawerActions {
  toggleRun(aiConfigId: number): Promise<void>
  assignAgent(agentId: string, aiConfigId: number | null): Promise<void>
  setSkin(aiConfigId: number, skin: string): Promise<void>
  createTask(aiConfigId: number, title: string, instruction: string): Promise<void>
  approveProposal(memoryId: string): Promise<void>
  rejectProposal(memoryId: string): Promise<void>
  openChat(aiConfigId: number): void
  focusMember(aiConfigId: number): void
}

export class Drawer {
  private el: HTMLDivElement
  private body: HTMLDivElement
  private title: HTMLDivElement
  private actions: DrawerActions

  constructor(parent: HTMLElement, actions: DrawerActions) {
    this.actions = actions
    const style = document.createElement('style')
    style.textContent = `
      .gw-drawer {
        position: fixed; top: 0; right: 0; bottom: 0; width: 320px; z-index: 50;
        background: rgba(28, 30, 38, 0.97); border-left: 2px solid #4a4f5e;
        color: #d6dae2; font: 12px/1.7 ui-monospace, "Cascadia Mono", Consolas, monospace;
        display: none; flex-direction: column;
      }
      .gw-drawer.open { display: flex; }
      .gw-drawer .d-head {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 12px; border-bottom: 1px solid #3a3f4c; flex: none;
      }
      .gw-drawer .d-title { color: #f0c060; font-weight: bold; font-size: 13px; }
      .gw-drawer .d-close {
        cursor: pointer; border: 1px solid #4a4f5e; border-radius: 3px;
        background: none; color: #8a90a0; font: inherit; padding: 1px 8px;
      }
      .gw-drawer .d-close:hover { color: #d6dae2; }
      .gw-drawer .d-body { padding: 10px 12px 20px; overflow-y: auto; flex: 1; }
      .gw-drawer .d-sec { margin-bottom: 14px; }
      .gw-drawer .d-sec-title { color: #9fc6ff; margin-bottom: 4px; }
      .gw-drawer .d-row { display: flex; gap: 8px; }
      .gw-drawer .d-row .k { color: #8a90a0; flex: none; min-width: 36px; }
      .gw-drawer .d-row .v { word-break: break-all; }
      .gw-drawer .d-bar { height: 6px; background: #3a3f4c; border-radius: 3px; margin: 4px 0; overflow: hidden; }
      .gw-drawer .d-bar > div { height: 100%; }
      .gw-drawer button.d-btn {
        cursor: pointer; border: 1px solid #4a4f5e; border-radius: 3px;
        background: #343949; color: #d6dae2; font: inherit; padding: 3px 10px; margin: 2px 4px 2px 0;
      }
      .gw-drawer button.d-btn:hover { background: #3f4558; }
      .gw-drawer button.d-btn:disabled { opacity: 0.5; cursor: default; }
      .gw-drawer button.d-btn.warn { border-color: #7a4a4a; color: #e0a0a0; }
      .gw-drawer button.d-btn.ok { border-color: #4a7a55; color: #9fdcae; }
      .gw-drawer select.d-sel, .gw-drawer input.d-in, .gw-drawer textarea.d-ta {
        width: 100%; box-sizing: border-box; background: #23262e; color: #d6dae2;
        border: 1px solid #4a4f5e; border-radius: 3px; font: inherit; padding: 3px 6px; margin: 2px 0;
      }
      .gw-drawer textarea.d-ta { min-height: 60px; resize: vertical; }
      .gw-drawer .d-err { color: #e08484; }
      .gw-drawer .d-okmsg { color: #84d99a; }
      .gw-drawer .d-item {
        border: 1px solid #3a3f4c; border-radius: 4px; padding: 6px 8px; margin-bottom: 6px;
      }
      .gw-drawer .d-item.click { cursor: pointer; }
      .gw-drawer .d-item.click:hover { border-color: #5a6175; }
      .gw-drawer .d-dim { color: #8a90a0; }
    `
    document.head.appendChild(style)

    this.el = document.createElement('div')
    this.el.className = 'gw-drawer'
    this.el.innerHTML = `
      <div class="d-head">
        <div class="d-title"></div>
        <button class="d-close" type="button">✕</button>
      </div>
      <div class="d-body"></div>
    `
    parent.appendChild(this.el)
    this.title = this.el.querySelector('.d-title') as HTMLDivElement
    this.body = this.el.querySelector('.d-body') as HTMLDivElement
    ;(this.el.querySelector('.d-close') as HTMLButtonElement).onclick = () => this.close()
  }

  close() {
    this.el.classList.remove('open')
    this.body.innerHTML = ''
  }

  get isOpen(): boolean {
    return this.el.classList.contains('open')
  }

  private open(title: string) {
    this.title.textContent = title
    this.body.innerHTML = ''
    this.el.classList.add('open')
  }

  // ---------------------------------------------------------------- 通用小件
  private section(titleText: string): HTMLDivElement {
    const sec = document.createElement('div')
    sec.className = 'd-sec'
    if (titleText) {
      const t = document.createElement('div')
      t.className = 'd-sec-title'
      t.textContent = titleText
      sec.appendChild(t)
    }
    this.body.appendChild(sec)
    return sec
  }

  private rows(sec: HTMLElement, rows: Array<[string, string]>) {
    for (const [k, v] of rows) {
      if (!v) continue
      const row = document.createElement('div')
      row.className = 'd-row'
      row.innerHTML = `<span class="k">${esc(k)}</span><span class="v">${esc(v)}</span>`
      sec.appendChild(row)
    }
  }

  private feedback(sec: HTMLElement): HTMLDivElement {
    const fb = document.createElement('div')
    sec.appendChild(fb)
    return fb
  }

  /** 包装动作：禁用按钮 → 执行 → 报错/成功反馈；返回是否成功 */
  private async runAction(btn: HTMLButtonElement | null, fb: HTMLElement, fn: () => Promise<void>, okMsg = '已完成'): Promise<boolean> {
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

  // ---------------------------------------------------------------- 成员
  openMember(m: WorldMember, snap: WorldSnapshot) {
    const roleLabel: Record<WorldMember['role'], string> = {
      core_admin: '核心管理员',
      assistant_admin: '辅助管理员',
      librarian: '图书管理员',
      member: '数字成员',
    }
    this.open(`${m.name}`)

    const info = this.section(`${roleLabel[m.role]} · 第 ${m.generation} 代`)
    if (m.tokenLimit > 0) {
      const pct = Math.min(1, m.tokensUsed / m.tokenLimit)
      const color = pct >= 0.95 ? '#e05a5a' : pct >= 0.8 ? '#e0a23c' : '#5aa9e0'
      const bar = document.createElement('div')
      bar.className = 'd-bar'
      bar.innerHTML = `<div style="width:${(pct * 100).toFixed(0)}%;background:${color}"></div>`
      info.appendChild(bar)
    }
    this.rows(info, [
      ['token', m.tokenLimit > 0 ? `${m.tokensUsed} / ${m.tokenLimit}` : `${m.tokensUsed}（无上限）`],
      ['状态', m.enabled ? m.lifecycle : '已停用'],
      ['行为', m.currentBehavior],
      ['任务', m.taskTitle ? `${m.taskTitle}（${m.taskStatus}）` : '无'],
      ['项目', m.projectName],
      ['模型', m.model],
    ])

    // 快捷操作
    const ops = this.section('操作')
    const fb = this.feedback(ops)
    const toggleBtn = document.createElement('button')
    toggleBtn.type = 'button'
    toggleBtn.className = `d-btn ${m.enabled ? 'warn' : 'ok'}`
    toggleBtn.textContent = m.enabled ? '停用' : '启用'
    toggleBtn.onclick = () =>
      void this.runAction(toggleBtn, fb, () => this.actions.toggleRun(m.id), m.enabled ? '已停用' : '已启用')
    ops.appendChild(toggleBtn)
    const chatBtn = document.createElement('button')
    chatBtn.type = 'button'
    chatBtn.className = 'd-btn'
    chatBtn.textContent = '打开对话'
    chatBtn.onclick = () => this.actions.openChat(m.id)
    ops.appendChild(chatBtn)

    // 端侧绑定
    const bind = this.section('端侧绑定（作坊）')
    const bindFb = this.feedback(bind)
    for (const agentId of m.boundAgentIds) {
      const w = snap.workshops.find(x => x.agentId === agentId)
      const item = document.createElement('div')
      item.className = 'd-item'
      const label = document.createElement('span')
      label.textContent = `${w?.name || agentId}（${w?.type === 'browser' ? '瞭望塔' : '机械坊'}）`
      const un = document.createElement('button')
      un.type = 'button'
      un.className = 'd-btn warn'
      un.style.float = 'right'
      un.textContent = '解绑'
      un.onclick = () => void this.runAction(un, bindFb, () => this.actions.assignAgent(agentId, null), '已解绑')
      item.appendChild(un)
      item.appendChild(label)
      bind.appendChild(item)
    }
    const freeWorkshops = snap.workshops.filter(w => !m.boundAgentIds.includes(w.agentId))
    if (freeWorkshops.length) {
      const sel = document.createElement('select')
      sel.className = 'd-sel'
      sel.innerHTML =
        `<option value="">选择作坊以绑定本成员…</option>` +
        freeWorkshops
          .map(w => `<option value="${esc(w.agentId)}">${esc(w.name)}（${w.type === 'browser' ? '瞭望塔' : '机械坊'}${w.aiConfigId ? ' · 已有成员' : ''}）</option>`)
          .join('')
      const bd = document.createElement('button')
      bd.type = 'button'
      bd.className = 'd-btn ok'
      bd.textContent = '绑定'
      bd.onclick = () => {
        if (!sel.value) return
        void this.runAction(bd, bindFb, () => this.actions.assignAgent(sel.value, m.id), '已绑定')
      }
      bind.appendChild(sel)
      bind.appendChild(bd)
    } else if (!m.boundAgentIds.length) {
      bind.innerHTML += `<div class="d-dim">当前无在线端侧 agent</div>`
    }

    // 派任务
    const task = this.section('派任务')
    const taskFb = this.feedback(task)
    const titleIn = document.createElement('input')
    titleIn.className = 'd-in'
    titleIn.placeholder = '任务标题'
    const instrTa = document.createElement('textarea')
    instrTa.className = 'd-ta'
    instrTa.placeholder = '任务指令（目标 / 约束 / 交付物）'
    const sendBtn = document.createElement('button')
    sendBtn.type = 'button'
    sendBtn.className = 'd-btn ok'
    sendBtn.textContent = '创建并入队'
    sendBtn.onclick = () => {
      const t = titleIn.value.trim()
      const i = instrTa.value.trim()
      if (!t || !i) {
        taskFb.className = 'd-err'
        taskFb.textContent = '标题与指令都不能为空'
        return
      }
      void this.runAction(sendBtn, taskFb, () => this.actions.createTask(m.id, t, i), '任务已入队').then(ok => {
        if (ok) {
          titleIn.value = ''
          instrTa.value = ''
        }
      })
    }
    task.appendChild(titleIn)
    task.appendChild(instrTa)
    task.appendChild(sendBtn)

    // 皮肤（仅普通成员可换）
    if (m.role === 'member') {
      const skin = this.section('皮肤')
      const skinFb = this.feedback(skin)
      for (const key of MEMBER_SKINS) {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'd-btn'
        b.textContent = SKIN_LABELS[key] || key
        if (m.skin === key) b.style.borderColor = '#f0c060'
        b.onclick = () => void this.runAction(b, skinFb, () => this.actions.setSkin(m.id, key), '皮肤已更新')
        skin.appendChild(b)
      }
      const reset = document.createElement('button')
      reset.type = 'button'
      reset.className = 'd-btn'
      reset.textContent = '默认'
      if (!m.skin) reset.style.borderColor = '#f0c060'
      reset.onclick = () => void this.runAction(reset, skinFb, () => this.actions.setSkin(m.id, ''), '已恢复默认')
      skin.appendChild(reset)
    }
  }

  // ---------------------------------------------------------------- 作坊
  openWorkshop(agentId: string, snap: WorldSnapshot) {
    const w = snap.workshops.find(x => x.agentId === agentId)
    if (!w) return
    this.open(w.type === 'desktop' ? '机械坊（桌面 Agent）' : '瞭望塔（浏览器 Agent）')
    const info = this.section('设备')
    this.rows(info, [
      ['名称', w.name],
      ['平台', w.platform || 'unknown'],
      ['状态', w.lifecycle === 'dispatching' ? '执行中' : '在线'],
      ['工具', `${w.capabilities} 个端侧工具`],
      ['错误', w.lastError || ''],
    ])

    const assign = this.section('分配成员')
    const fb = this.feedback(assign)
    const bound = snap.members.find(m => m.id === w.aiConfigId)
    const sel = document.createElement('select')
    sel.className = 'd-sel'
    sel.innerHTML =
      `<option value="">未分配</option>` +
      snap.members
        .filter(m => m.lifecycle !== 'dead')
        .map(m => `<option value="${m.id}" ${m.id === w.aiConfigId ? 'selected' : ''}>${esc(m.name)}（ID ${m.id}）</option>`)
        .join('')
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'd-btn ok'
    btn.textContent = '保存分配'
    btn.onclick = () => {
      const v = sel.value === '' ? null : Number(sel.value)
      void this.runAction(btn, fb, () => this.actions.assignAgent(w.agentId, v), v === null ? '已解绑' : '已分配')
    }
    assign.appendChild(sel)
    assign.appendChild(btn)
    if (bound) {
      const hint = document.createElement('div')
      hint.className = 'd-dim'
      hint.textContent = `当前成员：${bound.name}（点击地图上的成员可查看详情）`
      assign.appendChild(hint)
    }
  }

  // ---------------------------------------------------------------- 固定建筑
  openLibrary(snap: WorldSnapshot) {
    this.open('传承知识库（图书馆）')
    const stat = this.section('概览')
    this.rows(stat, [
      ['知识', `${snap.knowledgeActive} 条生效`],
      ['待审批', `${snap.knowledgePending} 条`],
    ])
    const list = this.section('待审批沉淀申请')
    if (!snap.proposals.length) {
      list.innerHTML += `<div class="d-dim">暂无待审批申请</div>`
      return
    }
    for (const p of snap.proposals) {
      const item = document.createElement('div')
      item.className = 'd-item'
      const fb = document.createElement('div')
      item.innerHTML = `<div>${esc(p.title)}</div><div class="d-dim">${esc(p.summary || '')}</div>`
      const ok = document.createElement('button')
      ok.type = 'button'
      ok.className = 'd-btn ok'
      ok.textContent = '通过'
      ok.onclick = () => void this.runAction(ok, fb, () => this.actions.approveProposal(p.memory_id), '已通过')
      const no = document.createElement('button')
      no.type = 'button'
      no.className = 'd-btn warn'
      no.textContent = '驳回'
      no.onclick = () => void this.runAction(no, fb, () => this.actions.rejectProposal(p.memory_id), '已驳回')
      item.appendChild(ok)
      item.appendChild(no)
      item.appendChild(fb)
      list.appendChild(item)
    }
  }

  openValhalla(snap: WorldSnapshot) {
    this.open('英灵殿')
    const stat = this.section('概览')
    this.rows(stat, [['名册', `${snap.valhallaCount} 位逝者`]])
    const list = this.section('最近入殿')
    if (!snap.valhallaItems.length) {
      list.innerHTML += `<div class="d-dim">名册为空——还没有成员走完一生</div>`
      return
    }
    const kindLabel: Record<string, string> = { inherit: '传承', complete: '功成', aborted: '中断' }
    for (const e of snap.valhallaItems.slice(0, 20)) {
      const date = e.created_at ? new Date(e.created_at * 1000).toLocaleDateString() : ''
      const item = document.createElement('div')
      item.className = 'd-item'
      item.innerHTML =
        `<div>${esc(e.ai_name || `AI-${e.ai_config_id}`)} · 第 ${e.generation} 代 · ${kindLabel[e.kind] || e.kind}</div>` +
        `<div class="d-dim">${esc(e.job_title || '')} ${esc(date)}</div>` +
        (e.summary_excerpt ? `<div class="d-dim">${esc(e.summary_excerpt.slice(0, 80))}</div>` : '')
      list.appendChild(item)
    }
  }

  openHall(snap: WorldSnapshot) {
    this.open('议事厅')
    const busy = snap.members.filter(m => m.taskTitle && m.lifecycle !== 'dead')
    const stat = this.section('概览')
    this.rows(stat, [['任务', `${busy.filter(m => m.taskStatus === 'running').length} 个运行中 / ${busy.length} 个在册`]])
    const list = this.section('任务一览（点击查看成员）')
    if (!busy.length) {
      list.innerHTML += `<div class="d-dim">暂无任务——点击成员可直接派任务</div>`
      return
    }
    for (const m of busy) {
      const item = document.createElement('div')
      item.className = 'd-item click'
      item.innerHTML = `<div>${esc(m.taskTitle)}（${esc(m.taskStatus)}）</div><div class="d-dim">${esc(m.name)}</div>`
      item.onclick = () => this.actions.focusMember(m.id)
      list.appendChild(item)
    }
  }

  openSpawn(snap: WorldSnapshot) {
    this.open('出生地')
    const idle = snap.members.filter(
      m => m.lifecycle !== 'dead' && (!m.projectId || m.lifecycle === 'learning') &&
        m.role === 'member' && !m.boundAgentIds.length,
    )
    const stat = this.section('概览')
    this.rows(stat, [['待分配', `${idle.length} 位成员`]])
    const list = this.section('待分配成员（点击查看 / 派活）')
    if (!idle.length) {
      list.innerHTML += `<div class="d-dim">没有闲置成员；新成员请到主控制台创建</div>`
      return
    }
    for (const m of idle) {
      const item = document.createElement('div')
      item.className = 'd-item click'
      item.innerHTML = `<div>${esc(m.name)} · 第 ${m.generation} 代</div><div class="d-dim">${esc(m.currentBehavior || m.lifecycle)}</div>`
      item.onclick = () => this.actions.focusMember(m.id)
      list.appendChild(item)
    }
  }
}
