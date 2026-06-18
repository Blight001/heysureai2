import { MEMBER_SKINS } from '../../assetManifest'
import type { WorldMember, WorldSnapshot } from '../../world/store'
import type { PortraitSpec } from '../portrait'
import { esc } from './dom'
import type { AppearanceDraft, PanelController } from './types'

const SKIN_LABELS: Record<string, string> = {
  'char_member_blue.png': '蓝',
  'char_member_red.png': '红',
  'char_member_amber.png': '黄',
  'char_member_slate.png': '灰',
}

/** 调色预设（乘法 tint，浅色像素变化最明显） */
const TINT_PRESETS = ['#ff9aa2', '#ffd166', '#9be564', '#6ec5ff', '#c69aff', '#ff7b54', '#9aa5b5']
/** 光环颜色预设（ADD 混合发光） */
const AURA_PRESETS = ['#ffd700', '#7fd8ff', '#c69aff', '#9bff8a', '#ff8ad8']

export const openMemberPanel = (
  panel: PanelController,
  m: WorldMember,
  snap: WorldSnapshot,
  portrait?: PortraitSpec | null,
) => {
  const roleLabel: Record<WorldMember['role'], string> = {
    core_admin: '核心管理员',
    assistant_admin: '辅助管理员',
    librarian: '图书管理员',
    member: '数字成员',
  }
  panel.openPanel({
    title: m.name,
    subtitle: `${roleLabel[m.role]} · 第 ${m.generation} 代`,
    portrait,
    tabs: [
      { name: '派任务', build: () => memberTaskTab(panel, m) },
      { name: '操作', build: () => memberOpsTab(panel, m) },
      { name: '端侧绑定', build: () => memberBindTab(panel, m, snap) },
      { name: '外观', build: () => appearanceSection(panel, m) },
    ],
  })
  renderMemberInfo(panel, m)
  panel.setActiveMemberId(m.id)
}

const renderMemberInfo = (panel: PanelController, m: WorldMember) => {
  const info = panel.memberInfoHost
  info.innerHTML = ''
  if (m.tokenLimit > 0) {
    const pct = Math.min(1, m.tokensUsed / m.tokenLimit)
    const color = pct >= 0.95 ? '#e05a5a' : pct >= 0.8 ? '#e0a23c' : '#5aa9e0'
    const bar = document.createElement('div')
    bar.className = 'd-bar'
    bar.innerHTML = `<div style="width:${(pct * 100).toFixed(0)}%;background:${color}"></div>`
    info.appendChild(bar)
  }
  panel.rows(info, [
    ['token', m.tokenLimit > 0 ? `${m.tokensUsed} / ${m.tokenLimit}` : `${m.tokensUsed}（无上限）`],
    ['状态', m.enabled ? m.lifecycle : '已停用'],
    ['行为', m.currentBehavior],
    ['任务', m.taskTitle ? `${m.taskTitle}（${m.taskStatus}）` : '无'],
    ['项目', m.projectName],
    ['模型', m.model],
  ])
}

const memberOpsTab = (panel: PanelController, m: WorldMember) => {
  const ops = panel.section('')
  const fb = panel.feedback(ops)
  const toggleBtn = document.createElement('button')
  toggleBtn.type = 'button'
  toggleBtn.className = `d-btn ${m.enabled ? 'warn' : 'ok'}`
  toggleBtn.textContent = m.enabled ? '停用' : '启用'
  toggleBtn.onclick = () =>
    void panel.runAction(toggleBtn, fb, () => panel.actions.toggleRun(m.id), m.enabled ? '已停用' : '已启用')
  ops.appendChild(toggleBtn)
  const chatBtn = document.createElement('button')
  chatBtn.type = 'button'
  chatBtn.className = 'd-btn'
  chatBtn.textContent = '打开对话'
  chatBtn.onclick = () => panel.actions.openChat(m.id)
  ops.appendChild(chatBtn)
}

const memberBindTab = (panel: PanelController, m: WorldMember, snap: WorldSnapshot) => {
  const bind = panel.section('端侧绑定（作坊）')
  const bindFb = panel.feedback(bind)
  for (const deviceId of m.boundAgentIds) {
    const w = snap.workshops.find(x => x.deviceId === deviceId)
    const item = document.createElement('div')
    item.className = 'd-item'
    const label = document.createElement('span')
    label.textContent = `${w?.name || deviceId}（${w?.type === 'browser' ? '瞭望塔' : '机械坊'}）`
    const un = document.createElement('button')
    un.type = 'button'
    un.className = 'd-btn warn'
    un.style.float = 'right'
    un.textContent = '解绑'
    un.onclick = () => void panel.runAction(un, bindFb, () => panel.actions.assignAgent(deviceId, null), '已解绑')
    item.appendChild(un)
    item.appendChild(label)
    bind.appendChild(item)
  }
  const freeWorkshops = snap.workshops.filter(w => !m.boundAgentIds.includes(w.deviceId))
  if (freeWorkshops.length) {
    const sel = document.createElement('select')
    sel.className = 'd-sel'
    sel.innerHTML =
      `<option value="">选择作坊以绑定本成员…</option>` +
      freeWorkshops
        .map(w => `<option value="${esc(w.deviceId)}">${esc(w.name)}（${w.type === 'browser' ? '瞭望塔' : '机械坊'}${w.aiConfigId ? ' · 已有成员' : ''}）</option>`)
        .join('')
    const bd = document.createElement('button')
    bd.type = 'button'
    bd.className = 'd-btn ok'
    bd.textContent = '绑定'
    bd.onclick = () => {
      if (!sel.value) return
      void panel.runAction(bd, bindFb, () => panel.actions.assignAgent(sel.value, m.id), '已绑定')
    }
    bind.appendChild(sel)
    bind.appendChild(bd)
  } else if (!m.boundAgentIds.length) {
    bind.innerHTML += `<div class="d-dim">当前无在线端侧 agent</div>`
  }
}

const memberTaskTab = (panel: PanelController, m: WorldMember) => {
  const task = panel.section('派任务')
  const taskFb = panel.feedback(task)
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
    void panel.runAction(sendBtn, taskFb, () => panel.actions.createTask(m.id, t, i), '任务已入队').then(ok => {
      if (ok) {
        titleIn.value = ''
        instrTa.value = ''
      }
    })
  }
  task.appendChild(titleIn)
  task.appendChild(instrTa)
  task.appendChild(sendBtn)
}

/** 外观自定义面板：改动即在地图上实时预览，点"保存外观"才落库 */
const appearanceSection = (panel: PanelController, m: WorldMember) => {
  const sec = panel.section('外观自定义')
  const fb = panel.feedback(sec)
  const draft: AppearanceDraft = {
    skin: m.skin,
    tint: m.tint,
    scale: m.scale > 0 ? m.scale : 1,
    aura: m.aura,
  }
  const preview = () => panel.actions.previewAppearance(m.id, { ...draft })

  const subtitle = (text: string) => {
    const t = document.createElement('div')
    t.className = 'd-sub'
    t.textContent = text
    sec.appendChild(t)
  }

  let refreshSkinSel: () => void = () => undefined
  if (m.role === 'member') {
    subtitle('皮肤')
    const skinBtns: Array<[HTMLButtonElement, string]> = []
    const row = document.createElement('div')
    row.className = 'd-swatches'
    for (const key of ['', ...MEMBER_SKINS]) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'd-btn'
      b.style.margin = '0'
      b.textContent = key === '' ? '默认' : SKIN_LABELS[key] || key
      b.onclick = () => {
        draft.skin = key
        refreshSkinSel()
        preview()
      }
      skinBtns.push([b, key])
      row.appendChild(b)
    }
    refreshSkinSel = () => {
      for (const [b, key] of skinBtns) b.style.borderColor = draft.skin === key ? '#f0c060' : ''
    }
    refreshSkinSel()
    sec.appendChild(row)
  }

  const colorRow = (
    label: string,
    presets: string[],
    getValue: () => string,
    setValue: (v: string) => void,
  ): (() => void) => {
    subtitle(label)
    const row = document.createElement('div')
    row.className = 'd-swatches'
    const swatches: Array<[HTMLButtonElement, string]> = []
    const none = document.createElement('button')
    none.type = 'button'
    none.className = 'd-swatch none'
    none.textContent = '无'
    none.onclick = () => {
      setValue('')
      refreshSel()
      preview()
    }
    row.appendChild(none)
    swatches.push([none, ''])
    for (const color of presets) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'd-swatch'
      b.style.background = color
      b.title = color
      b.onclick = () => {
        setValue(color)
        refreshSel()
        preview()
      }
      row.appendChild(b)
      swatches.push([b, color])
    }
    const custom = document.createElement('input')
    custom.type = 'color'
    custom.className = 'd-color'
    custom.title = '自定义颜色'
    custom.value = /^#[0-9a-fA-F]{6}$/.test(getValue()) ? getValue() : '#ffffff'
    custom.oninput = () => {
      setValue(custom.value)
      refreshSel()
      preview()
    }
    row.appendChild(custom)
    const refreshSel = () => {
      const v = getValue()
      let hit = false
      for (const [b, color] of swatches) {
        const sel = v === color
        b.classList.toggle('sel', sel)
        hit = hit || sel
      }
      custom.classList.toggle('sel', !hit && !!v)
      if (/^#[0-9a-fA-F]{6}$/.test(v)) custom.value = v
    }
    refreshSel()
    sec.appendChild(row)
    return refreshSel
  }

  const refreshTintSel = colorRow('调色（整体色调）', TINT_PRESETS, () => draft.tint, v => (draft.tint = v))
  const refreshAuraSel = colorRow('光环（脚下发光）', AURA_PRESETS, () => draft.aura, v => (draft.aura = v))

  subtitle('体型')
  const scaleWrap = document.createElement('div')
  scaleWrap.className = 'd-swatches'
  const slider = document.createElement('input')
  slider.type = 'range'
  slider.className = 'd-range'
  slider.min = '0.7'
  slider.max = '1.4'
  slider.step = '0.05'
  slider.value = String(draft.scale)
  slider.style.flex = '1'
  const scaleVal = document.createElement('span')
  scaleVal.className = 'd-dim'
  scaleVal.style.minWidth = '40px'
  const refreshScale = () => (scaleVal.textContent = `${draft.scale.toFixed(2)}x`)
  refreshScale()
  slider.oninput = () => {
    draft.scale = Number(slider.value) || 1
    refreshScale()
    preview()
  }
  scaleWrap.appendChild(slider)
  scaleWrap.appendChild(scaleVal)
  sec.appendChild(scaleWrap)

  const btnRow = document.createElement('div')
  btnRow.style.marginTop = '8px'
  const save = document.createElement('button')
  save.type = 'button'
  save.className = 'd-btn ok'
  save.textContent = '保存外观'
  save.onclick = () =>
    void panel.runAction(save, fb, () => panel.actions.setAppearance(m.id, { ...draft }), '外观已保存')
  const reset = document.createElement('button')
  reset.type = 'button'
  reset.className = 'd-btn'
  reset.textContent = '恢复默认'
  reset.onclick = () => {
    draft.skin = ''
    draft.tint = ''
    draft.scale = 1
    draft.aura = ''
    refreshSkinSel()
    refreshTintSel()
    refreshAuraSel()
    slider.value = '1'
    refreshScale()
    preview()
    void panel.runAction(reset, fb, () => panel.actions.setAppearance(m.id, { ...draft }), '已恢复默认')
  }
  btnRow.appendChild(save)
  btnRow.appendChild(reset)
  sec.appendChild(btnRow)
  const hint = document.createElement('div')
  hint.className = 'd-dim'
  hint.textContent = '改动会立即在地图上预览，保存后永久生效'
  sec.appendChild(hint)
}
