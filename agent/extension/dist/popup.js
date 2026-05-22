(() => {
  // src/lib/types.ts
  var SETTING_DEFAULTS = {
    serverUrl: "http://localhost:3000",
    agentToken: "",
    agentId: "",
    agentName: "Browser Agent",
    agentGroup: "",
    aiKey: "",
    aiBaseUrl: "https://api.anthropic.com",
    aiModel: "claude-sonnet-4-5",
    autoConnect: false,
    offlineMode: false,
    theme: "dark"
  };

  // src/lib/storage.ts
  async function getSettings() {
    const keys = Object.keys(SETTING_DEFAULTS);
    const stored = await chrome.storage.local.get(keys);
    return { ...SETTING_DEFAULTS, ...stored };
  }
  var AUTH_KEY = "_auth_state";
  var AUTH_DEFAULT = { token: "", account: "", userId: null, userName: "" };
  async function getAuth() {
    const r = await chrome.storage.local.get(AUTH_KEY);
    return { ...AUTH_DEFAULT, ...r[AUTH_KEY] || {} };
  }
  async function saveAuth(state) {
    const current = await getAuth();
    await chrome.storage.local.set({ [AUTH_KEY]: { ...current, ...state } });
  }
  async function clearAuth() {
    const current = await getAuth();
    await chrome.storage.local.set({ [AUTH_KEY]: { ...AUTH_DEFAULT, account: current.account } });
  }

  // src/lib/client.ts
  var trimUrl = (u) => String(u || "").replace(/\/+$/, "");
  var authHeaders = (token, withJson = false) => {
    const h = { Authorization: `Bearer ${token}` };
    if (withJson)
      h["Content-Type"] = "application/json";
    return h;
  };
  async function parseError(res, fallback) {
    try {
      const data = await res.json();
      return String(data?.detail || data?.error || fallback);
    } catch {
      return `${fallback} (HTTP ${res.status})`;
    }
  }
  async function requestJson(url, init2, fallback) {
    const res = await fetch(url, { ...init2, signal: init2.signal ?? AbortSignal.timeout(2e4) });
    if (!res.ok)
      throw new Error(await parseError(res, fallback));
    return await res.json();
  }
  async function login(serverUrl2, account, password) {
    const base = trimUrl(serverUrl2);
    const data = await requestJson(
      `${base}/api/auth/login`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account, password }) },
      "\u767B\u5F55\u5931\u8D25"
    );
    if (!data.access_token)
      throw new Error("\u767B\u5F55\u54CD\u5E94\u7F3A\u5C11\u4EE4\u724C");
    return { token: data.access_token, user: data.user };
  }
  async function getMe(serverUrl2, token) {
    return requestJson(`${trimUrl(serverUrl2)}/api/auth/me`, { headers: authHeaders(token) }, "\u83B7\u53D6\u7528\u6237\u4FE1\u606F\u5931\u8D25");
  }
  async function listConfigs(serverUrl2, token) {
    const rows = await requestJson(`${trimUrl(serverUrl2)}/api/ai/configs`, { headers: authHeaders(token) }, "AI \u6210\u5458\u5217\u8868\u52A0\u8F7D\u5931\u8D25");
    return Array.isArray(rows) ? rows : [];
  }
  async function getMcpTools(serverUrl2, token) {
    const data = await requestJson(`${trimUrl(serverUrl2)}/api/mcp/tools`, { headers: authHeaders(token) }, "MCP \u5DE5\u5177\u4FE1\u606F\u52A0\u8F7D\u5931\u8D25");
    return {
      roleOrder: Array.isArray(data?.roleOrder) ? data.roleOrder : [],
      roleLabels: data?.roleLabels && typeof data.roleLabels === "object" ? data.roleLabels : {},
      roleDefaults: data?.roleDefaults && typeof data.roleDefaults === "object" ? data.roleDefaults : {},
      rolePermissions: data?.rolePermissions && typeof data.rolePermissions === "object" ? data.rolePermissions : {},
      tools: Array.isArray(data?.tools) ? data.tools : []
    };
  }
  async function startChatRun(serverUrl2, token, aiConfigId, sessionId, content) {
    return requestJson(
      `${trimUrl(serverUrl2)}/api/chat/run/start`,
      {
        method: "POST",
        headers: authHeaders(token, true),
        body: JSON.stringify({
          ai_config_id: aiConfigId,
          ai_kind: "assistant",
          session_id: sessionId,
          session_name: "\u6D4F\u89C8\u5668\u63D2\u4EF6\u4F1A\u8BDD",
          visible_content: content,
          model_content: content
        })
      },
      "\u53D1\u8D77\u5BF9\u8BDD\u5931\u8D25"
    );
  }
  async function getChatRun(serverUrl2, token, runId, after) {
    const q = after !== void 0 ? `?after=${after}` : "";
    return requestJson(
      `${trimUrl(serverUrl2)}/api/chat/run/status/${encodeURIComponent(runId)}${q}`,
      { headers: authHeaders(token) },
      "\u83B7\u53D6\u5BF9\u8BDD\u72B6\u6001\u5931\u8D25"
    );
  }
  async function triggerTask(serverUrl2, token, configId, payload) {
    return requestJson(
      `${trimUrl(serverUrl2)}/api/ai/configs/${configId}/task-trigger`,
      { method: "POST", headers: authHeaders(token, true), body: JSON.stringify(payload) },
      "\u5B89\u6392\u4EFB\u52A1\u5931\u8D25"
    );
  }
  async function listTaskJobs(serverUrl2, token, configId) {
    const data = await requestJson(
      `${trimUrl(serverUrl2)}/api/ai/configs/${configId}/task-jobs`,
      { headers: authHeaders(token) },
      "\u4EFB\u52A1\u5217\u8868\u52A0\u8F7D\u5931\u8D25"
    );
    return Array.isArray(data?.jobs) ? data.jobs : [];
  }
  async function taskJobAction(serverUrl2, token, configId, jobId, action) {
    const base = `${trimUrl(serverUrl2)}/api/ai/configs/${configId}/task-jobs/${encodeURIComponent(jobId)}`;
    if (action === "delete") {
      const res2 = await fetch(base, { method: "DELETE", headers: authHeaders(token), signal: AbortSignal.timeout(1e4) });
      if (!res2.ok)
        throw new Error(await parseError(res2, "\u5220\u9664\u4EFB\u52A1\u5931\u8D25"));
      return;
    }
    const res = await fetch(`${base}/${action}`, { method: "POST", headers: authHeaders(token), signal: AbortSignal.timeout(1e4) });
    if (!res.ok)
      throw new Error(await parseError(res, `${action} \u4EFB\u52A1\u5931\u8D25`));
  }

  // src/popup.ts
  var currentTheme = "dark";
  var activeTab = "feed";
  var currentStatus = "disconnected";
  var chatHistory = [];
  var chatBusy = false;
  var hasAiKey = false;
  var port;
  var serverUrl = "";
  var offlineMode = false;
  var localModel = "";
  var auth = { token: "", account: "", userId: null, userName: "" };
  var members = [];
  var selectedMemberId = null;
  var mcpRolePerms = null;
  var activeRunId = null;
  var STATUS_LABELS = {
    disconnected: "\u672A\u8FDE\u63A5",
    connecting: "\u8FDE\u63A5\u4E2D...",
    connected: "\u5DF2\u8FDE\u63A5",
    registered: "\u5DF2\u6CE8\u518C",
    error: "\u8FDE\u63A5\u9519\u8BEF"
  };
  var ROLE_LABELS = {
    assistant_admin: "\u8F85\u52A9\u7BA1\u7406\u5458",
    manager: "\u7BA1\u7406\u8005",
    member: "\u666E\u901A\u6210\u5458"
  };
  var $ = (id) => document.getElementById(id);
  var statusDot = $("status-dot");
  var statusLabel = $("status-label");
  var themeToggle = $("theme-toggle");
  var userChip = $("user-chip");
  var userAva = $("user-ava");
  var userName = $("user-name");
  var tabs = {
    feed: $("tab-feed"),
    members: $("tab-members"),
    chat: $("tab-chat"),
    tasks: $("tab-tasks"),
    settings: $("tab-settings")
  };
  var panes = {
    feed: $("feed-pane"),
    members: $("members-pane"),
    chat: $("chat-pane"),
    tasks: $("task-pane"),
    settings: $("settings-pane")
  };
  var feed = $("feed");
  var feedEmpty = $("feed-empty");
  var chatMsgs = $("chat-messages");
  var chatNoKey = $("chat-no-key");
  var chatInput = $("chat-input");
  var chatSendBtn = $("chat-send");
  var chatTarget = $("chat-target");
  var connectBtn = $("connect-btn");
  var disconnectBtn = $("disconnect-btn");
  var clearBtn = $("clear-btn");
  var testConnBtn = $("test-conn-btn");
  var testResult = $("test-result");
  var saveFeedback = $("save-feedback");
  var cfgServer = $("cfg-server");
  var cfgToken = $("cfg-token");
  var cfgName = $("cfg-name");
  var cfgId = $("cfg-id");
  var cfgGroup = $("cfg-group");
  var cfgAiKey = $("cfg-ai-key");
  var cfgAiBase = $("cfg-ai-base");
  var cfgAiModel = $("cfg-ai-model");
  var cfgAutoConn = $("cfg-auto-connect");
  var cfgOfflineMode = $("cfg-offline-mode");
  var cfgAiProvider = $("cfg-ai-provider");
  var offlineBadge = $("offline-badge");
  var loginGate = $("login-gate");
  var membersView = $("members-view");
  var loginAccount = $("login-account");
  var loginPassword = $("login-password");
  var loginBtn = $("login-btn");
  var loginFeedback = $("login-feedback");
  var membersRefresh = $("members-refresh");
  var membersList = $("members-list");
  var membersEmpty = $("members-empty");
  var taskTarget = $("task-target");
  var taskForm = $("task-form");
  var taskTitle = $("task-title");
  var taskInstruction = $("task-instruction");
  var taskPriority = $("task-priority");
  var taskSchedEnabled = $("task-schedule-enabled");
  var taskSchedOpts = $("task-schedule-opts");
  var taskLoop = $("task-loop-enabled");
  var taskRunNow = $("task-run-immediately");
  var taskDuration = $("task-duration");
  var taskAt = $("task-at");
  var taskSubmit = $("task-submit");
  var taskFeedback = $("task-feedback");
  var taskJobsCard = $("task-jobs-card");
  var jobsRefresh = $("jobs-refresh");
  var jobsList = $("jobs-list");
  var jobsEmpty = $("jobs-empty");
  var accountStatusV = $("account-status-v");
  var logoutBtn = $("logout-btn");
  var gotoLoginBtn = $("goto-login-btn");
  var memberSettingsCard = $("member-settings-card");
  var memberSettingsBody = $("member-settings-body");
  var rolePermsCard = $("role-perms-card");
  var rolePermsBody = $("role-perms-body");
  var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function fmt(ts) {
    return new Date(ts).toTimeString().slice(0, 8);
  }
  function roleOf(m) {
    if (m.ai_role === "assistant_admin")
      return "assistant_admin";
    return m.digital_member_role === "manager" ? "manager" : "member";
  }
  function memberById(id) {
    return members.find((m) => m.id === id);
  }
  function toolCount(m) {
    try {
      const a = JSON.parse(m.mcp_tools || "[]");
      return Array.isArray(a) ? a.length : 0;
    } catch {
      return 0;
    }
  }
  function switchTab(tab) {
    activeTab = tab;
    Object.keys(panes).forEach((k) => panes[k].classList.add("hidden"));
    Object.keys(tabs).forEach((k) => tabs[k].classList.remove("active"));
    panes[tab].classList.remove("hidden");
    tabs[tab].classList.add("active");
    if (tab === "chat")
      chatMsgs.scrollTop = chatMsgs.scrollHeight;
    if (tab === "members" && auth.token && members.length === 0)
      void loadMembers();
    if (tab === "tasks" && selectedMemberId && auth.token)
      void loadJobs();
  }
  Object.keys(tabs).forEach((k) => tabs[k].addEventListener("click", () => switchTab(k)));
  function setStatus(status) {
    currentStatus = status;
    statusDot.className = `status-dot ${status}`;
    statusLabel.textContent = STATUS_LABELS[status] || status;
  }
  function applyTheme(theme, persist = true) {
    currentTheme = theme;
    document.body.className = theme;
    themeToggle.textContent = theme === "dark" ? "\u2600\uFE0F" : "\u{1F319}";
    if (persist)
      port.postMessage({ type: "settings:save", payload: { theme } });
  }
  themeToggle.addEventListener("click", () => applyTheme(currentTheme === "dark" ? "light" : "dark"));
  var ICON = { success: "\u2713", error: "\u2717", running: "\u25B6", warn: "\u26A0", system: "\u25CF", info: "\u2139", human: "?" };
  var IC_CLS = { success: "success", error: "error", running: "running", warn: "warn", system: "system", info: "info", human: "warn" };
  function addEntry(e) {
    feedEmpty.style.display = "none";
    const ic = IC_CLS[e.status] || IC_CLS[e.type] || "info";
    const hasData = e.data !== void 0 && e.data !== null;
    let datHtml = "";
    if (hasData) {
      const ds = typeof e.data === "string" ? e.data : (() => {
        try {
          return JSON.stringify(e.data, null, 2);
        } catch {
          return String(e.data);
        }
      })();
      datHtml = `<button class="toggle-btn" onclick="this.classList.toggle('open');this.nextElementSibling.classList.toggle('show')"><span>\u25B6</span> \u8BE6\u60C5</button><div class="data-block"><pre>${esc(ds.slice(0, 2e3))}</pre></div>`;
    }
    const el = document.createElement("div");
    el.className = "entry";
    el.innerHTML = `
    <div class="entry-icon ${ic}">${ICON[e.status] || ICON[e.type] || "\u2139"}</div>
    <div class="entry-body">
      <div class="entry-top"><span class="entry-badge ${e.type}">${e.type}</span><span class="entry-time">${fmt(e.timestamp)}</span></div>
      <div class="entry-msg">${esc(e.message)}</div>${datHtml}
    </div>`;
    feed.appendChild(el);
    feed.scrollTop = feed.scrollHeight;
  }
  clearBtn.addEventListener("click", () => {
    feed.querySelectorAll(".entry").forEach((e) => e.remove());
    feedEmpty.style.display = "flex";
  });
  function updateUserChip() {
    if (auth.token) {
      userChip.classList.remove("guest");
      userAva.textContent = (auth.userName || auth.account || "?").slice(0, 1).toUpperCase();
      userName.textContent = auth.userName || auth.account || "\u5DF2\u767B\u5F55";
    } else {
      userChip.classList.add("guest");
      userAva.textContent = "\xB7";
      userName.textContent = "\u672A\u767B\u5F55";
    }
    loginGate.classList.toggle("hidden", !!auth.token);
    membersView.classList.toggle("hidden", !auth.token);
    accountStatusV.textContent = auth.token ? `\u5DF2\u767B\u5F55\uFF1A${auth.userName || auth.account}` : "\u672A\u767B\u5F55";
    logoutBtn.style.display = auth.token ? "block" : "none";
    gotoLoginBtn.style.display = auth.token ? "none" : "block";
  }
  async function doLogin() {
    const account = loginAccount.value.trim();
    const password = loginPassword.value;
    if (!account || !password) {
      loginFeedback.textContent = "\u8BF7\u8F93\u5165\u8D26\u53F7\u548C\u5BC6\u7801";
      loginFeedback.style.color = "var(--error)";
      return;
    }
    if (!serverUrl) {
      loginFeedback.textContent = "\u8BF7\u5148\u5728\u8BBE\u7F6E\u4E2D\u914D\u7F6E\u670D\u52A1\u5668 URL";
      loginFeedback.style.color = "var(--error)";
      return;
    }
    loginBtn.disabled = true;
    loginFeedback.textContent = "\u767B\u5F55\u4E2D\u2026";
    loginFeedback.style.color = "var(--muted)";
    try {
      const { token, user } = await login(serverUrl, account, password);
      auth = { token, account, userId: user?.id ?? null, userName: user?.name || account };
      await saveAuth(auth);
      loginPassword.value = "";
      loginFeedback.textContent = "\u767B\u5F55\u6210\u529F \u2713";
      loginFeedback.style.color = "var(--success)";
      updateUserChip();
      await Promise.all([loadMembers(), loadMcpTools()]);
      renderSettingsViews();
    } catch (err) {
      loginFeedback.textContent = `\u767B\u5F55\u5931\u8D25\uFF1A${err?.message || err}`;
      loginFeedback.style.color = "var(--error)";
    } finally {
      loginBtn.disabled = false;
    }
  }
  loginBtn.addEventListener("click", () => void doLogin());
  loginPassword.addEventListener("keydown", (e) => {
    if (e.key === "Enter")
      void doLogin();
  });
  async function doLogout() {
    await clearAuth();
    auth = await getAuth();
    members = [];
    selectedMemberId = null;
    mcpRolePerms = null;
    updateUserChip();
    renderMembers();
    updateTargetBanners();
    renderSettingsViews();
    switchTab("members");
  }
  logoutBtn.addEventListener("click", () => void doLogout());
  gotoLoginBtn.addEventListener("click", () => switchTab("members"));
  async function loadMembers() {
    if (!auth.token)
      return;
    membersEmpty.textContent = "\u52A0\u8F7D\u4E2D\u2026";
    membersEmpty.style.display = "block";
    try {
      members = await listConfigs(serverUrl, auth.token);
      if (selectedMemberId && !memberById(selectedMemberId))
        selectedMemberId = null;
      renderMembers();
      updateTargetBanners();
      renderSettingsViews();
    } catch (err) {
      if (/401|令牌|凭证|credential/i.test(String(err?.message))) {
        await doLogout();
        loginFeedback.textContent = "\u767B\u5F55\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55";
        loginFeedback.style.color = "var(--warn)";
        return;
      }
      membersEmpty.textContent = `\u52A0\u8F7D\u5931\u8D25\uFF1A${err?.message || err}`;
    }
  }
  function renderMembers() {
    membersList.querySelectorAll(".member-card").forEach((e) => e.remove());
    if (!members.length) {
      membersEmpty.style.display = "block";
      membersEmpty.textContent = auth.token ? "\u6682\u65E0 AI \u6210\u5458" : "\u8BF7\u5148\u767B\u5F55";
      return;
    }
    membersEmpty.style.display = "none";
    for (const m of members) {
      const role = roleOf(m);
      const el = document.createElement("div");
      el.className = `member-card${m.id === selectedMemberId ? " selected" : ""}`;
      el.innerHTML = `
      <div class="${m.enabled === false ? "dot-off" : "dot-on"}"></div>
      <div class="member-ava">${esc((m.name || "?").slice(0, 1))}</div>
      <div class="member-info">
        <div class="member-name">${esc(m.name || "\u672A\u547D\u540D")}</div>
        <div class="member-meta">${esc(m.model || "\u2014")} \xB7 MCP ${toolCount(m)} \u9879</div>
      </div>
      <span class="role-badge ${role}">${ROLE_LABELS[role] || role}</span>`;
      el.addEventListener("click", () => selectMember(m.id));
      membersList.appendChild(el);
    }
  }
  function selectMember(id) {
    selectedMemberId = id;
    renderMembers();
    updateTargetBanners();
    renderSettingsViews();
    chatHistory = [];
    chatMsgs.querySelectorAll(".chat-msg").forEach((e) => e.remove());
  }
  membersRefresh.addEventListener("click", () => void loadMembers());
  async function loadMcpTools() {
    if (!auth.token)
      return;
    try {
      mcpRolePerms = await getMcpTools(serverUrl, auth.token);
      renderSettingsViews();
    } catch {
    }
  }
  function useServerChat() {
    return !!(!offlineMode && auth.token && selectedMemberId);
  }
  function updateOfflineUi() {
    offlineBadge.classList.toggle("on", offlineMode);
    updateTargetBanners();
  }
  function updateTargetBanners() {
    const m = memberById(selectedMemberId);
    if (offlineMode) {
      chatTarget.classList.remove("empty");
      chatTarget.innerHTML = `\u{1F6DC} \u79BB\u7EBF\u6A21\u5F0F \xB7 \u6A21\u578B <span class="tb-name">${esc(localModel || "\u672A\u914D\u7F6E")}</span>`;
    } else if (m) {
      chatTarget.classList.remove("empty");
      chatTarget.innerHTML = `\u5BF9\u8BDD\u76EE\u6807\uFF1A<span class="tb-name">${esc(m.name)}</span>\uFF08${ROLE_LABELS[roleOf(m)] || ""}\uFF09`;
    } else {
      chatTarget.classList.add("empty");
      chatTarget.textContent = "\u672A\u9009\u62E9 AI \u6210\u5458\uFF08\u5C06\u4F7F\u7528\u672C\u5730 AI Key \u76F4\u8FDE\uFF09";
    }
    if (m && !offlineMode) {
      taskTarget.classList.remove("empty");
      taskTarget.innerHTML = `\u4EFB\u52A1\u76EE\u6807\uFF1A<span class="tb-name">${esc(m.name)}</span>`;
      taskForm.style.display = "block";
      taskJobsCard.style.display = "block";
    } else {
      taskTarget.classList.add("empty");
      taskTarget.textContent = offlineMode ? "\u79BB\u7EBF\u6A21\u5F0F\u4E0B\u4E0D\u53EF\u5B89\u6392\u4EFB\u52A1\uFF08\u4EFB\u52A1\u9700\u767B\u5F55\u670D\u52A1\u5668\uFF09" : auth.token ? "\u8BF7\u5148\u5728\u201C\u6210\u5458\u201D\u4E2D\u9009\u62E9\u4E00\u4E2A AI \u6210\u5458" : "\u8BF7\u5148\u767B\u5F55\u5E76\u9009\u62E9 AI \u6210\u5458";
      taskForm.style.display = "none";
      taskJobsCard.style.display = "none";
    }
    refreshChatAvailability();
  }
  function refreshChatAvailability() {
    const enabled = useServerChat() || hasAiKey;
    chatNoKey.style.display = enabled ? "none" : "flex";
    chatInput.disabled = !enabled || chatBusy;
    chatSendBtn.disabled = !enabled || chatBusy;
  }
  function mdToHtml(text) {
    return esc(text).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\n/g, "<br>");
  }
  function appendChatMsg(role, content) {
    chatNoKey.style.display = "none";
    const el = document.createElement("div");
    el.className = `chat-msg ${role}`;
    el.innerHTML = `<div class="chat-avatar">${role === "ai" ? "\u2728" : "\u{1F464}"}</div><div class="chat-bubble">${mdToHtml(content)}</div>`;
    chatMsgs.appendChild(el);
    chatMsgs.scrollTop = chatMsgs.scrollHeight;
    return el;
  }
  function showThinking() {
    const el = document.createElement("div");
    el.className = "chat-msg ai";
    el.id = "thinking";
    el.innerHTML = `<div class="chat-avatar">\u2728</div><div class="chat-bubble"><div class="thinking"><span></span><span></span><span></span></div></div>`;
    chatMsgs.appendChild(el);
    chatMsgs.scrollTop = chatMsgs.scrollHeight;
    return el;
  }
  function setBubble(el, html) {
    const bubble = el.querySelector(".chat-bubble");
    if (bubble)
      bubble.innerHTML = html;
    chatMsgs.scrollTop = chatMsgs.scrollHeight;
  }
  function setChatBusy(busy) {
    chatBusy = busy;
    refreshChatAvailability();
  }
  async function runServerChat(text, thinking) {
    const sessionId = `ext-${selectedMemberId}`;
    const { run_id } = await startChatRun(serverUrl, auth.token, selectedMemberId, sessionId, text);
    activeRunId = run_id;
    let after = 0;
    let lastText = "";
    const MAX_POLLS = 600;
    for (let i = 0; i < MAX_POLLS; i++) {
      await sleep(800);
      let st;
      try {
        st = await getChatRun(serverUrl, auth.token, run_id, after);
      } catch {
        continue;
      }
      if (st.live_text && st.live_text !== lastText) {
        lastText = st.live_text;
        after = st.live_len;
        const phase = st.current_tool ? `<div style="font-size:10px;color:var(--muted);margin-bottom:4px;">\u2699 ${esc(st.current_tool)}</div>` : "";
        setBubble(thinking, phase + mdToHtml(lastText));
      }
      if (["completed", "error", "stopped"].includes(st.status)) {
        activeRunId = null;
        if (st.status === "error")
          return { text: `\u26A0 \u9519\u8BEF: ${st.error_message || "\u6267\u884C\u5931\u8D25"}`, ok: false };
        if (st.status === "stopped")
          return { text: lastText || "\uFF08\u5DF2\u505C\u6B62\uFF09", ok: true };
        return { text: lastText || "\u5B8C\u6210", ok: true };
      }
    }
    activeRunId = null;
    return { text: lastText || "\uFF08\u8D85\u65F6\uFF0C\u672A\u6536\u5230\u5B8C\u6574\u56DE\u590D\uFF09", ok: false };
  }
  async function sendChat() {
    const enabled = useServerChat() || hasAiKey;
    if (chatBusy || !enabled)
      return;
    const text = chatInput.value.trim();
    if (!text)
      return;
    chatInput.value = "";
    chatInput.style.height = "auto";
    appendChatMsg("user", text);
    const thinking = showThinking();
    setChatBusy(true);
    if (useServerChat()) {
      try {
        const res = await runServerChat(text, thinking);
        setBubble(thinking, mdToHtml(res.text));
        thinking.removeAttribute("id");
      } catch (err) {
        setBubble(thinking, mdToHtml(`\u26A0 \u9519\u8BEF: ${err?.message || err}`));
        thinking.removeAttribute("id");
      } finally {
        setChatBusy(false);
      }
    } else {
      chatHistory.push({ role: "user", content: text });
      window._chatThinking = thinking;
      port.postMessage({ type: "chat:send", messages: chatHistory });
    }
  }
  chatSendBtn.addEventListener("click", () => void sendChat());
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendChat();
    }
  });
  chatInput.addEventListener("input", () => {
    chatInput.style.height = "auto";
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
  });
  taskSchedEnabled.addEventListener("change", () => {
    taskSchedOpts.style.display = taskSchedEnabled.checked ? "block" : "none";
  });
  async function submitTask() {
    if (!auth.token || !selectedMemberId)
      return;
    const title = taskTitle.value.trim();
    const instruction = taskInstruction.value.trim();
    if (!title) {
      taskFeedback.textContent = "\u8BF7\u8F93\u5165\u4EFB\u52A1\u6807\u9898";
      taskFeedback.style.color = "var(--error)";
      return;
    }
    taskSubmit.disabled = true;
    taskFeedback.textContent = "\u63D0\u4EA4\u4E2D\u2026";
    taskFeedback.style.color = "var(--muted)";
    const schedEnabled = taskSchedEnabled.checked;
    let scheduleAt = null;
    if (schedEnabled && taskAt.value) {
      const t = new Date(taskAt.value).getTime();
      if (!Number.isNaN(t))
        scheduleAt = Math.floor(t / 1e3);
    }
    try {
      const res = await triggerTask(serverUrl, auth.token, selectedMemberId, {
        title,
        instruction,
        priority: Math.max(1, Math.min(10, Number(taskPriority.value) || 5)),
        schedule_enabled: schedEnabled,
        schedule_loop_enabled: schedEnabled && taskLoop.checked,
        schedule_run_immediately: schedEnabled && taskLoop.checked && taskRunNow.checked,
        schedule_duration_minutes: Math.max(1, Number(taskDuration.value) || 30),
        schedule_at: scheduleAt,
        override_mcp_tools_enabled: false,
        mcp_tools_override: []
      });
      taskFeedback.textContent = `\u5DF2\u5B89\u6392\uFF1A${res?.title || title} \u2713`;
      taskFeedback.style.color = "var(--success)";
      taskTitle.value = "";
      taskInstruction.value = "";
      await loadJobs();
      setTimeout(() => {
        taskFeedback.textContent = "";
      }, 2500);
    } catch (err) {
      taskFeedback.textContent = `\u5931\u8D25\uFF1A${err?.message || err}`;
      taskFeedback.style.color = "var(--error)";
    } finally {
      taskSubmit.disabled = false;
    }
  }
  taskSubmit.addEventListener("click", () => void submitTask());
  async function loadJobs() {
    if (!auth.token || !selectedMemberId)
      return;
    jobsEmpty.textContent = "\u52A0\u8F7D\u4E2D\u2026";
    jobsEmpty.style.display = "block";
    try {
      const jobs = await listTaskJobs(serverUrl, auth.token, selectedMemberId);
      renderJobs(jobs);
    } catch (err) {
      jobsEmpty.textContent = `\u52A0\u8F7D\u5931\u8D25\uFF1A${err?.message || err}`;
    }
  }
  function renderJobs(jobs) {
    jobsList.querySelectorAll(".job-card").forEach((e) => e.remove());
    if (!jobs.length) {
      jobsEmpty.style.display = "block";
      jobsEmpty.textContent = "\u6682\u65E0\u4EFB\u52A1";
      return;
    }
    jobsEmpty.style.display = "none";
    for (const j of jobs) {
      const st = String(j.effective_status || j.status || "queued");
      const el = document.createElement("div");
      el.className = "job-card";
      const canPause = st === "queued" || st === "running";
      const canResume = st === "paused";
      el.innerHTML = `
      <div class="job-top">
        <span class="job-title">${esc(j.title || "\u672A\u547D\u540D\u4EFB\u52A1")}</span>
        <span class="job-status ${st}">${esc(st)}</span>
      </div>
      <div style="font-size:10px;color:var(--muted)">\u4F18\u5148\u7EA7 ${j.priority ?? 5} \xB7 ${esc(j.trigger_type || "manual")}</div>
      <div class="job-actions">
        ${canPause ? `<button class="mini-btn" data-act="pause">\u6682\u505C</button>` : ""}
        ${canResume ? `<button class="mini-btn" data-act="resume">\u7EE7\u7EED</button>` : ""}
        <button class="mini-btn" data-act="stop">\u505C\u6B62</button>
        <button class="mini-btn danger" data-act="delete">\u5220\u9664</button>
      </div>`;
      el.querySelectorAll("button[data-act]").forEach((btn) => {
        btn.addEventListener("click", () => void doJobAction(j.job_id, btn.dataset.act));
      });
      jobsList.appendChild(el);
    }
  }
  async function doJobAction(jobId, action) {
    if (!auth.token || !selectedMemberId)
      return;
    try {
      await taskJobAction(serverUrl, auth.token, selectedMemberId, jobId, action);
      await loadJobs();
    } catch (err) {
      taskFeedback.textContent = `\u64CD\u4F5C\u5931\u8D25\uFF1A${err?.message || err}`;
      taskFeedback.style.color = "var(--error)";
    }
  }
  jobsRefresh.addEventListener("click", () => void loadJobs());
  function renderSettingsViews() {
    const m = memberById(selectedMemberId);
    if (m) {
      memberSettingsCard.style.display = "block";
      let tools = [];
      try {
        const a = JSON.parse(m.mcp_tools || "[]");
        if (Array.isArray(a))
          tools = a;
      } catch {
      }
      const chips = tools.length ? `<div class="tool-chips">${tools.map((t) => `<span class="tool-chip">${esc(t)}</span>`).join("")}</div>` : `<div class="empty-note">\u672A\u5206\u914D MCP \u5DE5\u5177</div>`;
      memberSettingsBody.innerHTML = `
      <div class="kv"><span class="k">\u540D\u79F0</span><span class="v">${esc(m.name || "")}</span></div>
      <div class="kv"><span class="k">\u89D2\u8272</span><span class="v">${ROLE_LABELS[roleOf(m)] || roleOf(m)}</span></div>
      <div class="kv"><span class="k">\u6A21\u578B</span><span class="v">${esc(m.model || "\u2014")}</span></div>
      <div class="kv"><span class="k">\u5E73\u53F0</span><span class="v">${esc(m.platform || "\u2014")}</span></div>
      <div class="kv"><span class="k">\u5DE5\u4F5C\u76EE\u5F55</span><span class="v">${esc(m.workspace_root || "\uFF08\u4EC5\u5BF9\u8BDD\uFF09")}</span></div>
      <div class="kv"><span class="k">MCP \u5F00\u5173</span><span class="v">${m.mcp_enabled === false ? "\u5173\u95ED" : "\u5F00\u542F"}</span></div>
      <div class="divider"></div>
      <div class="kv"><span class="k">MCP \u5DE5\u5177\uFF08${tools.length}\uFF09</span><span class="v"></span></div>
      ${chips}`;
    } else {
      memberSettingsCard.style.display = "none";
    }
    if (mcpRolePerms && mcpRolePerms.roleOrder.length) {
      rolePermsCard.style.display = "block";
      const rows = mcpRolePerms.roleOrder.map((role) => {
        const label = mcpRolePerms.roleLabels[role] || role;
        const allowed = mcpRolePerms.rolePermissions[role] && mcpRolePerms.rolePermissions[role].length ? mcpRolePerms.rolePermissions[role] : mcpRolePerms.roleDefaults[role] || [];
        const ceiling = (mcpRolePerms.roleDefaults[role] || []).length;
        return `<div class="kv"><span class="k">${esc(label)}</span><span class="v">${allowed.length} / ${ceiling} \u9879</span></div>`;
      }).join("");
      rolePermsBody.innerHTML = rows + `<div class="login-hint" style="margin-top:6px;text-align:left;">\u5728\u8F6F\u4EF6\u7AEF\u201C\u7CFB\u7EDF\u8BBE\u7F6E \u2192 MCP \u89D2\u8272\u6743\u9650\u201D\u4E2D\u8C03\u6574\u8303\u56F4\u3002</div>`;
    } else {
      rolePermsCard.style.display = "none";
    }
  }
  function loadSettings(s) {
    serverUrl = s.serverUrl || "";
    cfgServer.value = s.serverUrl || "";
    cfgToken.value = s.agentToken || "";
    cfgName.value = s.agentName || "";
    cfgId.value = s.agentId || "";
    cfgGroup.value = s.agentGroup || "";
    cfgAiKey.value = s.aiKey || "";
    cfgAiBase.value = s.aiBaseUrl || "";
    cfgAiModel.value = s.aiModel || "";
    cfgAutoConn.checked = !!s.autoConnect;
    offlineMode = !!s.offlineMode;
    cfgOfflineMode.checked = offlineMode;
    localModel = s.aiModel || "";
    hasAiKey = !!s.aiKey?.trim();
    updateOfflineUi();
    applyTheme(s.theme || "dark", false);
  }
  var PROVIDER_PRESETS = {
    anthropic: { base: "https://api.anthropic.com", model: "claude-sonnet-4-5" },
    openai: { base: "https://api.openai.com", model: "gpt-4o" },
    deepseek: { base: "https://api.deepseek.com", model: "deepseek-chat" },
    openrouter: { base: "https://openrouter.ai/api", model: "anthropic/claude-3.5-sonnet" },
    ollama: { base: "http://localhost:11434", model: "llama3.1" }
  };
  cfgAiProvider.addEventListener("change", () => {
    const p = PROVIDER_PRESETS[cfgAiProvider.value];
    if (p) {
      cfgAiBase.value = p.base;
      cfgAiModel.value = p.model;
    }
    cfgAiProvider.value = "";
  });
  cfgOfflineMode.addEventListener("change", () => {
    offlineMode = cfgOfflineMode.checked;
    updateOfflineUi();
    port.postMessage({ type: "settings:save", payload: { offlineMode } });
  });
  $("save-btn").addEventListener("click", () => {
    const payload = {
      serverUrl: cfgServer.value.trim(),
      agentToken: cfgToken.value,
      agentName: cfgName.value.trim(),
      agentId: cfgId.value.trim(),
      agentGroup: cfgGroup.value.trim(),
      aiKey: cfgAiKey.value.trim(),
      aiBaseUrl: cfgAiBase.value.trim() || "https://api.anthropic.com",
      aiModel: cfgAiModel.value.trim() || "claude-sonnet-4-5",
      autoConnect: cfgAutoConn.checked,
      offlineMode: cfgOfflineMode.checked
    };
    serverUrl = payload.serverUrl || "";
    offlineMode = !!payload.offlineMode;
    localModel = payload.aiModel || "";
    port.postMessage({ type: "settings:save", payload });
    hasAiKey = !!payload.aiKey;
    updateOfflineUi();
    saveFeedback.textContent = "\u5DF2\u4FDD\u5B58 \u2713";
    saveFeedback.style.color = "var(--success)";
    setTimeout(() => {
      saveFeedback.textContent = "";
    }, 2e3);
  });
  testConnBtn.addEventListener("click", () => {
    testResult.textContent = "\u6D4B\u8BD5\u4E2D...";
    testResult.className = "test-result";
    port.postMessage({ type: "connection:test" });
  });
  connectBtn.addEventListener("click", () => port.postMessage({ type: "agent:connect" }));
  disconnectBtn.addEventListener("click", () => port.postMessage({ type: "agent:disconnect" }));
  function initPort() {
    port = chrome.runtime.connect({ name: "popup" });
    port.onMessage.addListener((msg) => {
      switch (msg.type) {
        case "agent:status":
          setStatus(msg.status);
          break;
        case "activity:log":
          addEntry(msg.entry);
          break;
        case "task:start":
          addEntry({ id: msg.data.taskId, type: "task", status: "running", message: `\u6267\u884C: ${msg.data.tool}`, data: msg.data.args, timestamp: msg.data.timestamp });
          break;
        case "task:result":
          addEntry({ id: msg.data.taskId + "_r", type: "task", status: msg.data.success ? "success" : "error", message: `${msg.data.success ? "\u5B8C\u6210" : "\u5931\u8D25"}: ${msg.data.tool}`, data: msg.data.result, timestamp: msg.data.timestamp });
          break;
        case "settings:data":
          loadSettings(msg.settings);
          break;
        case "chat:response": {
          const thinking = window._chatThinking;
          thinking?.remove();
          setChatBusy(false);
          const reply = msg.text || "\u5B8C\u6210";
          chatHistory.push({ role: "assistant", content: reply });
          appendChatMsg("ai", reply);
          if (msg.toolsUsed?.length) {
            addEntry({ id: Date.now().toString(), type: "task", status: "success", message: `AI \u4F7F\u7528\u5DE5\u5177: ${msg.toolsUsed.join(", ")}`, timestamp: Date.now() });
          }
          break;
        }
        case "chat:error": {
          const thinking = window._chatThinking;
          thinking?.remove();
          setChatBusy(false);
          appendChatMsg("ai", `\u26A0 \u9519\u8BEF: ${msg.error}`);
          break;
        }
        case "connection:result": {
          const r = msg.result;
          testResult.textContent = r.success ? `\u2713 ${r.status} \xB7 ${r.ms}ms` : `\u2717 ${r.error}`;
          testResult.className = `test-result ${r.success ? "ok" : "fail"}`;
          break;
        }
      }
    });
    port.onDisconnect.addListener(() => {
      setTimeout(initPort, 1e3);
    });
    port.postMessage({ type: "settings:get" });
  }
  async function init() {
    initPort();
    const s = await getSettings();
    serverUrl = s.serverUrl || "";
    offlineMode = !!s.offlineMode;
    localModel = s.aiModel || "";
    auth = await getAuth();
    loginAccount.value = auth.account || "";
    updateUserChip();
    updateOfflineUi();
    if (auth.token) {
      void (async () => {
        try {
          const me = await getMe(serverUrl, auth.token);
          if (me?.name) {
            auth.userName = me.name;
            await saveAuth({ userName: me.name });
            updateUserChip();
          }
          await Promise.all([loadMembers(), loadMcpTools()]);
        } catch {
          await doLogout();
        }
      })();
    }
  }
  chrome.storage.session.get("_pendingChat").then((r) => {
    if (r._pendingChat) {
      chrome.storage.session.remove("_pendingChat");
      switchTab("chat");
      chatInput.value = String(r._pendingChat);
    }
  }).catch(() => {
  });
  void init();
})();
