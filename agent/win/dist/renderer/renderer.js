// renderer.ts — HeySure Agent renderer process
// ── State ──────────────────────────────────────────────────────────────────
let currentTheme = 'dark';
let totalTasks = 0, successTasks = 0, failedTasks = 0, runningTasks = 0;
let chatHistory = [];
let chatBusy = false;
let hasAiKey = false;
let activeTab = 'feed';
// ── Screen navigation ──────────────────────────────────────────────────────
function showScreen(screen) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(`screen-${screen}`)?.classList.add('active');
}
// ── DOM refs (main screen) ─────────────────────────────────────────────────
const feed = document.getElementById('feed');
const feedEmpty = document.getElementById('feed-empty');
const feedPane = document.getElementById('feed-pane');
const chatPane = document.getElementById('chat-pane');
const chatMessages = document.getElementById('chat-messages');
const chatNoKey = document.getElementById('chat-no-key');
const chatInput = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('chat-send');
const tabFeed = document.getElementById('tab-feed');
const tabChat = document.getElementById('tab-chat');
const statusDot = document.getElementById('status-dot');
const statusLabel = document.getElementById('status-label');
const infoStatus = document.getElementById('info-status');
const infoServer = document.getElementById('info-server');
const infoWorkspace = document.getElementById('info-workspace');
const statTasks = document.getElementById('stat-tasks');
const statSuccess = document.getElementById('stat-success');
const statFailed = document.getElementById('stat-failed');
const statRunning = document.getElementById('stat-running');
const cfgAiKey = document.getElementById('cfg-ai-key');
const cfgAiBaseUrl = document.getElementById('cfg-ai-base-url');
const cfgAiModel = document.getElementById('cfg-ai-model');
const cfgWorkspace = document.getElementById('cfg-workspace');
const saveBtn = document.getElementById('save-btn');
const saveFeedback = document.getElementById('save-feedback');
const connectBtn = document.getElementById('connect-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const clearBtn = document.getElementById('clear-btn');
const themeToggle = document.getElementById('theme-toggle');
const testConnBtn = document.getElementById('test-conn-btn');
const testResult = document.getElementById('test-result');
const aiHeaderChip = document.getElementById('ai-header-chip');
const aiInfoName = document.getElementById('ai-info-name');
const aiInfoRole = document.getElementById('ai-info-role');
const aiInfoLifecycle = document.getElementById('ai-info-lifecycle');
const aiInfoProject = document.getElementById('ai-info-project');
const STATUS_LABELS = {
    disconnected: '未连接', connecting: '连接中...', connected: '已连接', registered: '已注册', error: '连接错误',
};
// ── Theme ──────────────────────────────────────────────────────────────────
function applyTheme(theme, persist = true) {
    currentTheme = theme;
    document.body.className = theme;
    const icon = theme === 'dark' ? '&#x2600;&#xFE0F;' : '&#x1F319;';
    [document.getElementById('theme-toggle'), document.getElementById('theme-toggle2')].forEach(el => { if (el) el.innerHTML = icon; });
    if (persist) window.heysureAPI.setTheme(theme);
}
;[document.getElementById('theme-toggle'), document.getElementById('theme-toggle2')].forEach(btn =>
    btn?.addEventListener('click', () => applyTheme(currentTheme === 'dark' ? 'light' : 'dark'))
);
// ── Tab switching ──────────────────────────────────────────────────────────
function switchTab(tab) {
    activeTab = tab;
    tabFeed.classList.toggle('active', tab === 'feed');
    tabChat.classList.toggle('active', tab === 'chat');
    feedPane.classList.toggle('hidden', tab !== 'feed');
    chatPane.classList.toggle('active', tab === 'chat');
    if (tab === 'chat') chatMessages.scrollTop = chatMessages.scrollHeight;
}
tabFeed.addEventListener('click', () => switchTab('feed'));
tabChat.addEventListener('click', () => switchTab('chat'));
// ── Status display ─────────────────────────────────────────────────────────
function setStatus(status) {
    const label = STATUS_LABELS[status] || status;
    statusDot.className = status;
    statusLabel.textContent = label;
    infoStatus.textContent = label;
    infoStatus.className = `info-value ${status}`;
}
function updateStats() {
    statTasks.textContent = String(totalTasks);
    statSuccess.textContent = String(successTasks);
    statFailed.textContent = String(failedTasks);
    statRunning.textContent = String(runningTasks);
}
// ── Helpers ────────────────────────────────────────────────────────────────
function formatTime(ts) {
    const d = new Date(ts);
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
}
function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function lifecycleLabel(lc) {
    return ({ learning: '学习中', working: '工作中', reproducing: '繁殖中', dead: '退役' })[lc] || lc;
}
// ── Activity feed ──────────────────────────────────────────────────────────
function addEntry(entry) {
    feedEmpty.style.display = 'none';
    const el = document.createElement('div');
    el.className = 'entry';
    const iconCls = (() => {
        if (entry.status === 'success') return 'success';
        if (entry.status === 'error') return 'error';
        if (entry.status === 'running') return 'running';
        if (entry.status === 'warn') return 'warn';
        if (entry.type === 'system') return 'system';
        return 'info';
    })();
    const badgeCls = ({ task: 'task', system: 'system', error: 'error', warn: 'warn' })[entry.type] || 'info';
    const icon = ({ success: '✓', error: '✗', running: '▶', warn: '⚠', system: '●' })[entry.status] || 'ℹ';
    let dataHtml = '';
    if (entry.data !== undefined && entry.data !== null) {
        const s = typeof entry.data === 'string' ? entry.data : JSON.stringify(entry.data, null, 2);
        dataHtml = `<button class="entry-data-toggle" onclick="toggleData(this)"><span class="arrow">&#x25B6;</span> 详情</button><div class="entry-data"><pre>${escapeHtml(s)}</pre></div>`;
    }
    let badgeHtml = '';
    if (entry.status === 'success' || entry.status === 'error' || entry.status === 'running') {
        const bLabel = entry.status === 'success' ? '成功' : entry.status === 'error' ? '失败' : '进行中';
        badgeHtml = `<span class="entry-status-badge ${entry.status}">${bLabel}</span>`;
    }
    el.innerHTML = `
    <div class="entry-icon ${iconCls}">${icon}</div>
    <div class="entry-body">
      <div class="entry-top"><span class="entry-type ${badgeCls}">${entry.type}</span><span class="entry-time">${formatTime(entry.timestamp)}</span></div>
      <div class="entry-message">${escapeHtml(entry.message)}</div>
      ${badgeHtml}${dataHtml}
    </div>`;
    feed.appendChild(el);
    feed.scrollTop = feed.scrollHeight;
}
window.toggleData = function (btn) {
    btn.classList.toggle('open');
    btn.nextElementSibling?.classList.toggle('visible');
};
// ── Chat UI ────────────────────────────────────────────────────────────────
function renderMd(text) {
    return escapeHtml(text).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\n/g, '<br>');
}
function appendChatMsg(role, content) {
    chatNoKey.style.display = 'none';
    const el = document.createElement('div');
    el.className = `chat-msg ${role}`;
    el.innerHTML = `<div class="chat-avatar">${role === 'ai' ? '&#x2728;' : '&#x1F464;'}</div><div class="chat-bubble">${renderMd(content)}</div>`;
    chatMessages.appendChild(el);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return el;
}
function appendThinking() {
    chatNoKey.style.display = 'none';
    const el = document.createElement('div');
    el.className = 'chat-msg ai'; el.id = 'chat-thinking';
    el.innerHTML = `<div class="chat-avatar">&#x2728;</div><div class="chat-bubble"><div class="chat-thinking"><div class="chat-thinking-dot"></div><div class="chat-thinking-dot"></div><div class="chat-thinking-dot"></div></div></div>`;
    chatMessages.appendChild(el);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return el;
}
function updateChatKeyVisibility() {
    chatNoKey.style.display = (!hasAiKey && chatHistory.length === 0) ? 'flex' : 'none';
    chatInput.disabled = !hasAiKey;
    chatSendBtn.disabled = !hasAiKey;
}
async function sendChat() {
    if (chatBusy || !hasAiKey) return;
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = ''; chatInput.style.height = 'auto';
    chatBusy = true; chatSendBtn.disabled = true;
    chatHistory.push({ role: 'user', content: text });
    appendChatMsg('user', text);
    const thinkEl = appendThinking();
    try {
        const reply = await window.heysureAPI.sendChat(chatHistory);
        thinkEl.remove();
        chatHistory.push({ role: 'assistant', content: reply });
        appendChatMsg('ai', reply);
    }
    catch (err) {
        thinkEl.remove();
        appendChatMsg('ai', `⚠ 错误: ${err.message || String(err)}`);
    }
    finally {
        chatBusy = false; chatSendBtn.disabled = !hasAiKey; chatInput.focus();
    }
}
chatSendBtn.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } });
chatInput.addEventListener('input', () => { chatInput.style.height = 'auto'; chatInput.style.height = Math.min(chatInput.scrollHeight, 110) + 'px'; });
// ── Settings ───────────────────────────────────────────────────────────────
async function loadMainSettings() {
    const s = await window.heysureAPI.getSettings();
    cfgAiKey.value = s.aiKey || '';
    cfgAiBaseUrl.value = s.aiBaseUrl || '';
    cfgAiModel.value = s.aiModel || '';
    cfgWorkspace.value = s.workspaceRoot || '';
    infoServer.textContent = s.serverUrl || '—';
    infoWorkspace.textContent = s.workspaceRoot ? (s.workspaceRoot.split(/[/\\]/).pop() || s.workspaceRoot) : '—';
    hasAiKey = !!(s.aiKey?.trim());
    updateChatKeyVisibility();
    if (s.selectedAiConfigName) updateAiMemberDisplay(s);
    return s;
}
function updateAiMemberDisplay(s) {
    const isManager = s.selectedAiConfigRole === 'manager';
    const name = s.selectedAiConfigName || '—';
    aiInfoName.textContent = name;
    aiInfoRole.textContent = isManager ? '组长 (Manager)' : '成员 (Member)';
    aiInfoLifecycle.textContent = lifecycleLabel(s.selectedAiConfigLifecycle);
    aiInfoProject.textContent = s.selectedAiConfigProject || '—';
    aiHeaderChip.textContent = (isManager ? '★ ' : '') + name;
    aiHeaderChip.className = `ai-header-chip${isManager ? ' manager' : ''}`;
}
async function saveSettings() {
    const settings = {
        workspaceRoot: cfgWorkspace.value.trim(),
        aiKey: cfgAiKey.value.trim(),
        aiBaseUrl: cfgAiBaseUrl.value.trim() || 'https://api.anthropic.com',
        aiModel: cfgAiModel.value.trim() || 'claude-sonnet-4-5',
    };
    try {
        await window.heysureAPI.saveSettings(settings);
        infoWorkspace.textContent = settings.workspaceRoot ? (settings.workspaceRoot.split(/[/\\]/).pop() || settings.workspaceRoot) : '—';
        hasAiKey = !!(settings.aiKey);
        updateChatKeyVisibility();
        saveFeedback.style.color = ''; saveFeedback.textContent = '已保存 ✓';
        setTimeout(() => { saveFeedback.textContent = ''; }, 2000);
    }
    catch {
        saveFeedback.textContent = '保存失败'; saveFeedback.style.color = 'var(--error)';
        setTimeout(() => { saveFeedback.textContent = ''; saveFeedback.style.color = ''; }, 3000);
    }
}
saveBtn.addEventListener('click', saveSettings);
testConnBtn.addEventListener('click', async () => {
    testResult.textContent = '测试中...'; testResult.className = 'test-result';
    testConnBtn.setAttribute('disabled', 'true');
    try {
        const r = await window.heysureAPI.testConnection();
        testResult.textContent = r.success ? `✓ 连接成功 (${r.status}) · ${r.ms}ms` : `✗ ${r.error}`;
        testResult.className = `test-result ${r.success ? 'success' : 'error'}`;
    }
    catch (err) {
        testResult.textContent = `✗ ${err.message}`; testResult.className = 'test-result error';
    }
    finally { testConnBtn.removeAttribute('disabled'); }
});
connectBtn.addEventListener('click', () => window.heysureAPI.connect());
disconnectBtn.addEventListener('click', () => window.heysureAPI.disconnect());
clearBtn.addEventListener('click', () => {
    feed.querySelectorAll('.entry').forEach(e => e.remove());
    feedEmpty.style.display = 'flex';
    totalTasks = 0; successTasks = 0; failedTasks = 0; runningTasks = 0; updateStats();
});
window.heysureAPI.onStatusChange(setStatus);
window.heysureAPI.onActivityLog(addEntry);
window.heysureAPI.onTaskStart((data) => {
    totalTasks++; runningTasks++; updateStats();
    addEntry({ id: data.taskId, type: 'task', status: 'running', message: `执行工具: ${data.tool}`, data: data.args && Object.keys(data.args).length > 0 ? data.args : undefined, timestamp: data.timestamp || Date.now() });
});
window.heysureAPI.onTaskResult((data) => {
    runningTasks = Math.max(0, runningTasks - 1);
    data.success ? successTasks++ : failedTasks++;
    updateStats();
    addEntry({ id: data.taskId + '_result', type: 'task', status: data.success ? 'success' : 'error', message: `${data.success ? '完成' : '失败'}: ${data.tool}`, data: data.result ?? undefined, timestamp: data.timestamp || Date.now() });
});
// ══════════════════════════════════════════════════════
// SCREEN 1: LOGIN
// ══════════════════════════════════════════════════════
const loginServerInput = document.getElementById('login-server');
const loginAccountInput = document.getElementById('login-account');
const loginPasswordInput = document.getElementById('login-password');
const loginBtn = document.getElementById('login-btn');
const loginError = document.getElementById('login-error');
function showLoginError(msg) { loginError.textContent = msg; loginError.classList.add('visible'); }
function clearLoginError() { loginError.classList.remove('visible'); }
async function doLogin() {
    clearLoginError();
    const serverUrl = loginServerInput.value.trim();
    const account = loginAccountInput.value.trim();
    const password = loginPasswordInput.value;
    if (!serverUrl) { showLoginError('请输入服务器地址'); return; }
    if (!account) { showLoginError('请输入账号'); return; }
    if (!password) { showLoginError('请输入密码'); return; }
    loginBtn.classList.add('loading'); loginBtn.disabled = true;
    try {
        await window.heysureAPI.login({ serverUrl, account, password });
        const s = await window.heysureAPI.getSettings();
        setUserChip(s.userAccount, s.serverUrl);
        await loadAiSelectScreen();
        showScreen('ai-select');
    }
    catch (err) {
        showLoginError(err.message || '登录失败');
    }
    finally {
        loginBtn.classList.remove('loading'); loginBtn.disabled = false;
    }
}
loginBtn.addEventListener('click', doLogin);
[loginServerInput, loginAccountInput, loginPasswordInput].forEach(el =>
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); })
);
// ══════════════════════════════════════════════════════
// SCREEN 2: AI SELECT
// ══════════════════════════════════════════════════════
const aiGrid = document.getElementById('ai-grid');
const logoutBtn = document.getElementById('logout-btn');
const refreshAiBtn = document.getElementById('refresh-ai-btn');
const userChipText = document.getElementById('user-chip-text');
function setUserChip(account, server) {
    const host = (() => { try { return new URL(server).hostname; } catch { return server; } })();
    userChipText.textContent = `${account} @ ${host}`;
}
async function loadAiSelectScreen() {
    aiGrid.innerHTML = '<div class="ai-loading"><div class="spinner-large"></div><p>加载 AI 成员列表...</p></div>';
    try {
        const [configs, statuses] = await Promise.all([
            window.heysureAPI.listAiConfigs(),
            window.heysureAPI.getAiRuntimeStatus(),
        ]);
        renderAiGrid(configs, statuses);
    }
    catch (err) {
        aiGrid.innerHTML = `<div class="ai-empty"><div class="ai-empty-icon">&#x26A0;</div><p>加载失败: ${escapeHtml(err.message || String(err))}</p><button class="btn btn-secondary" onclick="loadAiSelectScreen()" style="margin-top:8px">重试</button></div>`;
    }
}
function renderAiGrid(configs, statuses) {
    const statusMap = new Map();
    statuses.forEach(s => statusMap.set(s.ai_config_id, s));
    if (!configs || configs.length === 0) {
        aiGrid.innerHTML = '<div class="ai-empty"><div class="ai-empty-icon">&#x1F916;</div><p>暂无 AI 成员</p><p style="font-size:11px">请先在网页端项目中创建 AI 成员</p></div>';
        return;
    }
    aiGrid.innerHTML = '';
    configs.forEach(cfg => {
        const isManager = cfg.digital_member_role === 'manager';
        const rs = statusMap.get(cfg.id);
        const isEnabled = rs?.running ?? cfg.enabled;
        const card = document.createElement('div');
        card.className = `ai-card${isManager ? ' manager-card' : ''}`;
        card.innerHTML = `
      <div class="ai-card-top">
        <div class="ai-avatar ${isManager ? 'manager' : 'member'}">${isManager ? '★' : '&#x1F916;'}</div>
        <div class="ai-card-info">
          <div class="ai-card-name">${escapeHtml(cfg.name)}</div>
          <div class="ai-card-project">${escapeHtml(cfg.project_name || cfg.description || '无项目')}</div>
        </div>
      </div>
      <div class="ai-card-badges">
        <span class="badge ${isManager ? 'badge-manager' : 'badge-member'}">${isManager ? '组长' : '成员'}</span>
        <span class="badge badge-${cfg.lifecycle_status || 'working'}">${lifecycleLabel(cfg.lifecycle_status)}</span>
        <span class="badge ${isEnabled ? 'badge-enabled' : 'badge-disabled'}">${isEnabled ? '● 已启用' : '○ 未启用'}</span>
      </div>
      <div class="ai-card-actions">
        <button class="btn btn-secondary btn-clone">&#x1F4CB; 克隆</button>
        <button class="btn btn-primary btn-select">选择</button>
      </div>`;
        card.querySelector('.btn-clone').addEventListener('click', async () => {
            const btn = card.querySelector('.btn-clone');
            btn.disabled = true; btn.textContent = '克隆中...';
            try {
                await window.heysureAPI.cloneAiConfig(cfg.id);
                await loadAiSelectScreen();
            }
            catch (err) {
                alert('克隆失败: ' + (err.message || String(err)));
                btn.disabled = false; btn.innerHTML = '&#x1F4CB; 克隆';
            }
        });
        card.querySelector('.btn-select').addEventListener('click', async () => {
            const btn = card.querySelector('.btn-select');
            btn.disabled = true; btn.textContent = '连接中...';
            try {
                await window.heysureAPI.selectAiConfig(cfg);
                const s = await window.heysureAPI.getSettings();
                await loadMainSettings();
                updateAiMemberDisplay(s);
                const status = await window.heysureAPI.getStatus();
                setStatus(status); updateStats();
                showScreen('main');
            }
            catch (err) {
                alert('选择失败: ' + (err.message || String(err)));
                btn.disabled = false; btn.textContent = '选择';
            }
        });
        aiGrid.appendChild(card);
    });
}
window.loadAiSelectScreen = loadAiSelectScreen;
logoutBtn.addEventListener('click', async () => {
    await window.heysureAPI.logout();
    const s = await window.heysureAPI.getSettings();
    loginServerInput.value = s.serverUrl || '';
    loginAccountInput.value = ''; loginPasswordInput.value = '';
    clearLoginError(); showScreen('login');
});
refreshAiBtn.addEventListener('click', () => loadAiSelectScreen());
function goToAiSelect() {
    loadAiSelectScreen().catch(() => { });
    showScreen('ai-select');
}
document.getElementById('switch-ai-btn')?.addEventListener('click', goToAiSelect);
document.getElementById('switch-ai-btn2')?.addEventListener('click', goToAiSelect);
// ══════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════
async function init() {
    const s = await window.heysureAPI.getSettings();
    applyTheme(s.theme || 'dark', false);
    if (s.authToken && s.selectedAiConfigId) {
        await loadMainSettings();
        const status = await window.heysureAPI.getStatus();
        setStatus(status); updateStats();
        showScreen('main');
        setUserChip(s.userAccount, s.serverUrl);
        loadAiSelectScreen().catch(() => { });
    }
    else if (s.authToken) {
        setUserChip(s.userAccount, s.serverUrl);
        await loadAiSelectScreen();
        showScreen('ai-select');
    }
    else {
        loginServerInput.value = s.serverUrl || '';
        showScreen('login');
    }
}
init().catch(console.error);
