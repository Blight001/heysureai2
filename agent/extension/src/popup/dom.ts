// popup/dom.ts — cached DOM element references.
// popup.js runs after the document is parsed, so these lookups are resolved
// once at module-evaluation time and reused everywhere.

import { TabName } from './state'

const $ = (id: string) => document.getElementById(id)!

export const statusDot    = $('status-dot')
export const statusLabel  = $('status-label')
export const statusPill   = $('status-pill')
export const themeToggle  = $('theme-toggle')
export const userChip     = $('user-chip')
export const userAva      = $('user-ava')
export const userName     = $('user-name')

export const tabs: Record<TabName, HTMLElement> = {
  chat: $('tab-chat'),
  tasks: $('tab-tasks'), cards: $('tab-cards'), settings: $('tab-settings'),
}
export const panes: Record<TabName, HTMLElement> = {
  chat: $('chat-pane'),
  tasks: $('task-pane'), cards: $('cards-pane'), settings: $('settings-pane'),
}

export const feed         = $('feed')
export const feedEmpty    = $('feed-empty')
export const chatMsgs     = $('chat-messages')
export const chatNoKey    = $('chat-no-key')
export const chatInput    = $('chat-input') as HTMLTextAreaElement
export const chatSendBtn  = $('chat-send') as HTMLButtonElement
export const chatTarget   = $('chat-target')
export const chatTargetText = $('chat-target-text')
export const chatClearBtn = $('chat-clear-btn') as HTMLButtonElement
export const chatSessionSelect = $('chat-session-select') as HTMLSelectElement
export const chatSessionDeleteBtn = $('chat-session-delete-btn') as HTMLButtonElement
export const connectBtn   = $('connect-btn')
export const disconnectBtn = $('disconnect-btn')
export const clearBtn     = $('clear-btn')
export const testConnBtn  = $('test-conn-btn')
export const testResult   = $('test-result')
export const saveFeedback = $('save-feedback')
export const cfgServer    = $('cfg-server')  as HTMLInputElement
export const cfgAgentServer = $('cfg-agent-server') as HTMLInputElement
export const cfgAiKey     = $('cfg-ai-key')  as HTMLInputElement
export const cfgAiBase    = $('cfg-ai-base') as HTMLInputElement
export const cfgAiModel   = $('cfg-ai-model') as HTMLInputElement
export const cfgAutoConn  = $('cfg-auto-connect') as HTMLInputElement
export const cfgOfflineMode = $('cfg-offline-mode') as HTMLInputElement
export const offlineModelConfig = $('offline-model-config')
export const cfgAiProvider  = $('cfg-ai-provider') as HTMLSelectElement
export const cfgMouseFx     = $('cfg-mouse-fx') as HTMLInputElement
export const saveBtn      = $('save-btn') as HTMLButtonElement

// Members
export const loginGate    = $('login-gate')
export const loginModal   = $('login-modal')
export const loginModalClose = $('login-modal-close')
export const membersModal = $('members-modal')
export const membersModalClose = $('members-modal-close')
export const accountCard  = $('account-card')
export const loginAccount = $('login-account') as HTMLInputElement
export const loginPassword = $('login-password') as HTMLInputElement
export const loginBtn     = $('login-btn') as HTMLButtonElement
export const loginFeedback = $('login-feedback')
export const membersRefresh = $('members-refresh')
export const membersList  = $('members-list')
export const membersEmpty = $('members-empty')

// Tasks
export const taskTarget   = $('task-target')
export const taskForm     = $('task-form')
export const taskTitle    = $('task-title') as HTMLInputElement
export const taskInstruction = $('task-instruction') as HTMLTextAreaElement
export const taskPriority = $('task-priority') as HTMLInputElement
export const taskSchedEnabled = $('task-schedule-enabled') as HTMLInputElement
export const taskSchedOpts = $('task-schedule-opts')
export const taskLoop     = $('task-loop-enabled') as HTMLInputElement
export const taskRunNow   = $('task-run-immediately') as HTMLInputElement
export const taskDuration = $('task-duration') as HTMLInputElement
export const taskAt       = $('task-at') as HTMLInputElement
export const taskSubmit   = $('task-submit') as HTMLButtonElement
export const taskFeedback = $('task-feedback')
export const taskJobsCard = $('task-jobs-card')
export const jobsRefresh  = $('jobs-refresh')
export const jobsList     = $('jobs-list')
export const jobsEmpty    = $('jobs-empty')

// Settings extra
export const accountStatusV = $('account-status-v')
export const logoutBtn    = $('logout-btn') as HTMLButtonElement
export const memberSettingsCard = $('member-settings-card')
export const connectionControlCard = $('connection-control-card')
export const memberSettingsBody = $('member-settings-body')

// Cards
export const cardsImportBtn    = $('cards-import-btn')
export const cardsExportAllBtn = $('cards-export-all-btn')
export const cardsImportBox    = $('cards-import-box')
export const cardsImportText   = $('cards-import-text') as HTMLTextAreaElement
export const cardsImportFileBtn = $('cards-import-file-btn')
export const cardsImportFile   = $('cards-import-file') as HTMLInputElement
export const cardsImportConfirm = $('cards-import-confirm')
export const cardsImportFeedback = $('cards-import-feedback')
export const cardsRunStatus    = $('cards-run-status')
export const cardsList         = $('cards-list')
export const cardsEmpty        = $('cards-empty')
export const cardModal         = $('card-modal')
export const cardModalMsg      = $('card-modal-msg')
export const cmMerge           = $('cm-merge')
export const cmReplace         = $('cm-replace')
export const cmSkip            = $('cm-skip')
