import type { WorldSnapshot } from '../../world/store'
import type { PortraitSpec } from '../portrait'
import { esc } from './dom'
import type { PanelController } from './types'

export const openWorkshopPanel = (
  panel: PanelController,
  deviceId: string,
  snap: WorldSnapshot,
  portrait?: PortraitSpec | null,
) => {
  const w = snap.workshops.find(x => x.deviceId === deviceId)
  if (!w) return
  const typeTitle = w.type === 'desktop'
    ? '机械坊（桌面 Agent）'
    : w.type === 'browser'
      ? '瞭望塔（浏览器 Agent）'
      : w.type === 'android'
        ? '移动工坊（安卓端）'
        : '图书馆'
  panel.openPanel({
    title: `${typeTitle} · ${w.name}`,
    subtitle: w.lifecycle === 'dispatching' ? '执行中' : '在线',
    portrait,
    tabs: [
      {
        name: '设备',
        build: () => {
          const info = panel.section('设备')
          panel.rows(info, [
            ['名称', w.name],
            ['平台', w.platform || 'unknown'],
            ['状态', w.lifecycle === 'dispatching' ? '执行中' : '在线'],
            ['工具', `${w.capabilities} 个端侧工具`],
            ['错误', w.lastError || ''],
          ])
        },
      },
      {
        name: '分配成员',
        build: () => {
          const assign = panel.section('分配成员')
          const fb = panel.feedback(assign)
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
            void panel.runAction(btn, fb, () => panel.actions.assignAgent(w.deviceId, v), v === null ? '已解绑' : '已分配')
          }
          assign.appendChild(sel)
          assign.appendChild(btn)
          if (bound) {
            const hint = document.createElement('div')
            hint.className = 'd-dim'
            hint.textContent = `当前成员：${bound.name}（点击地图上的成员可查看详情）`
            assign.appendChild(hint)
          }
        },
      },
      { name: 'MCP 权限', build: () => mcpScopeSection(panel, w.deviceId) },
    ],
  })
}

const mcpScopeSection = (panel: PanelController, deviceId: string) => {
  const sec = panel.section('Agent MCP 权限')
  const fb = panel.feedback(sec)
  fb.className = 'd-dim'
  fb.textContent = '加载中…'
  void panel.actions.loadDeviceMcpScope(deviceId).then(scope => {
    sec.innerHTML = '<div class="d-sec-title">Agent MCP 权限</div>'
    const info = document.createElement('div')
    info.className = 'd-dim'
    info.textContent = scope.hasRecord ? '已保存自定义权限范围' : '默认允许当前 Agent 宣告的全部 MCP 工具'
    sec.appendChild(info)
    const saveFb = panel.feedback(sec)
    if (!scope.capabilities.length) {
      saveFb.className = 'd-dim'
      saveFb.textContent = '该 Agent 当前没有上报 MCP 工具'
      return
    }
    const selected = new Set(scope.hasRecord ? scope.allowed : scope.capabilities)
    const boxes: HTMLInputElement[] = []
    for (const tool of scope.capabilities) {
      const label = document.createElement('label')
      label.className = 'd-check'
      const box = document.createElement('input')
      box.type = 'checkbox'
      box.checked = selected.has(tool)
      box.onchange = () => {
        if (box.checked) selected.add(tool)
        else selected.delete(tool)
      }
      boxes.push(box)
      const span = document.createElement('span')
      span.textContent = tool
      label.appendChild(box)
      label.appendChild(span)
      sec.appendChild(label)
    }
    const all = document.createElement('button')
    all.type = 'button'
    all.className = 'd-btn'
    all.textContent = '全选'
    all.onclick = () => {
      selected.clear()
      for (const tool of scope.capabilities) selected.add(tool)
      boxes.forEach(b => (b.checked = true))
    }
    const none = document.createElement('button')
    none.type = 'button'
    none.className = 'd-btn'
    none.textContent = '清空'
    none.onclick = () => {
      selected.clear()
      boxes.forEach(b => (b.checked = false))
    }
    const save = document.createElement('button')
    save.type = 'button'
    save.className = 'd-btn ok'
    save.textContent = '保存 MCP 权限'
    save.onclick = () =>
      void panel.runAction(save, saveFb, () => panel.actions.saveDeviceMcpScope(deviceId, Array.from(selected)), 'MCP 权限已保存')
    sec.appendChild(all)
    sec.appendChild(none)
    sec.appendChild(save)
  }).catch(err => {
    fb.className = 'd-err'
    fb.textContent = err instanceof Error ? err.message : 'MCP 权限加载失败'
  })
}
