import type { WorldSnapshot } from '../../world/store'
import type { PortraitSpec } from '../portrait'
import { esc } from './dom'
import type { PanelController } from './types'

export const openLibraryPanel = (
  panel: PanelController,
  snap: WorldSnapshot,
  portrait?: PortraitSpec | null,
) => {
  panel.openPanel({
    title: '传承知识库',
    subtitle: '图书馆',
    portrait,
    tabs: [
      {
        name: '概览',
        build: () => {
          const stat = panel.section('概览')
          panel.rows(stat, [
            ['知识', `${snap.knowledgeActive} 条生效`],
          ])
        },
      },
      {
        name: '已生效知识',
        build: host => {
          if (!snap.knowledgeItems.length) {
            host.innerHTML = `<div class="d-dim">暂无已生效知识</div>`
            return
          }
          const cols = document.createElement('div')
          cols.className = 'gp-cols'
          for (const k of snap.knowledgeItems) {
            const item = document.createElement('div')
            item.className = 'd-item'
            const scope = k.scope === 'global' ? '全局' : `${k.scope}${k.scope_target ? `:${k.scope_target}` : ''}`
            const triggers = Array.isArray(k.triggers) && k.triggers.length ? `触发词：${k.triggers.join('、')}` : ''
            const body = String(k.body || k.summary || '')
            item.innerHTML =
              `<div>${esc(k.title || k.memory_id)}</div>` +
              `<div class="d-dim">${esc(scope)} · 置信度 ${Number(k.confidence || 0).toFixed(2)} · 使用 ${Number(k.use_count || 0)} 次</div>` +
              (triggers ? `<div class="d-dim">${esc(triggers)}</div>` : '') +
              (k.summary ? `<div class="d-dim">${esc(k.summary)}</div>` : '') +
              (body ? `<div class="d-pre">${esc(body)}</div>` : '<div class="d-dim">无正文</div>')
            cols.appendChild(item)
          }
          host.appendChild(cols)
        },
      },
    ],
  })
}

export const openSpawnPanel = (
  panel: PanelController,
  snap: WorldSnapshot,
  portrait?: PortraitSpec | null,
) => {
  const idle = snap.members.filter(
    m => m.lifecycle !== 'dead' && (!m.projectId || m.lifecycle === 'learning') &&
      m.role === 'member' && !m.boundAgentIds.length,
  )
  panel.openPanel({
    title: '出生地',
    subtitle: `${idle.length} 位待分配`,
    portrait,
    tabs: [
      {
        name: '待分配成员',
        build: host => {
          if (!idle.length) {
            host.innerHTML = `<div class="d-dim">没有闲置成员；新成员请到主控制台创建</div>`
            return
          }
          const cols = document.createElement('div')
          cols.className = 'gp-cols'
          for (const m of idle) {
            const item = document.createElement('div')
            item.className = 'd-item click'
            item.innerHTML = `<div>${esc(m.name)} · 第 ${m.generation} 代</div><div class="d-dim">${esc(m.currentBehavior || m.lifecycle)}</div>`
            item.onclick = () => panel.actions.focusMember(m.id)
            cols.appendChild(item)
          }
          host.appendChild(cols)
        },
      },
    ],
  })
}
