(() => {
  // src/popup/state.ts
  var STATUS_LABELS = {
    disconnected: "\u672A\u8FDE\u63A5",
    connecting: "\u8FDE\u63A5\u4E2D...",
    connected: "\u5DF2\u8FDE\u63A5",
    registered: "\u5DF2\u6CE8\u518C\u5230\u670D\u52A1\u5668",
    error: "\u8FDE\u63A5\u9519\u8BEF"
  };
  var ROLE_LABELS = {
    assistant_admin: "\u8F85\u52A9\u7BA1\u7406\u5458",
    manager: "\u7BA1\u7406\u8005",
    member: "\u666E\u901A\u6210\u5458"
  };
  var state = {
    currentTheme: "dark",
    activeTab: "cards",
    currentStatus: "disconnected",
    chatHistory: [],
    chatBusy: false,
    hasAiKey: false,
    // Assigned in initPort(); used before assignment never happens because the
    // listeners that read it only fire after the popup has initialised.
    port: void 0,
    activeChatRequestId: null,
    serverUrl: "",
    offlineMode: false,
    localModel: "",
    auth: { token: "", account: "", userId: null, userName: "", avatar: "" },
    // Cached data URL for the current account's avatar (hydrated from storage),
    // used so renders are synchronous and offline-friendly. Empty = fall back to
    // the live server URL.
    avatarDataUrl: "",
    members: [],
    selectedMemberId: null,
    activeRunId: null,
    cards: [],
    expandedCardId: null,
    runningCardId: null,
    // Server-backed chat history. Populated only when useServerChat() is true.
    serverSessions: [],
    currentServerSessionId: "",
    lastSyncedMessageId: 0,
    chatHistoryLoading: false
  };

  // src/popup/dom.ts
  var $ = (id) => document.getElementById(id);
  var statusDot = $("status-dot");
  var statusLabel = $("status-label");
  var statusPill = $("status-pill");
  var themeToggle = $("theme-toggle");
  var userChip = $("user-chip");
  var userAva = $("user-ava");
  var userName = $("user-name");
  var tabs = {
    cards: $("tab-cards"),
    settings: $("tab-settings")
  };
  var panes = {
    cards: $("cards-pane"),
    settings: $("settings-pane")
  };
  var feed = $("feed");
  var feedEmpty = $("feed-empty");
  var connectBtn = $("connect-btn");
  var disconnectBtn = $("disconnect-btn");
  var clearBtn = $("clear-btn");
  var testConnBtn = $("test-conn-btn");
  var testResult = $("test-result");
  var saveFeedback = $("save-feedback");
  var cfgServer = $("cfg-server");
  var cfgAgentServer = $("cfg-agent-server");
  var cfgAiKey = $("cfg-ai-key");
  var cfgAiBase = $("cfg-ai-base");
  var cfgAiModel = $("cfg-ai-model");
  var cfgAutoConn = $("cfg-auto-connect");
  var cfgOfflineMode = $("cfg-offline-mode");
  var offlineModelConfig = $("offline-model-config");
  var cfgAiProvider = $("cfg-ai-provider");
  var cfgMouseFx = $("cfg-mouse-fx");
  var saveBtn = $("save-btn");
  var loginGate = $("login-gate");
  var loginModal = $("login-modal");
  var loginModalClose = $("login-modal-close");
  var membersModal = $("members-modal");
  var membersModalClose = $("members-modal-close");
  var accountCard = $("account-card");
  var loginAccount = $("login-account");
  var loginPassword = $("login-password");
  var loginBtn = $("login-btn");
  var loginFeedback = $("login-feedback");
  var membersRefresh = $("members-refresh");
  var membersList = $("members-list");
  var membersEmpty = $("members-empty");
  var accountStatusV = $("account-status-v");
  var logoutBtn = $("logout-btn");
  var memberSettingsCard = $("member-settings-card");
  var connectionControlCard = $("connection-control-card");
  var memberSettingsBody = $("member-settings-body");
  var cardsImportBtn = $("cards-import-btn");
  var cardsExportAllBtn = $("cards-export-all-btn");
  var cardsImportBox = $("cards-import-box");
  var cardsImportText = $("cards-import-text");
  var cardsImportFileBtn = $("cards-import-file-btn");
  var cardsImportFile = $("cards-import-file");
  var cardsImportConfirm = $("cards-import-confirm");
  var cardsImportFeedback = $("cards-import-feedback");
  var cardsRunStatus = $("cards-run-status");
  var cardsList = $("cards-list");
  var cardsEmpty = $("cards-empty");
  var cardModal = $("card-modal");
  var cardModalMsg = $("card-modal-msg");
  var cmMerge = $("cm-merge");
  var cmReplace = $("cm-replace");
  var cmSkip = $("cm-skip");

  // src/lib/types.ts
  var SETTING_DEFAULTS = {
    serverUrl: "http://localhost:3000",
    agentServerUrl: "",
    lastWorkingAgentUrl: "",
    agentToken: "",
    agentId: "",
    agentName: "Browser Agent",
    agentGroup: "",
    aiKey: "",
    aiBaseUrl: "https://api.anthropic.com",
    aiModel: "claude-sonnet-4-5",
    autoConnect: false,
    offlineMode: false,
    mouseFx: true,
    theme: "dark",
    selectedAiConfigId: null
  };

  // src/lib/storage.ts
  async function getSettings() {
    const keys = Object.keys(SETTING_DEFAULTS);
    const stored = await chrome.storage.local.get(keys);
    return { ...SETTING_DEFAULTS, ...stored };
  }
  async function saveSettings(partial) {
    await chrome.storage.local.set(partial);
  }
  var AUTH_KEY = "_auth_state";
  var AUTH_DEFAULT = { token: "", account: "", userId: null, userName: "", avatar: "" };
  async function getAuth() {
    const r = await chrome.storage.local.get(AUTH_KEY);
    return { ...AUTH_DEFAULT, ...r[AUTH_KEY] || {} };
  }
  async function saveAuth(state2) {
    const current = await getAuth();
    await chrome.storage.local.set({ [AUTH_KEY]: { ...current, ...state2 } });
  }
  async function clearAuth() {
    const current = await getAuth();
    await chrome.storage.local.set({ [AUTH_KEY]: { ...AUTH_DEFAULT, account: current.account } });
  }
  var AVATAR_CACHE_KEY = "_avatar_cache";
  async function getAvatarCache() {
    const r = await chrome.storage.local.get(AVATAR_CACHE_KEY);
    const c = r[AVATAR_CACHE_KEY];
    return c && typeof c.src === "string" && typeof c.dataUrl === "string" ? c : null;
  }
  async function setAvatarCache(cache) {
    await chrome.storage.local.set({ [AVATAR_CACHE_KEY]: cache });
  }
  async function clearAvatarCache() {
    await chrome.storage.local.remove(AVATAR_CACHE_KEY);
  }
  var CARDS_KEY = "_memory_cards";
  async function getCards() {
    const r = await chrome.storage.local.get(CARDS_KEY);
    const list = r[CARDS_KEY];
    return Array.isArray(list) ? list : [];
  }
  async function setCards(cards) {
    await chrome.storage.local.set({ [CARDS_KEY]: cards });
  }
  async function deleteCard(id) {
    await setCards((await getCards()).filter((c) => c.id !== id));
  }

  // src/lib/client.ts
  var trimUrl = (u) => String(u || "").replace(/\/+$/, "");
  var authHeaders = (token, withJson = false) => {
    const h = { Authorization: `Bearer ${token}` };
    if (withJson)
      h["Content-Type"] = "application/json";
    return h;
  };
  var ApiError = class extends Error {
    status;
    constructor(message, status) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  };
  function isAuthError(err) {
    if (err && typeof err.status === "number")
      return err.status === 401 || err.status === 403;
    return /\b(401|403)\b|令牌|凭证|credential|unauthor/i.test(String(err?.message || err));
  }
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
      throw new ApiError(await parseError(res, fallback), res.status);
    return await res.json();
  }
  async function login(serverUrl, account, password) {
    const base = trimUrl(serverUrl);
    const data = await requestJson(
      `${base}/api/auth/login`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account, password }) },
      "\u767B\u5F55\u5931\u8D25"
    );
    if (!data.access_token)
      throw new Error("\u767B\u5F55\u54CD\u5E94\u7F3A\u5C11\u4EE4\u724C");
    return { token: data.access_token, user: data.user };
  }
  async function getMe(serverUrl, token) {
    return requestJson(`${trimUrl(serverUrl)}/api/auth/me`, { headers: authHeaders(token) }, "\u83B7\u53D6\u7528\u6237\u4FE1\u606F\u5931\u8D25");
  }
  async function listConfigs(serverUrl, token) {
    const rows = await requestJson(`${trimUrl(serverUrl)}/api/ai/configs`, { headers: authHeaders(token) }, "AI \u6210\u5458\u5217\u8868\u52A0\u8F7D\u5931\u8D25");
    return Array.isArray(rows) ? rows : [];
  }

  // src/popup/markdown.ts
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // src/popup/helpers.ts
  function fmt(ts) {
    return new Date(ts).toTimeString().slice(0, 8);
  }
  function roleOf(m) {
    if (m.ai_role === "assistant_admin")
      return "assistant_admin";
    return m.digital_member_role === "manager" ? "manager" : "member";
  }
  function memberById(id) {
    return state.members.find((m) => m.id === id);
  }
  function normalizeAvatarUrl(avatar) {
    const raw = String(avatar || "").trim();
    if (!raw)
      return "";
    const base = state.serverUrl.replace(/\/+$/, "");
    const preset = raw.match(/avatars([1-5])(?:[-.][^/]*)?\.png/i);
    if (preset)
      return base ? `${base}/avatars/avatars${preset[1]}.png` : "";
    if (/^(https?:|data:|blob:|chrome-extension:)/i.test(raw))
      return raw;
    if (raw.startsWith("/"))
      return base ? `${base}${raw}` : raw;
    return raw;
  }
  function avatarHtml(src, fallback) {
    const safeSrc = normalizeAvatarUrl(src);
    return safeSrc ? `<img src="${esc(safeSrc)}" alt="" />` : esc(fallback);
  }
  function toolCount(m) {
    try {
      const a = JSON.parse(m.mcp_tools || "[]");
      return Array.isArray(a) ? a.length : 0;
    } catch {
      return 0;
    }
  }
  function getConnectedAiShortLabel() {
    const name = String(memberById(state.selectedMemberId)?.name || state.auth.userName || state.auth.account || "AI").trim();
    const shortName = Array.from(name).slice(0, 2).join("") || "AI";
    return `${shortName}...`;
  }
  function hasBrowserMcpPermission(m) {
    if (m.mcp_enabled === false)
      return false;
    try {
      const parsed = JSON.parse(m.mcp_tools || "[]");
      if (!Array.isArray(parsed))
        return false;
      return parsed.some((tool) => {
        const name = String(tool || "").trim();
        return name.startsWith("browser_") || name.startsWith("card_");
      });
    } catch {
      return false;
    }
  }
  function fetchAsDataUrl(url) {
    return fetch(url).then((resp) => {
      if (!resp.ok)
        throw new Error(`HTTP ${resp.status}`);
      return resp.blob();
    }).then((blob) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    }));
  }
  async function refreshAvatarCache() {
    const resolved = normalizeAvatarUrl(state.auth.avatar);
    if (!resolved) {
      state.avatarDataUrl = "";
      await clearAvatarCache();
      return;
    }
    if (resolved.startsWith("data:")) {
      state.avatarDataUrl = resolved;
      await setAvatarCache({ src: resolved, dataUrl: resolved });
      return;
    }
    const cached = await getAvatarCache();
    if (cached && cached.src === resolved) {
      state.avatarDataUrl = cached.dataUrl;
      return;
    }
    try {
      const dataUrl = await fetchAsDataUrl(resolved);
      state.avatarDataUrl = dataUrl;
      await setAvatarCache({ src: resolved, dataUrl });
    } catch (err) {
      console.warn("avatar cache fetch failed, falling back to live URL", err);
      state.avatarDataUrl = "";
    }
  }
  function currentAvatarHtml(fallback) {
    return avatarHtml(state.avatarDataUrl || state.auth.avatar, fallback);
  }

  // src/popup/members.ts
  async function doLogin() {
    const configuredServerUrl = cfgServer.value.trim();
    if (configuredServerUrl && configuredServerUrl !== state.serverUrl) {
      state.serverUrl = configuredServerUrl;
      await saveSettings({ serverUrl: state.serverUrl });
      state.port.postMessage({ type: "settings:save", payload: { serverUrl: state.serverUrl } });
    }
    const account = loginAccount.value.trim();
    const password = loginPassword.value;
    if (!account || !password) {
      loginFeedback.textContent = "\u8BF7\u8F93\u5165\u8D26\u53F7\u548C\u5BC6\u7801";
      loginFeedback.style.color = "var(--error)";
      return;
    }
    if (!state.serverUrl) {
      loginFeedback.textContent = "\u8BF7\u5148\u5728\u8BBE\u7F6E\u4E2D\u914D\u7F6E\u670D\u52A1\u5668 URL";
      loginFeedback.style.color = "var(--error)";
      return;
    }
    loginBtn.disabled = true;
    loginFeedback.textContent = "\u767B\u5F55\u4E2D\u2026";
    loginFeedback.style.color = "var(--muted)";
    try {
      const { token, user } = await login(state.serverUrl, account, password);
      state.auth = { token, account, userId: user?.id ?? null, userName: user?.name || account, avatar: user?.avatar || "" };
      await saveAuth(state.auth);
      loginPassword.value = "";
      loginFeedback.textContent = "\u767B\u5F55\u6210\u529F \u2713";
      loginFeedback.style.color = "var(--success)";
      updateUserChip();
      await refreshAvatarCache();
      updateUserChip();
      await loadMembers();
      renderSettingsViews();
      state.port.postMessage({ type: "agent:connect" });
      closeLoginModal();
      openMembersModal();
    } catch (err) {
      loginFeedback.textContent = `\u767B\u5F55\u5931\u8D25\uFF1A${err?.message || err}`;
      loginFeedback.style.color = "var(--error)";
    } finally {
      loginBtn.disabled = false;
    }
  }
  async function doLogout() {
    await clearAuth();
    state.port.postMessage({ type: "auth:logout" });
    state.auth = await getAuth();
    state.avatarDataUrl = "";
    await clearAvatarCache();
    closeMembersModal();
    state.members = [];
    state.selectedMemberId = null;
    updateUserChip();
    renderMembers();
    renderSettingsViews();
    switchTab("settings");
  }
  async function loadMembers() {
    if (!state.auth.token)
      return;
    membersEmpty.textContent = "\u52A0\u8F7D\u4E2D\u2026";
    membersEmpty.style.display = "block";
    try {
      const rows = await listConfigs(state.serverUrl, state.auth.token);
      state.members = rows.filter(hasBrowserMcpPermission);
      renderMembers();
      renderSettingsViews();
      renderStatus();
    } catch (err) {
      if (isAuthError(err)) {
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
    if (!state.members.length) {
      membersEmpty.style.display = "block";
      membersEmpty.textContent = state.auth.token ? "\u6682\u65E0\u53EF\u663E\u793A\u7684 AI \u6210\u5458" : "\u8BF7\u5148\u767B\u5F55";
      return;
    }
    membersEmpty.style.display = "none";
    for (const m of state.members) {
      const role = roleOf(m);
      const el = document.createElement("div");
      el.className = "member-card";
      el.innerHTML = `
      <div class="${m.enabled === false ? "dot-off" : "dot-on"}"></div>
      <div class="member-ava">${esc((m.name || "?").slice(0, 1))}</div>
      <div class="member-info">
        <div class="member-name">${esc(m.name || "\u672A\u547D\u540D")}</div>
        <div class="member-meta">${esc(m.model || "\u2014")} \xB7 MCP ${toolCount(m)} \u9879</div>
      </div>
      <span class="role-badge ${role}">${ROLE_LABELS[role] || role}</span>`;
      membersList.appendChild(el);
    }
  }
  function wireMembers() {
    loginBtn.addEventListener("click", () => void doLogin());
    loginPassword.addEventListener("keydown", (e) => {
      if (e.key === "Enter")
        void doLogin();
    });
    userChip.addEventListener("click", () => openLoginModal());
    userChip.addEventListener("keydown", (e) => {
      const key = e.key;
      if (key === "Enter" || key === " ") {
        e.preventDefault();
        openLoginModal();
      }
    });
    loginModal.addEventListener("click", (e) => {
      if (e.target === loginModal)
        closeLoginModal();
    });
    loginModalClose.addEventListener("click", () => closeLoginModal());
    statusPill.addEventListener("click", () => openMembersModal());
    statusPill.addEventListener("keydown", (e) => {
      const key = e.key;
      if (key === "Enter" || key === " ") {
        e.preventDefault();
        openMembersModal();
      }
    });
    membersModal.addEventListener("click", (e) => {
      if (e.target === membersModal)
        closeMembersModal();
    });
    membersModalClose.addEventListener("click", () => closeMembersModal());
    membersRefresh.addEventListener("click", () => void loadMembers());
    logoutBtn.addEventListener("click", () => void doLogout());
  }

  // src/lib/cards.ts
  var newId = () => "card_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  function deriveNote(tool, args) {
    const labels = {
      browser_navigate: "\u8DF3\u8F6C\u9875\u9762",
      browser_wait: "\u7B49\u5F85",
      browser_click: "\u70B9\u51FB",
      browser_double_click: "\u53CC\u51FB",
      browser_right_click: "\u53F3\u952E",
      browser_type: "\u8F93\u5165\u5185\u5BB9",
      browser_scroll: "\u6EDA\u52A8",
      browser_select: "\u9009\u62E9",
      browser_press_key: "\u6309\u952E",
      browser_drag: "\u62D6\u62FD",
      browser_hover: "\u60AC\u505C",
      browser_fill_form: "\u586B\u5199\u8868\u5355",
      browser_search: "\u641C\u7D22",
      browser_screenshot: "\u622A\u56FE",
      browser_extract: "\u63D0\u53D6\u6570\u636E",
      browser_get_content: "\u8BFB\u53D6\u5185\u5BB9",
      browser_page_info: "\u67E5\u770B\u9875\u9762\u4F4D\u7F6E",
      browser_find_popups: "\u67E5\u627E\u5F39\u7A97",
      browser_close_popup: "\u5173\u95ED\u5F39\u7A97"
    };
    const base = labels[tool] || tool.replace(/^browser_/, "");
    const hint = args?.url || args?.text || args?.selector || args?.query || (args?.direction ? `${args.direction}${args?.amount ? " " + args.amount : ""}` : "") || (args?.key ? `\u6309\u952E ${args.key}` : "") || (args?.ms ? `${args.ms}ms` : "");
    return hint ? `${base}\uFF1A${String(hint).slice(0, 60)}` : base;
  }
  function normalizeStep(raw) {
    if (!raw || typeof raw !== "object")
      return null;
    const tool = String(raw.tool || raw.name || "").trim();
    if (!tool)
      return null;
    let args = raw.args ?? raw.arguments ?? raw.input ?? {};
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch {
        args = {};
      }
    }
    if (!args || typeof args !== "object")
      args = {};
    const note = String(raw.note ?? raw.remark ?? raw.comment ?? raw.\u5907\u6CE8 ?? "").trim() || deriveNote(tool, args);
    return { tool, args, note };
  }
  function parseImport(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("\u4E0D\u662F\u6709\u6548\u7684 JSON");
    }
    let rawCards;
    if (Array.isArray(data))
      rawCards = data;
    else if (data && Array.isArray(data.cards))
      rawCards = data.cards;
    else if (data && (data.steps || data.name))
      rawCards = [data];
    else
      throw new Error("\u672A\u627E\u5230\u5361\u7247\u6570\u636E");
    const now = Date.now();
    const out = [];
    for (const rc of rawCards) {
      if (!rc || typeof rc !== "object")
        continue;
      const rawSteps = Array.isArray(rc.steps) ? rc.steps : [];
      const steps = rawSteps.map(normalizeStep).filter((s) => !!s);
      if (steps.length === 0)
        continue;
      out.push({
        id: newId(),
        name: String(rc.name || "\u672A\u547D\u540D\u5361\u7247").trim().slice(0, 80),
        description: String(rc.description || "").trim().slice(0, 300),
        steps,
        createdAt: now,
        updatedAt: now
      });
    }
    if (out.length === 0)
      throw new Error("\u5361\u7247\u4E2D\u6CA1\u6709\u53EF\u7528\u7684\u6B65\u9AA4");
    return out;
  }
  function mergeCards(existing, incoming) {
    return {
      ...existing,
      description: existing.description || incoming.description,
      steps: [...existing.steps, ...incoming.steps],
      updatedAt: Date.now()
    };
  }
  function exportCard(card) {
    return {
      name: card.name,
      description: card.description,
      steps: card.steps.map((s) => ({ tool: s.tool, args: s.args, note: s.note }))
    };
  }

  // src/popup/cards.ts
  function argSummary(args) {
    try {
      const s = JSON.stringify(args);
      return s && s !== "{}" ? s.slice(0, 90) : "";
    } catch {
      return "";
    }
  }
  function renderSteps(c) {
    const rows = c.steps.map((s, i) => `
    <div class="step-row" id="step-${c.id}-${i}">
      <div class="step-idx">${i + 1}</div>
      <div class="step-body">
        <div class="step-note">${esc(s.note)}</div>
        <div class="step-tool">${esc(s.tool)} ${esc(argSummary(s.args))}</div>
      </div>
    </div>`).join("");
    return `<div class="card-steps">${rows}</div>`;
  }
  async function renderCards() {
    state.cards = await getCards();
    cardsList.querySelectorAll(".card-item").forEach((e) => e.remove());
    if (!state.cards.length) {
      cardsEmpty.style.display = "block";
      return;
    }
    cardsEmpty.style.display = "none";
    for (const c of state.cards) {
      const expanded = c.id === state.expandedCardId;
      const el = document.createElement("div");
      el.className = "card-item" + (c.id === state.runningCardId ? " running" : "");
      el.innerHTML = `
      <div class="card-item-top">
        <span class="card-item-name">${esc(c.name)}</span>
        <span class="card-item-meta">${c.steps.length} \u6B65</span>
      </div>
      ${c.description ? `<div class="card-item-desc">${esc(c.description)}</div>` : ""}
      <div class="card-item-actions">
        ${c.id === state.runningCardId ? `<button class="mini-btn danger" data-act="stop">\u505C\u6B62</button>` : `<button class="mini-btn" data-act="run">\u25B6 \u6267\u884C</button>`}
        <button class="mini-btn" data-act="view">${expanded ? "\u6536\u8D77" : "\u67E5\u770B"}</button>
        <button class="mini-btn" data-act="export">\u5BFC\u51FA</button>
        <button class="mini-btn danger" data-act="delete">\u5220\u9664</button>
      </div>
      ${expanded ? renderSteps(c) : ""}`;
      el.querySelectorAll("button[data-act]").forEach((btn) => {
        btn.addEventListener("click", () => void onCardAction(c.id, btn.dataset.act));
      });
      cardsList.appendChild(el);
    }
  }
  async function onCardAction(id, act) {
    const card = state.cards.find((c) => c.id === id);
    if (!card)
      return;
    switch (act) {
      case "run":
        if (state.runningCardId) {
          cardsRunStatus.textContent = "\u5DF2\u6709\u5361\u7247\u5728\u6267\u884C\uFF0C\u8BF7\u5148\u505C\u6B62";
          return;
        }
        state.runningCardId = id;
        state.expandedCardId = id;
        cardsRunStatus.textContent = `\u5F00\u59CB\u6267\u884C\uFF1A${card.name}`;
        state.port.postMessage({ type: "card:run", cardId: id });
        await renderCards();
        break;
      case "stop":
        state.port.postMessage({ type: "card:stop" });
        break;
      case "view":
        state.expandedCardId = state.expandedCardId === id ? null : id;
        await renderCards();
        break;
      case "export":
        exportDownload(`${card.name || "card"}.json`, exportCard(card));
        break;
      case "delete":
        if (confirm(`\u786E\u5B9A\u5220\u9664\u5361\u7247\u300C${card.name}\u300D\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u6062\u590D\u3002`)) {
          await deleteCard(id);
          if (state.expandedCardId === id)
            state.expandedCardId = null;
          await renderCards();
        }
        break;
    }
  }
  function exportDownload(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.replace(/[^\w.\-一-龥]+/g, "_");
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1e3);
  }
  function askMergeChoice(name) {
    return new Promise((resolve) => {
      cardModalMsg.textContent = `\u5361\u7247\u300C${name}\u300D\u5DF2\u5B58\u5728\uFF0C\u662F\u5426\u5408\u5E76\u6B65\u9AA4\uFF1F\u5408\u5E76\u4F1A\u628A\u5BFC\u5165\u7684\u6B65\u9AA4\u8FFD\u52A0\u5230\u73B0\u6709\u5361\u7247\u672B\u5C3E\u3002`;
      cardModal.classList.remove("hidden");
      const done = (r) => {
        cardModal.classList.add("hidden");
        cmMerge.onclick = cmReplace.onclick = cmSkip.onclick = null;
        resolve(r);
      };
      cmMerge.onclick = () => done("merge");
      cmReplace.onclick = () => done("replace");
      cmSkip.onclick = () => done("skip");
    });
  }
  async function doImportText(text) {
    if (!text) {
      cardsImportFeedback.textContent = "\u8BF7\u7C98\u8D34\u5361\u7247 JSON \u6216\u9009\u62E9\u6587\u4EF6";
      cardsImportFeedback.style.color = "var(--error)";
      return;
    }
    let incoming;
    try {
      incoming = parseImport(text);
    } catch (e) {
      cardsImportFeedback.textContent = `\u5BFC\u5165\u5931\u8D25\uFF1A${e?.message || e}`;
      cardsImportFeedback.style.color = "var(--error)";
      return;
    }
    state.cards = await getCards();
    let added = 0, merged = 0, replaced = 0, skipped = 0;
    for (const inc of incoming) {
      const existing = state.cards.find((c) => c.name === inc.name);
      if (existing) {
        const choice = await askMergeChoice(inc.name);
        if (choice === "skip") {
          skipped++;
          continue;
        }
        const idx = state.cards.findIndex((c) => c.id === existing.id);
        if (choice === "merge") {
          state.cards[idx] = mergeCards(existing, inc);
          merged++;
        } else {
          state.cards[idx] = { ...inc, id: existing.id, createdAt: existing.createdAt };
          replaced++;
        }
      } else {
        state.cards.push(inc);
        added++;
      }
    }
    await setCards(state.cards);
    cardsImportText.value = "";
    cardsImportFeedback.textContent = `\u5B8C\u6210\uFF1A\u65B0\u589E ${added}\uFF0C\u5408\u5E76 ${merged}\uFF0C\u66FF\u6362 ${replaced}\uFF0C\u8DF3\u8FC7 ${skipped}`;
    cardsImportFeedback.style.color = "var(--success)";
    await renderCards();
  }
  function wireCards() {
    cardsImportBtn.addEventListener("click", () => cardsImportBox.classList.toggle("hidden"));
    cardsImportConfirm.addEventListener("click", () => void doImportText(cardsImportText.value.trim()));
    cardsImportFileBtn.addEventListener("click", () => cardsImportFile.click());
    cardsImportFile.addEventListener("change", async () => {
      const f = cardsImportFile.files?.[0];
      if (!f)
        return;
      const text = await f.text();
      cardsImportFile.value = "";
      cardsImportBox.classList.remove("hidden");
      await doImportText(text);
    });
    cardsExportAllBtn.addEventListener("click", async () => {
      state.cards = await getCards();
      if (!state.cards.length) {
        cardsRunStatus.textContent = "\u6CA1\u6709\u53EF\u5BFC\u51FA\u7684\u5361\u7247";
        return;
      }
      exportDownload("heysure-cards.json", { cards: state.cards.map(exportCard) });
    });
  }

  // src/popup/ui.ts
  function renderStatus() {
    if (state.offlineMode) {
      statusDot.className = "status-dot offline";
      statusLabel.textContent = "\u79BB\u7EBF\u6A21\u5F0F";
      return;
    }
    statusDot.className = `status-dot ${state.currentStatus}`;
    statusLabel.textContent = state.currentStatus === "registered" ? getConnectedAiShortLabel() : STATUS_LABELS[state.currentStatus] || state.currentStatus;
  }
  function setStatus(status) {
    state.currentStatus = status;
    renderStatus();
  }
  function applyTheme(theme, persist = true) {
    state.currentTheme = theme;
    document.body.className = theme;
    themeToggle.textContent = theme === "dark" ? "\u2600\uFE0F" : "\u{1F319}";
    if (persist)
      state.port.postMessage({ type: "settings:save", payload: { theme } });
  }
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
  function switchTab(tab) {
    state.activeTab = tab;
    Object.keys(panes).forEach((k) => panes[k].classList.add("hidden"));
    Object.keys(tabs).forEach((k) => tabs[k].classList.remove("active"));
    panes[tab].classList.remove("hidden");
    tabs[tab].classList.add("active");
    if (tab === "settings" && state.auth.token && state.members.length === 0)
      void loadMembers();
    if (tab === "cards")
      void renderCards();
  }
  function openLoginModal() {
    loginModal.classList.remove("hidden");
    updateUserChip();
    setTimeout(() => {
      if (!state.auth.token)
        loginAccount.focus();
    }, 0);
  }
  function closeLoginModal() {
    loginModal.classList.add("hidden");
  }
  function openMembersModal() {
    membersModal.classList.remove("hidden");
    if (state.auth.token && state.members.length === 0)
      void loadMembers();
    else
      renderMembers();
  }
  function closeMembersModal() {
    membersModal.classList.add("hidden");
  }
  function updateUserChip() {
    const auth = state.auth;
    if (auth.token) {
      userChip.classList.remove("guest");
      userAva.innerHTML = currentAvatarHtml((auth.userName || auth.account || "?").slice(0, 1).toUpperCase());
      userName.textContent = auth.userName || auth.account || "\u5DF2\u767B\u5F55";
    } else {
      userChip.classList.add("guest");
      userAva.textContent = "\xB7";
      userName.textContent = "\u672A\u767B\u5F55";
    }
    connectionControlCard.classList.toggle("hidden", !auth.token);
    memberSettingsCard.classList.toggle("hidden", !auth.token);
    accountCard.classList.toggle("hidden", !auth.token);
    loginGate.classList.toggle("hidden", !!auth.token);
    accountStatusV.textContent = auth.token ? `\u5DF2\u767B\u5F55\uFF1A${auth.userName || auth.account}` : "\u672A\u767B\u5F55";
    logoutBtn.style.display = auth.token ? "block" : "none";
  }
  function updateOfflineUi() {
    offlineModelConfig.classList.toggle("hidden", !state.offlineMode);
    renderStatus();
  }
  function renderSettingsViews() {
    const m = memberById(state.selectedMemberId);
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
  }
  function wireUi() {
    ;
    Object.keys(tabs).forEach((k) => tabs[k].addEventListener("click", () => switchTab(k)));
    themeToggle.addEventListener("click", () => applyTheme(state.currentTheme === "dark" ? "light" : "dark"));
    clearBtn.addEventListener("click", () => {
      feed.querySelectorAll(".entry").forEach((e) => e.remove());
      feedEmpty.style.display = "flex";
    });
  }

  // src/popup/settings.ts
  function loadSettings(s) {
    state.serverUrl = s.serverUrl || "";
    state.selectedMemberId = s.selectedAiConfigId || null;
    cfgServer.value = s.serverUrl || "";
    cfgAgentServer.value = s.agentServerUrl || "";
    cfgAiKey.value = s.aiKey || "";
    cfgAiBase.value = s.aiBaseUrl || "";
    cfgAiModel.value = s.aiModel || "";
    cfgAutoConn.checked = !!s.autoConnect;
    state.offlineMode = !!s.offlineMode;
    cfgOfflineMode.checked = state.offlineMode;
    cfgMouseFx.checked = s.mouseFx !== false;
    state.localModel = s.aiModel || "";
    state.hasAiKey = !!s.aiKey?.trim();
    updateOfflineUi();
    renderMembers();
    applyTheme(s.theme || "dark", false);
  }
  var PROVIDER_PRESETS = {
    anthropic: { base: "https://api.anthropic.com", model: "claude-sonnet-4-5" },
    openai: { base: "https://api.openai.com", model: "gpt-4o" },
    deepseek: { base: "https://api.deepseek.com", model: "deepseek-chat" },
    openrouter: { base: "https://openrouter.ai/api", model: "anthropic/claude-3.5-sonnet" },
    ollama: { base: "http://localhost:11434", model: "llama3.1" }
  };
  function wireSettings() {
    cfgAiProvider.addEventListener("change", () => {
      const p = PROVIDER_PRESETS[cfgAiProvider.value];
      if (p) {
        cfgAiBase.value = p.base;
        cfgAiModel.value = p.model;
      }
      cfgAiProvider.value = "";
    });
    cfgOfflineMode.addEventListener("change", () => {
      state.offlineMode = cfgOfflineMode.checked;
      updateOfflineUi();
      state.port.postMessage({ type: "settings:save", payload: { offlineMode: state.offlineMode } });
    });
    cfgMouseFx.addEventListener("change", () => {
      state.port.postMessage({ type: "settings:save", payload: { mouseFx: cfgMouseFx.checked } });
    });
    saveBtn.addEventListener("click", () => {
      const payload = {
        serverUrl: cfgServer.value.trim(),
        agentServerUrl: cfgAgentServer.value.trim(),
        aiKey: cfgAiKey.value.trim(),
        aiBaseUrl: cfgAiBase.value.trim() || "https://api.anthropic.com",
        aiModel: cfgAiModel.value.trim() || "claude-sonnet-4-5",
        autoConnect: cfgAutoConn.checked,
        offlineMode: cfgOfflineMode.checked,
        mouseFx: cfgMouseFx.checked
      };
      state.serverUrl = payload.serverUrl || "";
      state.offlineMode = !!payload.offlineMode;
      state.localModel = payload.aiModel || "";
      state.port.postMessage({ type: "settings:save", payload });
      state.hasAiKey = !!payload.aiKey;
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
      state.port.postMessage({ type: "connection:test" });
    });
    connectBtn.addEventListener("click", () => state.port.postMessage({ type: "agent:connect" }));
    disconnectBtn.addEventListener("click", () => state.port.postMessage({ type: "agent:disconnect" }));
  }

  // src/popup/index.ts
  function initPort() {
    state.port = chrome.runtime.connect({ name: "popup" });
    state.port.onMessage.addListener((msg) => {
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
        case "connection:result": {
          const r = msg.result || {};
          const http = r.http || (typeof r.status !== "undefined" ? r : null);
          const lines = [];
          if (http) {
            lines.push(http.success ? `HTTP \u2713 ${http.status} \xB7 ${http.ms}ms` : `HTTP \u2717 ${http.error}`);
          }
          if (Array.isArray(r.agentProbes) && r.agentProbes.length) {
            for (const p of r.agentProbes) {
              lines.push(p.ok ? `Agent \u2713 ${p.url}` : `Agent \u2717 ${p.url} \u2014 ${p.reason || ""}`);
            }
            if (r.agentOkUrl)
              lines.push(`\u5C06\u8FDE\u63A5\u5230\uFF1A${r.agentOkUrl}`);
          } else if (r.needsLogin) {
            lines.push("Agent: \u672A\u767B\u5F55\uFF0C\u8DF3\u8FC7\u63A2\u6D4B");
          }
          const ok = !!(http?.success && (!r.agentProbes?.length || r.agentOkUrl));
          testResult.textContent = lines.join("\n") || (ok ? "\u2713 \u5DF2\u8FDE\u63A5" : "\u2717 \u672A\u8FDE\u63A5");
          testResult.className = `test-result ${ok ? "ok" : "fail"}`;
          testResult.style.whiteSpace = "pre-line";
          break;
        }
        case "card:progress": {
          cardsRunStatus.textContent = `\u6267\u884C\u4E2D [${msg.index + 1}/${msg.total}] ${msg.note}` + (msg.status === "error" ? ` \u2717 ${msg.error || ""}` : msg.status === "success" ? " \u2713" : "");
          const row = document.getElementById(`step-${msg.cardId}-${msg.index}`);
          if (row) {
            row.classList.remove("cur", "ok", "err");
            row.classList.add(msg.status === "success" ? "ok" : msg.status === "error" ? "err" : "cur");
          }
          break;
        }
        case "card:done": {
          state.runningCardId = null;
          cardsRunStatus.textContent = msg.success ? "\u2713 \u5361\u7247\u6267\u884C\u5B8C\u6210" : msg.reason === "stopped" ? "\u5DF2\u505C\u6B62" : `\u2717 \u6267\u884C\u5931\u8D25\uFF1A${msg.reason || ""}`;
          void renderCards();
          break;
        }
      }
    });
    state.port.onDisconnect.addListener(() => {
      setTimeout(initPort, 1e3);
    });
    state.port.postMessage({ type: "settings:get" });
  }
  async function init() {
    initPort();
    switchTab("cards");
    const s = await getSettings();
    state.serverUrl = s.serverUrl || "";
    state.offlineMode = !!s.offlineMode;
    state.localModel = s.aiModel || "";
    state.selectedMemberId = s.selectedAiConfigId || null;
    state.auth = await getAuth();
    loginAccount.value = state.auth.account || "";
    updateUserChip();
    updateOfflineUi();
    void refreshAvatarCache().then(updateUserChip);
    if (state.auth.token) {
      void (async () => {
        try {
          const me = await getMe(state.serverUrl, state.auth.token);
          state.auth.userName = me?.name || state.auth.userName;
          state.auth.avatar = me?.avatar || "";
          await saveAuth({ userName: state.auth.userName, avatar: state.auth.avatar });
          await refreshAvatarCache();
          updateUserChip();
          await loadMembers();
        } catch (err) {
          if (isAuthError(err)) {
            await doLogout();
          } else {
            console.warn("getMe failed (transient), keeping session", err);
            loginFeedback.textContent = "\u6682\u65F6\u65E0\u6CD5\u8FDE\u63A5\u670D\u52A1\u5668\uFF0C\u7A0D\u540E\u5C06\u81EA\u52A8\u91CD\u8BD5";
            loginFeedback.style.color = "var(--warn)";
            try {
              await loadMembers();
            } catch {
            }
          }
        }
      })();
    }
  }
  wireUi();
  wireMembers();
  wireCards();
  wireSettings();
  void init();
})();
