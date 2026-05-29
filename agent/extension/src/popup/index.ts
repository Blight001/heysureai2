// popup/index.ts — HeySure Agent popup entry / orchestrator.
// Two modes (both retained):
//   1. Browser-Agent: socket connection managed by the background worker.
//   2. Software-end client: logged-in account → AI members, chat, task scheduling.
// Feature logic lives in sibling modules (state, dom, ui, members, chat, tasks,
// cards, settings); this file owns the background port dispatch, startup flow
// and listener wiring.

import { BgMsg } from '../lib/types'
import { state } from './state'
import * as dom from './dom'
import { getAuth, saveAuth, getSettings } from '../lib/storage'
import { getMe, isAuthError } from '../lib/client'
import { renderChatFrame } from './markdown'
import { syncSelectedAiToBackground, useServerChat } from './helpers'
import {
  setStatus, addEntry, updateUserChip, updateOfflineUi, switchTab, wireUi,
} from './ui'
import {
  appendChatMsg, setBubble, setChatBusy, syncChatHistory,
  renderChatHistory, restoreChatHistory, updateChatSessionControls,
  refreshServerSessionsAndHistory, wireChat,
} from './chat'
import { loadMembers, doLogout, wireMembers } from './members'
import { wireTasks } from './tasks'
import { renderCards, wireCards } from './cards'
import { loadSettings, wireSettings } from './settings'

// ── Port & background messages ────────────────────────────────────────────
function initPort() {
  state.port = chrome.runtime.connect({ name: 'popup' })

  state.port.onMessage.addListener((msg: BgMsg) => {
    switch (msg.type) {
      case 'agent:status':
        setStatus(msg.status)
        break
      case 'activity:log':
        addEntry(msg.entry)
        break
      case 'task:start':
        addEntry({ id: msg.data.taskId, type: 'task', status: 'running', message: `执行: ${msg.data.tool}`, data: msg.data.args, timestamp: msg.data.timestamp })
        break
      case 'task:result':
        addEntry({ id: msg.data.taskId + '_r', type: 'task', status: msg.data.success ? 'success' : 'error', message: `${msg.data.success?'完成':'失败'}: ${msg.data.tool}`, data: msg.data.result, timestamp: msg.data.timestamp })
        break
      case 'settings:data':
        loadSettings(msg.settings)
        break
      case 'chat:response': {
        if (msg.requestId !== state.activeChatRequestId) break
        const thinking = (window as any)._chatThinking as HTMLElement | undefined
        if (!thinking) { state.activeChatRequestId = null; setChatBusy(false); break }
        thinking?.remove()
        ;(window as any)._chatThinking = null
        state.activeChatRequestId = null
        setChatBusy(false)
        const reply = msg.text || '完成'
        state.chatHistory.push({ role: 'assistant', content: reply })
        const el = appendChatMsg('ai', '', state.chatHistory.length - 1)
        setBubble(el, renderChatFrame(reply, { toolsUsed: msg.toolsUsed || [], events: msg.toolEvents || [] }))
        void syncChatHistory()
        if (msg.toolsUsed?.length) {
          addEntry({ id: Date.now().toString(), type: 'task', status: 'success', message: `AI 使用工具: ${msg.toolsUsed.join(', ')}`, timestamp: Date.now() })
        }
        break
      }
      case 'chat:error': {
        if (msg.requestId !== state.activeChatRequestId) break
        const thinking = (window as any)._chatThinking as HTMLElement | undefined
        if (!thinking) { state.activeChatRequestId = null; setChatBusy(false); break }
        thinking?.remove()
        ;(window as any)._chatThinking = null
        state.activeChatRequestId = null
        setChatBusy(false)
        const errorText = `⚠ 错误: ${msg.error}`
        state.chatHistory.push({ role: 'assistant', content: errorText })
        appendChatMsg('ai', errorText, state.chatHistory.length - 1)
        void syncChatHistory()
        break
      }
      case 'connection:result': {
        const r = msg.result || {}
        const http = r.http || (typeof r.status !== 'undefined' ? r : null)
        const lines: string[] = []
        if (http) {
          lines.push(http.success
            ? `HTTP ✓ ${http.status} · ${http.ms}ms`
            : `HTTP ✗ ${http.error}`)
        }
        if (Array.isArray(r.agentProbes) && r.agentProbes.length) {
          for (const p of r.agentProbes) {
            lines.push(p.ok ? `Agent ✓ ${p.url}` : `Agent ✗ ${p.url} — ${p.reason || ''}`)
          }
          if (r.agentOkUrl) lines.push(`将连接到：${r.agentOkUrl}`)
        } else if (r.needsLogin) {
          lines.push('Agent: 未登录，跳过探测')
        }
        const ok = !!(http?.success && (!r.agentProbes?.length || r.agentOkUrl))
        dom.testResult.textContent = lines.join('\n') || (ok ? '✓ 已连接' : '✗ 未连接')
        dom.testResult.className = `test-result ${ok ? 'ok' : 'fail'}`
        ;(dom.testResult as HTMLElement).style.whiteSpace = 'pre-line'
        break
      }
      case 'card:progress': {
        dom.cardsRunStatus.textContent = `执行中 [${msg.index + 1}/${msg.total}] ${msg.note}`
          + (msg.status === 'error' ? ` ✗ ${msg.error || ''}` : msg.status === 'success' ? ' ✓' : '')
        const row = document.getElementById(`step-${msg.cardId}-${msg.index}`)
        if (row) {
          row.classList.remove('cur', 'ok', 'err')
          row.classList.add(msg.status === 'success' ? 'ok' : msg.status === 'error' ? 'err' : 'cur')
        }
        break
      }
      case 'card:done': {
        state.runningCardId = null
        dom.cardsRunStatus.textContent = msg.success
          ? '✓ 卡片执行完成'
          : (msg.reason === 'stopped' ? '已停止' : `✗ 执行失败：${msg.reason || ''}`)
        void renderCards()
        break
      }
    }
  })

  state.port.onDisconnect.addListener(() => { setTimeout(initPort, 1000) })
  state.port.postMessage({ type: 'settings:get' })
}

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  initPort()
  switchTab('chat')
  // Load server URL up front so auth-dependent calls have a base before the
  // port's settings:data round-trip arrives.
  const s = await getSettings()
  state.serverUrl = s.serverUrl || ''
  state.offlineMode = !!s.offlineMode
  state.localModel = s.aiModel || ''
  state.selectedMemberId = s.selectedAiConfigId || null
  state.auth = await getAuth()
  dom.loginAccount.value = state.auth.account || ''
  updateUserChip()
  updateOfflineUi()
  void restoreChatHistory()
  if (state.auth.token) {
    // Validate token in the background and refresh members.
    void (async () => {
      try {
        const me = await getMe(state.serverUrl, state.auth.token)
        state.auth.userName = me?.name || state.auth.userName
        state.auth.avatar = me?.avatar || ''
        await saveAuth({ userName: state.auth.userName, avatar: state.auth.avatar })
        updateUserChip()
        renderChatHistory()
        await loadMembers()
        syncSelectedAiToBackground(true)
        if (useServerChat()) await refreshServerSessionsAndHistory()
      } catch (err: any) {
        // Only drop the session on a genuine auth failure. A transient
        // network error / timeout (server briefly down, flaky connection)
        // must NOT wipe a still-valid token — otherwise every popup open
        // during a blip silently logs the user out. Keep the session and
        // make a best-effort refresh; the next successful call recovers.
        if (isAuthError(err)) {
          await doLogout()
        } else {
          console.warn('getMe failed (transient), keeping session', err)
          dom.loginFeedback.textContent = '暂时无法连接服务器，稍后将自动重试'
          dom.loginFeedback.style.color = 'var(--warn)'
          try {
            await loadMembers()
            syncSelectedAiToBackground(true)
            if (useServerChat()) await refreshServerSessionsAndHistory()
          } catch { /* still down — leave session intact */ }
        }
      }
    })()
  }
  updateChatSessionControls()
}

// ── Wiring + startup ─────────────────────────────────────────────────────
wireUi()
wireMembers()
wireChat()
wireTasks()
wireCards()
wireSettings()

// Pending chat text from context menu
chrome.storage.session.get('_pendingChat').then(r => {
  if (r._pendingChat) {
    chrome.storage.session.remove('_pendingChat')
    switchTab('chat')
    dom.chatInput.value = String(r._pendingChat)
  }
}).catch(() => {})

void init()
