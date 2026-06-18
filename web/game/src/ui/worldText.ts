import type { TooltipData } from './overlay'
import type { WorldMember, WorldSnapshot, WorldWorkshop } from '../world/store'

export interface WorkshopTooltipView {
  data: WorldWorkshop
  offlineSince: number | null
}

const MEMBER_ROLE_LABELS: Record<WorldMember['role'], string> = {
  core_admin: '核心管理员',
  assistant_admin: '辅助管理员',
  librarian: '图书管理员',
  member: '数字成员',
}

export const memberTooltipData = (member: WorldMember): TooltipData => {
  const ratio = member.tokenLimit > 0 ? member.tokensUsed / member.tokenLimit : undefined
  return {
    title: member.name,
    badge: `${MEMBER_ROLE_LABELS[member.role]} · 第 ${member.generation} 代`,
    tokenRatio: ratio,
    tokenText: member.tokenLimit > 0 ? `${member.tokensUsed} / ${member.tokenLimit}` : `${member.tokensUsed}（无上限）`,
    rows: [
      { label: '状态', value: member.enabled ? member.lifecycle : '已停用' },
      { label: '行为', value: member.currentBehavior },
      { label: '任务', value: member.taskTitle ? `${member.taskTitle}（${member.taskStatus}）` : '' },
      { label: '工具', value: member.runtimeStatus === 'running' ? member.runtimeTool : '' },
      { label: '项目', value: member.projectName },
      { label: '模型', value: member.model },
      { label: '端侧', value: member.boundAgentIds.join(', ') },
    ],
  }
}

export const workshopTooltipData = (
  view: WorkshopTooltipView,
  boundMember: WorldMember | undefined,
): TooltipData => {
  const workshop = view.data
  if (workshop.type === 'workshop') {
    return {
      title: '知识工坊（知识与进化）',
      badge: view.offlineSince !== null ? '离线' : '在线',
      rows: [
        { label: '形态', value: '服务端内置 · 自动上线' },
        { label: '成员', value: boundMember ? `${boundMember.name}（ID ${boundMember.id}）` : '未绑定（拖成员到此绑定）' },
        { label: '说明', value: '只能绑定一个数字成员，新绑定会替换旧绑定' },
        { label: '工具', value: `${workshop.capabilities} 个知识/进化工具` },
        { label: '错误', value: workshop.lastError || '' },
      ],
    }
  }
  return {
    title: workshop.type === 'desktop' ? '机械坊（桌面 Agent）' : '瞭望塔（浏览器 Agent）',
    badge: view.offlineSince !== null ? '离线' : workshop.lifecycle === 'dispatching' ? '执行中' : '在线',
    rows: [
      { label: '设备', value: `${workshop.name}（${workshop.platform || 'unknown'}）` },
      { label: '成员', value: boundMember ? `${boundMember.name}（ID ${boundMember.id}）` : '未分配' },
      { label: '工具', value: `${workshop.capabilities} 个端侧工具` },
      { label: '错误', value: workshop.lastError || '' },
    ],
  }
}

export const buildingTooltipData = (
  key: string,
  label: string,
  snap: WorldSnapshot | null,
): TooltipData => {
  const rows: { label: string; value: string }[] = []
  if (snap) {
    if (key === 'library') {
      rows.push({ label: '知识', value: `${snap.knowledgeActive} 条生效` })
      rows.push({ label: '待审批', value: snap.knowledgePending > 0 ? `${snap.knowledgePending} 条沉淀申请` : '无' })
    } else if (key === 'spawn') {
      const idle = snap.members.filter(
        member => member.lifecycle !== 'dead' && (!member.projectId || member.lifecycle === 'learning'),
      ).length
      rows.push({ label: '待分配', value: `${idle} 位成员` })
    }
  }
  return { title: label, rows }
}

export const hudHtml = (snap: WorldSnapshot, clock: string): string => {
  if (!snap.authOk) return `<div class="h-err">${snap.lastError || '连接中…'}</div>`

  const alive = snap.members.filter(member => member.lifecycle !== 'dead').length
  const online = snap.workshops.length
  const running = snap.members.filter(member => member.runtimeStatus === 'running' || member.taskStatus === 'running').length
  return (
    `<div>存活成员 <b>${alive}</b> · 在线作坊 <b>${online}</b> · 干活中 <b>${running}</b></div>` +
    `<div>知识 <b>${snap.knowledgeActive}</b>` +
    (snap.knowledgePending > 0 ? ` · <span class="h-err">待审批 ${snap.knowledgePending}</span>` : '') +
    `</div>` +
    `<div class="h-dim">🕐 ${clock}</div>`
  )
}
