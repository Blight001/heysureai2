// popup/tasks.ts — task scheduling for the selected member: submit a task,
// list existing jobs and pause/resume/stop/delete them. Requires login + a
// selected member (server-backed).

import { state } from './state'
import * as dom from './dom'
import { triggerTask, listTaskJobs, taskJobAction, TaskJob } from '../lib/client'
import { esc } from './markdown'

async function submitTask() {
  if (!state.auth.token || !state.selectedMemberId) return
  const title = dom.taskTitle.value.trim()
  const instruction = dom.taskInstruction.value.trim()
  if (!title) { dom.taskFeedback.textContent = '请输入任务标题'; dom.taskFeedback.style.color = 'var(--error)'; return }
  dom.taskSubmit.disabled = true
  dom.taskFeedback.textContent = '提交中…'
  dom.taskFeedback.style.color = 'var(--muted)'
  const schedEnabled = dom.taskSchedEnabled.checked
  let scheduleAt: number | string | null = null
  if (schedEnabled && dom.taskAt.value) {
    const t = new Date(dom.taskAt.value).getTime()
    if (!Number.isNaN(t)) scheduleAt = Math.floor(t / 1000)
  }
  try {
    const res = await triggerTask(state.serverUrl, state.auth.token, state.selectedMemberId, {
      title,
      instruction,
      priority: Math.max(1, Math.min(10, Number(dom.taskPriority.value) || 5)),
      schedule_enabled: schedEnabled,
      schedule_loop_enabled: schedEnabled && dom.taskLoop.checked,
      schedule_run_immediately: schedEnabled && dom.taskLoop.checked && dom.taskRunNow.checked,
      schedule_duration_minutes: Math.max(1, Number(dom.taskDuration.value) || 30),
      schedule_at: scheduleAt,
      override_mcp_tools_enabled: false,
      mcp_tools_override: [],
    })
    dom.taskFeedback.textContent = `已安排：${res?.title || title} ✓`
    dom.taskFeedback.style.color = 'var(--success)'
    dom.taskTitle.value = ''
    dom.taskInstruction.value = ''
    await loadJobs()
    setTimeout(() => { dom.taskFeedback.textContent = '' }, 2500)
  } catch (err: any) {
    dom.taskFeedback.textContent = `失败：${err?.message || err}`
    dom.taskFeedback.style.color = 'var(--error)'
  } finally {
    dom.taskSubmit.disabled = false
  }
}

export async function loadJobs() {
  if (!state.auth.token || !state.selectedMemberId) return
  dom.jobsEmpty.textContent = '加载中…'
  dom.jobsEmpty.style.display = 'block'
  try {
    const jobs = await listTaskJobs(state.serverUrl, state.auth.token, state.selectedMemberId)
    renderJobs(jobs)
  } catch (err: any) {
    dom.jobsEmpty.textContent = `加载失败：${err?.message || err}`
  }
}
function renderJobs(jobs: TaskJob[]) {
  dom.jobsList.querySelectorAll('.job-card').forEach(e => e.remove())
  if (!jobs.length) { dom.jobsEmpty.style.display = 'block'; dom.jobsEmpty.textContent = '暂无任务'; return }
  dom.jobsEmpty.style.display = 'none'
  for (const j of jobs) {
    const st = String(j.effective_status || j.status || 'queued')
    const el = document.createElement('div')
    el.className = 'job-card'
    const canPause = st === 'queued' || st === 'running'
    const canResume = st === 'paused'
    el.innerHTML = `
      <div class="job-top">
        <span class="job-title">${esc(j.title || '未命名任务')}</span>
        <span class="job-status ${st}">${esc(st)}</span>
      </div>
      <div style="font-size:10px;color:var(--muted)">优先级 ${j.priority ?? 5} · ${esc(j.trigger_type || 'manual')}</div>
      <div class="job-actions">
        ${canPause ? `<button class="mini-btn" data-act="pause">暂停</button>` : ''}
        ${canResume ? `<button class="mini-btn" data-act="resume">继续</button>` : ''}
        <button class="mini-btn" data-act="stop">停止</button>
        <button class="mini-btn danger" data-act="delete">删除</button>
      </div>`
    el.querySelectorAll('button[data-act]').forEach(btn => {
      btn.addEventListener('click', () => void doJobAction(j.job_id, (btn as HTMLElement).dataset.act as any))
    })
    dom.jobsList.appendChild(el)
  }
}
async function doJobAction(jobId: string, action: 'pause' | 'resume' | 'stop' | 'delete') {
  if (!state.auth.token || !state.selectedMemberId) return
  try {
    await taskJobAction(state.serverUrl, state.auth.token, state.selectedMemberId, jobId, action)
    await loadJobs()
  } catch (err: any) {
    dom.taskFeedback.textContent = `操作失败：${err?.message || err}`
    dom.taskFeedback.style.color = 'var(--error)'
  }
}

export function wireTasks() {
  dom.taskSchedEnabled.addEventListener('change', () => {
    dom.taskSchedOpts.style.display = dom.taskSchedEnabled.checked ? 'block' : 'none'
  })
  dom.taskSubmit.addEventListener('click', () => void submitTask())
  dom.jobsRefresh.addEventListener('click', () => void loadJobs())
}
