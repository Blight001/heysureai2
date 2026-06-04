(() => {
  // src/popup/state.ts
  var state = {
    currentTheme: "dark",
    currentStatus: "disconnected",
    // Server-side bound AI for this device (from agent:registered). null = none
    // assigned yet → status indicator shows yellow instead of green.
    boundAiConfigId: null,
    hasAiKey: false,
    // Assigned in initPort(); listeners that read it only fire after init.
    port: void 0,
    serverUrl: "",
    offlineMode: false,
    localModel: "",
    auth: { token: "", account: "", password: "", rememberLogin: false, userId: null, userName: "", avatar: "" },
    // Cached data URL for the current account's avatar (hydrated from storage).
    avatarDataUrl: "",
    members: [],
    // ── Tool-call statistics (this popup session) ──
    stats: { total: 0, running: 0, success: 0, failed: 0 },
    // ── MCP tool page view state ──
    // Currently opened tool name in the detail view, or null for the list.
    openToolName: null,
    // Pending mcp:test requestId → resolver, so the detail view can await a run.
    pendingTests: /* @__PURE__ */ new Map()
  };

  // src/popup/dom.ts
  var $ = (id) => document.getElementById(id);
  var statusDot = $("status-dot");
  var statusLabel = $("status-label");
  var statusPill = $("status-pill");
  var themeToggle = $("theme-toggle");
  var settingsBtn = $("settings-btn");
  var userChip = $("user-chip");
  var userAva = $("user-ava");
  var userName = $("user-name");
  var mcpListPane = $("mcp-list-pane");
  var mcpDetailPane = $("mcp-detail-pane");
  var mcpList = $("mcp-list");
  var mcpCount = $("mcp-count");
  var mcpDetail = $("mcp-detail");
  var mcpBack = $("mcp-back");
  var settingsModal = $("settings-modal");
  var settingsClose = $("settings-close");
  var cfgServer = $("cfg-server");
  var cfgAiKey = $("cfg-ai-key");
  var cfgAiBase = $("cfg-ai-base");
  var cfgAiModel = $("cfg-ai-model");
  var cfgOfflineMode = $("cfg-offline-mode");
  var offlineModelConfig = $("offline-model-config");
  var cfgAiProvider = $("cfg-ai-provider");
  var cfgMouseFx = $("cfg-mouse-fx");
  var saveBtn = $("save-btn");
  var saveFeedback = $("save-feedback");
  var statTotal = $("stat-total");
  var statRunning = $("stat-running");
  var statSuccess = $("stat-success");
  var statFailed = $("stat-failed");
  var membersModal = $("members-modal");
  var membersModalClose = $("members-modal-close");
  var connectionStatusV = $("connection-status-v");
  var aiStatusV = $("ai-status-v");
  var serverStatusV = $("server-status-v");
  var connectBtn = $("connect-btn");
  var disconnectBtn = $("disconnect-btn");
  var loginModal = $("login-modal");
  var loginModalClose = $("login-modal-close");
  var loginGate = $("login-gate");
  var accountCard = $("account-card");
  var accountStatusV = $("account-status-v");
  var loginAccount = $("login-account");
  var loginPassword = $("login-password");
  var loginRemember = $("login-remember");
  var loginBtn = $("login-btn");
  var loginFeedback = $("login-feedback");
  var logoutBtn = $("logout-btn");

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
  var AUTH_DEFAULT = {
    token: "",
    account: "",
    password: "",
    rememberLogin: false,
    userId: null,
    userName: "",
    avatar: ""
  };
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
    const remembered = !!current.rememberLogin;
    await chrome.storage.local.set({
      [AUTH_KEY]: {
        ...AUTH_DEFAULT,
        account: remembered ? current.account : "",
        password: remembered ? current.password : "",
        rememberLogin: remembered
      }
    });
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
  var TOOL_DESC_KEY = "_tool_desc_overrides";
  async function getToolDescOverrides() {
    const r = await chrome.storage.local.get(TOOL_DESC_KEY);
    const v = r[TOOL_DESC_KEY];
    return v && typeof v === "object" ? v : {};
  }
  async function setToolDescOverride(tool, override) {
    const all = await getToolDescOverrides();
    const name = String(tool || "").trim();
    if (!name)
      return;
    const desc = String(override.description || "").trim();
    const params = {};
    for (const [k, v] of Object.entries(override.parameters || {})) {
      const pn = String(k || "").trim();
      const pv = String(v || "").trim();
      if (pn && pv)
        params[pn] = pv;
    }
    if (!desc && Object.keys(params).length === 0) {
      delete all[name];
    } else {
      all[name] = { description: desc, parameters: params };
    }
    await chrome.storage.local.set({ [TOOL_DESC_KEY]: all });
  }
  var TOOL_ENABLED_KEY = "_tool_enabled";
  async function getToolEnabledMap() {
    const r = await chrome.storage.local.get(TOOL_ENABLED_KEY);
    const v = r[TOOL_ENABLED_KEY];
    return v && typeof v === "object" ? v : {};
  }
  async function setToolEnabled(tool, enabled) {
    const all = await getToolEnabledMap();
    const name = String(tool || "").trim();
    if (!name)
      return;
    all[name] = !!enabled;
    await chrome.storage.local.set({ [TOOL_ENABLED_KEY]: all });
  }
  async function setManyToolEnabled(tools, enabled) {
    const all = await getToolEnabledMap();
    for (const t of tools) {
      const name = String(t || "").trim();
      if (name)
        all[name] = !!enabled;
    }
    await chrome.storage.local.set({ [TOOL_ENABLED_KEY]: all });
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

  // src/popup/markdown.ts
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // src/popup/helpers.ts
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

  // src/popup/transport.ts
  var currentPort = null;
  var messageHandler = null;
  var reconnectTimer = null;
  var pendingMessages = [];
  function clearReconnectTimer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }
  function scheduleReconnect() {
    if (!messageHandler || reconnectTimer)
      return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectPort();
    }, 1e3);
  }
  function flushPendingMessages() {
    if (!currentPort || !messageHandler)
      return;
    while (pendingMessages.length) {
      const msg = pendingMessages.shift();
      try {
        currentPort.postMessage(msg);
      } catch {
        pendingMessages.unshift(msg);
        currentPort = null;
        scheduleReconnect();
        return;
      }
    }
  }
  function connectPort() {
    if (!messageHandler)
      return;
    if (currentPort)
      return currentPort;
    const port = chrome.runtime.connect({ name: "popup" });
    currentPort = port;
    state.port = port;
    port.onMessage.addListener(messageHandler);
    port.onDisconnect.addListener(() => {
      if (currentPort !== port)
        return;
      currentPort = null;
      scheduleReconnect();
    });
    flushPendingMessages();
    return port;
  }
  function initPopupPort(onMessage) {
    messageHandler = onMessage;
    clearReconnectTimer();
    connectPort();
  }
  function sendToBackground(msg) {
    if (!currentPort) {
      pendingMessages.push(msg);
      scheduleReconnect();
      connectPort();
      return false;
    }
    try {
      currentPort.postMessage(msg);
      return true;
    } catch {
      pendingMessages.push(msg);
      currentPort = null;
      scheduleReconnect();
      connectPort();
      return false;
    }
  }

  // src/popup/members.ts
  function renderConnectionInfo() {
    const connected = state.currentStatus === "registered" || state.currentStatus === "connected";
    connectionStatusV.textContent = connected ? "\u5DF2\u8FDE\u63A5\u5230\u670D\u52A1\u5668" : "\u672A\u8FDE\u63A5\u5230\u670D\u52A1\u5668";
    aiStatusV.textContent = state.boundAiConfigId == null ? "\u672A\u5206\u914D" : "\u5DF2\u5206\u914D AI";
    serverStatusV.textContent = state.serverUrl || "-";
    renderStatus();
  }
  async function doLogin() {
    const configuredServerUrl = cfgServer.value.trim();
    if (configuredServerUrl && configuredServerUrl !== state.serverUrl) {
      state.serverUrl = configuredServerUrl;
      await saveSettings({ serverUrl: state.serverUrl });
      sendToBackground({ type: "settings:save", payload: { serverUrl: state.serverUrl } });
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
      const rememberLogin = loginRemember.checked;
      state.auth = {
        token,
        account: rememberLogin ? account : "",
        password: rememberLogin ? password : "",
        rememberLogin,
        userId: user?.id ?? null,
        userName: user?.name || account,
        avatar: user?.avatar || ""
      };
      await saveAuth(state.auth);
      if (!rememberLogin) {
        loginAccount.value = "";
        loginPassword.value = "";
      }
      loginFeedback.textContent = "\u767B\u5F55\u6210\u529F \u2713";
      loginFeedback.style.color = "var(--success)";
      updateUserChip();
      await refreshAvatarCache();
      updateUserChip();
      sendToBackground({ type: "agent:connect" });
      closeLoginModal();
      openMembersModal();
    } catch (err) {
      loginFeedback.textContent = `\u767B\u5F55\u5931\u8D25\uFF1A${err?.message || err}`;
      loginFeedback.style.color = "var(--error)";
      sendToBackground({ type: "agent:connect" });
    } finally {
      loginBtn.disabled = false;
    }
  }
  async function doLogout() {
    await clearAuth();
    sendToBackground({ type: "auth:logout" });
    state.auth = await getAuth();
    loginAccount.value = state.auth.account || "";
    loginPassword.value = state.auth.password || "";
    loginRemember.checked = !!state.auth.rememberLogin;
    state.avatarDataUrl = "";
    await clearAvatarCache();
    closeMembersModal();
    updateUserChip();
    renderConnectionInfo();
  }
  function renderMembers() {
    renderConnectionInfo();
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
    membersModal.addEventListener("click", (e) => {
      if (e.target === membersModal)
        closeMembersModal();
    });
    membersModalClose.addEventListener("click", () => closeMembersModal());
    logoutBtn.addEventListener("click", () => void doLogout());
    connectBtn.addEventListener("click", () => sendToBackground({ type: "agent:connect" }));
    disconnectBtn.addEventListener("click", () => sendToBackground({ type: "agent:disconnect" }));
  }

  // src/popup/ui.ts
  function renderStatus() {
    const connected = state.currentStatus === "registered" || state.currentStatus === "connected";
    let color;
    let label;
    if (state.offlineMode) {
      color = "red";
      label = "\u79BB\u7EBF\u6A21\u5F0F";
    } else if (!connected) {
      color = "red";
      label = "\u672A\u8FDE\u63A5";
    } else if (state.boundAiConfigId == null) {
      color = "yellow";
      label = "\u672A\u5206\u914D";
    } else {
      color = "green";
      label = "\u5DF2\u8FDE\u63A5";
    }
    statusDot.className = `status-dot ${color}`;
    statusLabel.textContent = label;
  }
  function setStatus(status) {
    state.currentStatus = status;
    if (status !== "registered" && status !== "connected")
      state.boundAiConfigId = null;
    renderStatus();
    renderMembers();
  }
  function setBoundAi(aiConfigId) {
    state.boundAiConfigId = aiConfigId;
    renderStatus();
    renderMembers();
  }
  function applyTheme(theme, persist = true) {
    state.currentTheme = theme;
    document.body.className = theme;
    themeToggle.textContent = theme === "dark" ? "\u2600\uFE0F" : "\u{1F319}";
    if (persist)
      sendToBackground({ type: "settings:save", payload: { theme } });
  }
  function renderStats() {
    statTotal.textContent = String(state.stats.total);
    statRunning.textContent = String(state.stats.running);
    statSuccess.textContent = String(state.stats.success);
    statFailed.textContent = String(state.stats.failed);
  }
  function openSettingsModal() {
    settingsModal.classList.remove("hidden");
  }
  function closeSettingsModal() {
    settingsModal.classList.add("hidden");
  }
  function openLoginModal() {
    loginModal.classList.remove("hidden");
    updateUserChip();
    loginAccount.value = state.auth.account || "";
    loginPassword.value = state.auth.password || "";
    loginRemember.checked = !!state.auth.rememberLogin;
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
    accountCard.style.display = auth.token ? "block" : "none";
    loginGate.classList.toggle("hidden", !!auth.token);
    accountStatusV.textContent = auth.token ? `\u5DF2\u767B\u5F55\uFF1A${auth.userName || auth.account}` : "\u672A\u767B\u5F55";
  }
  function updateOfflineUi() {
    offlineModelConfig.classList.toggle("hidden", !state.offlineMode);
    renderStatus();
    renderMembers();
  }
  function wireUi() {
    themeToggle.addEventListener("click", () => applyTheme(state.currentTheme === "dark" ? "light" : "dark"));
    settingsBtn.addEventListener("click", () => openSettingsModal());
    settingsClose.addEventListener("click", () => closeSettingsModal());
    settingsModal.addEventListener("click", (e) => {
      if (e.target === settingsModal)
        closeSettingsModal();
    });
    statusPill.addEventListener("click", () => openMembersModal());
  }

  // src/popup/settings.ts
  function loadSettings(s) {
    state.serverUrl = s.serverUrl || "";
    cfgServer.value = s.serverUrl || "";
    cfgAiKey.value = s.aiKey || "";
    cfgAiBase.value = s.aiBaseUrl || "";
    cfgAiModel.value = s.aiModel || "";
    state.offlineMode = !!s.offlineMode;
    cfgOfflineMode.checked = state.offlineMode;
    cfgMouseFx.checked = s.mouseFx !== false;
    state.localModel = s.aiModel || "";
    state.hasAiKey = !!s.aiKey?.trim();
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
      sendToBackground({ type: "settings:save", payload: { offlineMode: state.offlineMode } });
    });
    cfgMouseFx.addEventListener("change", () => {
      sendToBackground({ type: "settings:save", payload: { mouseFx: cfgMouseFx.checked } });
    });
    saveBtn.addEventListener("click", () => {
      const payload = {
        serverUrl: cfgServer.value.trim(),
        aiKey: cfgAiKey.value.trim(),
        aiBaseUrl: cfgAiBase.value.trim() || "https://api.anthropic.com",
        aiModel: cfgAiModel.value.trim() || "claude-sonnet-4-5",
        offlineMode: cfgOfflineMode.checked,
        mouseFx: cfgMouseFx.checked
      };
      state.serverUrl = payload.serverUrl || "";
      state.offlineMode = !!payload.offlineMode;
      state.localModel = payload.aiModel || "";
      state.hasAiKey = !!payload.aiKey;
      sendToBackground({ type: "settings:save", payload });
      updateOfflineUi();
      saveFeedback.textContent = "\u5DF2\u4FDD\u5B58 \u2713";
      saveFeedback.style.color = "var(--success)";
      setTimeout(() => {
        saveFeedback.textContent = "";
      }, 2e3);
    });
  }

  // src/lib/tools/definitions.ts
  var SEARCH_ENGINES = {
    google: "https://www.google.com/search?q=",
    bing: "https://www.bing.com/search?q=",
    duckduckgo: "https://duckduckgo.com/?q=",
    baidu: "https://www.baidu.com/s?wd=",
    github: "https://github.com/search?q=",
    youtube: "https://www.youtube.com/results?search_query=",
    wikipedia: "https://en.wikipedia.org/wiki/Special:Search?search=",
    stackoverflow: "https://stackoverflow.com/search?q=",
    npm: "https://www.npmjs.com/search?q=",
    pypi: "https://pypi.org/search/?q=",
    mdn: "https://developer.mozilla.org/en-US/search?q="
  };
  var BROWSER_TOOLS = [
    // ───── 导航与搜索 ─────────────────────────────────────────────────────
    {
      name: "browser_navigate",
      description: "\u5728\u5F53\u524D\u6D4F\u89C8\u5668\u6807\u7B7E\u9875\u6253\u5F00\u6307\u5B9A URL\uFF0C\u9875\u9762\u52A0\u8F7D\u5B8C\u6210\u540E\u8FD4\u56DE\u3002\u7528\u9014\uFF1A\u8DF3\u8F6C\u5230\u76EE\u6807\u7F51\u5740\u5F00\u59CB\u4E00\u6BB5\u6D4F\u89C8\u4EFB\u52A1\u3002\u573A\u666F\uFF1A\u8FDB\u5165\u767B\u5F55\u9875\u3001\u6253\u5F00\u6587\u7AE0\u3001\u8DF3\u8F6C\u5230\u540E\u53F0\u7BA1\u7406\u9875\u7B49\u3002",
      input_schema: {
        type: "object",
        properties: {
          url: { type: "string", description: "\u8981\u6253\u5F00\u7684\u7EDD\u5BF9 URL\uFF08\u9700\u5305\u542B http(s)://\uFF09\u3002" },
          new_tab: { type: "boolean", description: "\u4E3A true \u65F6\u5728\u65B0\u6807\u7B7E\u9875\u6253\u5F00\uFF0C\u800C\u4E0D\u662F\u66FF\u6362\u5F53\u524D\u9875\u3002" }
        },
        required: ["url"]
      }
    },
    {
      name: "browser_search",
      description: "\u7528\u4E3B\u6D41\u641C\u7D22\u5F15\u64CE\u68C0\u7D22\u7F51\u7EDC\u3002\u7528\u9014\uFF1A\u5728\u6D4F\u89C8\u5668\u5185\u53D1\u8D77\u4E00\u6B21\u7AD9\u70B9\u641C\u7D22\u3002\u573A\u666F\uFF1A\u7528 Google/Bing/\u767E\u5EA6\u7B49\u67E5\u8D44\u6599\uFF1B\u6CE8\u610F\u8FD9\u4F1A\u771F\u6B63\u6253\u5F00\u641C\u7D22\u7ED3\u679C\u9875\uFF08\u4E0E\u670D\u52A1\u5668\u7AEF web.search \u7684\u7EAF\u6570\u636E\u68C0\u7D22\u4E0D\u540C\uFF09\u3002",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "\u641C\u7D22\u5173\u952E\u8BCD\u3002" },
          engine: {
            type: "string",
            enum: Object.keys(SEARCH_ENGINES),
            description: "\u641C\u7D22\u5F15\u64CE\uFF0C\u9ED8\u8BA4 google\uFF1B\u53EF\u9009 bing\u3001baidu\u3001duckduckgo\u3001github \u7B49\u3002"
          }
        },
        required: ["query"]
      }
    },
    {
      name: "browser_history",
      description: "\u5728\u5F53\u524D\u6807\u7B7E\u7684\u6D4F\u89C8\u5386\u53F2\u4E2D\u540E\u9000\u6216\u524D\u8FDB\u4E00\u6B65\u3002\u7528\u9014\uFF1A\u5728\u5DF2\u8BBF\u95EE\u8FC7\u7684\u9875\u9762\u95F4\u56DE\u9000/\u524D\u8FDB\u3002\u573A\u666F\uFF1A\u8BEF\u5165\u8BE6\u60C5\u9875\u540E\u9000\u56DE\u5217\u8868\uFF08back\uFF09\u3001\u540E\u9000\u540E\u53C8\u60F3\u56DE\u5230\u521A\u624D\u7684\u9875\u9762\uFF08forward\uFF09\u3002",
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["back", "forward"], description: "\u5386\u53F2\u52A8\u4F5C\uFF1Aback \u540E\u9000\u4E00\u6B65\u3001forward \u524D\u8FDB\u4E00\u6B65\u3002" }
        },
        required: ["action"]
      }
    },
    // ───── 页面观察 ───────────────────────────────────────────────────────
    {
      name: "browser_observe",
      description: "\u611F\u77E5\u5F53\u524D\u89C6\u53E3\u91CC\u300C\u7528\u6237\u80FD\u770B\u5230\u4E14\u53EF\u70B9\u51FB\u300D\u7684\u5143\u7D20\uFF1A\u53EA\u8FD4\u56DE\u6700\u9876\u5C42\u3001\u672A\u88AB\u906E\u6321\u7684\u53EF\u4EA4\u4E92\u5143\u7D20\uFF08\u6309\u94AE/\u94FE\u63A5/\u8F93\u5165\u6846/\u4E0B\u62C9/\u83DC\u5355\u9879\u7B49\uFF09\uFF0C\u6BCF\u4E2A\u5E26\u7F16\u53F7 id\u3001\u89D2\u8272 role\u3001\u6587\u672C\u548C\u4E2D\u5FC3\u5750\u6807 center\uFF0C\u5E76\u9ED8\u8BA4\u5728\u9875\u9762\u4E0A\u753B\u51FA\u5BF9\u5E94\u7F16\u53F7\u6807\u8BB0\u3002\u7528\u9014\uFF1A\u4F5C\u4E3A\u70B9\u51FB/\u8F93\u5165\u524D\u7684\u9996\u9009\u89C2\u5BDF\u624B\u6BB5\uFF0C\u914D\u5408 browser_screenshot \u5F62\u6210\u300C\u770B\u56FE\u2014\u6309\u7F16\u53F7\u70B9\u51FB\u300D\u95ED\u73AF\uFF0C\u907F\u514D\u70B9\u5230\u80CC\u666F\u6216\u88AB\u5F39\u7A97\u906E\u6321\u7684\u5143\u7D20\u3002\u573A\u666F\uFF1A\u64CD\u4F5C\u4EFB\u610F\u5143\u7D20\u524D\u5148 observe\uFF0C\u518D\u7528 browser_click {ref:id} \u7CBE\u786E\u70B9\u51FB\uFF1B\u9875\u9762\u53D8\u5316\uFF08\u6EDA\u52A8/\u5F39\u7A97/\u8DEF\u7531\u5207\u6362\uFF09\u540E\u91CD\u65B0 observe \u4EE5\u5237\u65B0\u7F16\u53F7\u3002",
      input_schema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "\u6700\u591A\u8FD4\u56DE\u7684\u53EF\u4EA4\u4E92\u5143\u7D20\u6570\u3002\u9ED8\u8BA4 60\uFF0C\u6700\u5927 200\u3002" },
          mark: { type: "boolean", description: "\u662F\u5426\u5728\u9875\u9762\u4E0A\u7ED8\u5236\u7F16\u53F7\u6807\u8BB0\uFF0C\u4FBF\u4E8E\u968F\u540E\u622A\u56FE\u67E5\u770B\u3002\u9ED8\u8BA4 true\uFF1B\u4F20 false \u4EC5\u8FD4\u56DE\u5217\u8868\u5E76\u6E05\u9664\u5DF2\u6709\u6807\u8BB0\u3002\u6807\u8BB0\u4EC5\u4E3A\u89C6\u89C9\u53E0\u52A0\uFF0C\u4E0D\u5F71\u54CD get_content/\u622A\u56FE\u4EE5\u5916\u7684\u53D6\u6570\uFF0C\u4E5F\u4E0D\u62E6\u622A\u70B9\u51FB\u3002" }
        }
      }
    },
    {
      name: "browser_screenshot",
      description: "\u5BF9\u5F53\u524D\u6807\u7B7E\u9875\u622A\u56FE\uFF1A\u53EF\u622A\u53EF\u89C6\u533A\u3001\u6574\u9875\u3001\u67D0\u4E2A CSS/\u6587\u672C\u5339\u914D\u7684\u5143\u7D20\uFF0C\u6216\u4E00\u5757\u77E9\u5F62\u533A\u57DF\uFF0C\u9ED8\u8BA4\u8FD4\u56DE\u5B8C\u6574 base64 \u56FE\u7247 dataUrl \u4E14\u4E0D\u4FDD\u5B58\u5230\u670D\u52A1\u5668\uFF08\u622A\u56FE\u88AB\u7981\u7528\u6216\u65E0\u6743\u9650\u65F6\u8FD4\u56DE\u53EF\u8BFB\u7684\u9519\u8BEF\u8BF4\u660E\uFF09\u3002\u7528\u9014\uFF1A\u8BA9 AI\u300C\u770B\u89C1\u300D\u9875\u9762\u3002\u573A\u666F\uFF1A\u6838\u5BF9\u9875\u9762\u72B6\u6001\u3001\u5728\u65E0\u6CD5\u8BFB\u53D6\u6587\u672C\u65F6\u6539\u7528\u89C6\u89C9\u7406\u89E3\uFF1B\u9700\u8981\u7559\u5B58\u8BC1\u636E\u65F6\u4F20 save_to_server:true\u3002",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "\u8981\u622A\u56FE\u7684\u5143\u7D20 CSS selector\u3002" },
          text: { type: "string", description: "\u5F53\u4E0D\u4F20 selector \u65F6\uFF0C\u7528\u53EF\u89C1\u6587\u672C\u5B9A\u4F4D\u8981\u622A\u56FE\u7684\u5143\u7D20\u3002" },
          full_page: { type: "boolean", description: "\u622A\u53D6\u6574\u4E2A\u53EF\u6EDA\u52A8\u9875\u9762\u3002" },
          x: { type: "number", description: "\u533A\u57DF\u5DE6\u4E0A\u89D2 X \u5750\u6807\uFF1B\u9664\u975E coordinate_space \u8BBE\u4E3A page\uFF0C\u5426\u5219\u6309\u89C6\u53E3\u5750\u6807\u3002" },
          y: { type: "number", description: "\u533A\u57DF\u5DE6\u4E0A\u89D2 Y \u5750\u6807\uFF1B\u9664\u975E coordinate_space \u8BBE\u4E3A page\uFF0C\u5426\u5219\u6309\u89C6\u53E3\u5750\u6807\u3002" },
          width: { type: "number", description: "\u533A\u57DF\u5BBD\u5EA6\uFF08CSS \u50CF\u7D20\uFF09\u3002" },
          height: { type: "number", description: "\u533A\u57DF\u9AD8\u5EA6\uFF08CSS \u50CF\u7D20\uFF09\u3002" },
          clip: { type: "object", description: "\u533A\u57DF\u5BF9\u8C61\u5199\u6CD5\uFF1A{x,y,width,height,coordinate_space?}\uFF0C\u4E0E x/y/width/height \u4E8C\u9009\u4E00\u3002" },
          coordinate_space: { type: "string", enum: ["viewport", "page"], description: "x/y/clip \u7684\u5750\u6807\u7CFB\uFF1Aviewport \u89C6\u53E3\u6216 page \u6574\u9875\u3002\u9ED8\u8BA4 viewport\u3002" },
          margin: { type: "number", description: "\u6309 selector/text \u622A\u5143\u7D20\u65F6\uFF0C\u5411\u56DB\u5468\u6269\u5C55\u7684\u989D\u5916 CSS \u50CF\u7D20\u3002" },
          scroll_into_view: { type: "boolean", description: "\u6D4B\u91CF\u524D\u5148\u628A\u76EE\u6807\u5143\u7D20\u6EDA\u52A8\u8FDB\u89C6\u53E3\u3002\u9ED8\u8BA4 true\u3002" },
          format: { type: "string", enum: ["png", "jpeg", "webp"], description: "\u56FE\u7247\u683C\u5F0F\u3002\u9ED8\u8BA4 png\u3002" },
          quality: { type: "number", description: "JPEG/WebP \u8D28\u91CF\uFF0C0-100\u3002" },
          scale: { type: "number", description: "CDP \u622A\u56FE\u7684\u7F29\u653E\u6BD4\u4F8B\u3002\u9ED8\u8BA4 1\u3002" },
          max_area: { type: "number", description: "\u5141\u8BB8\u7684\u6700\u5927\u622A\u56FE\u9762\u79EF\uFF08CSS \u50CF\u7D20\uFF09\u3002\u9ED8\u8BA4 25000000\u3002" },
          retries: { type: "number", description: "\u53EF\u89C6\u533A\u622A\u56FE\u9047\u5230\u6D3B\u52A8\u6807\u7B7E/\u9650\u6D41\u7B49\u4E34\u65F6\u5931\u8D25\u65F6\u7684\u91CD\u8BD5\u6B21\u6570\u3002\u9ED8\u8BA4 1\u3002" },
          timeout_ms: { type: "number", description: "\u5355\u9636\u6BB5\u622A\u56FE\u603B\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09\u3002\u53EF\u89C6\u622A\u56FE\u9ED8\u8BA4 8000\uFF0CCDP \u9ED8\u8BA4 12000\u3002" },
          visible_timeout_ms: { type: "number", description: "chrome.tabs.captureVisibleTab \u7684\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09\u3002\u9ED8\u8BA4 8000\u3002" },
          cdp_timeout_ms: { type: "number", description: "\u6BCF\u6761 Chrome DevTools Protocol \u622A\u56FE\u547D\u4EE4\u7684\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09\u3002\u9ED8\u8BA4 12000\u3002" },
          content_timeout_ms: { type: "number", description: "\u5728\u9875\u9762\u4E2D\u6D4B\u91CF selector/text \u76EE\u6807\u7684\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09\u3002\u9ED8\u8BA4 5000\u3002" },
          max_data_url_chars: { type: "number", description: "\u7ECF Socket.IO \u8FD4\u56DE\u7684 data URL \u6700\u5927\u957F\u5EA6\u3002\u9ED8\u8BA4 8000000\u3002" },
          allow_large_data_url: { type: "boolean", description: "\u5141\u8BB8\u8FD4\u56DE\u8D85\u8FC7 max_data_url_chars \u7684\u622A\u56FE\u3002\u9ED8\u8BA4 false\u3002" },
          save_to_server: { type: "boolean", description: "\u662F\u5426\u628A\u622A\u56FE\u4FDD\u5B58\u5230\u670D\u52A1\u5668\u5E76\u8FD4\u56DE\u670D\u52A1\u5668\u8DEF\u5F84/URL\u3002\u9ED8\u8BA4 false\uFF0C\u4E0D\u4FDD\u5B58\u4E14\u4FDD\u7559\u5B8C\u6574 dataUrl\u3002" },
          upload_to_server: { type: "boolean", description: "save_to_server \u7684\u517C\u5BB9\u522B\u540D\u3002\u9ED8\u8BA4 false\u3002" },
          task_timeout_ms: { type: "number", description: "\u672C\u6B21\u622A\u56FE\u4EFB\u52A1\u5728\u7AEF\u70B9 agent \u4E0A\u7684\u786C\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09\u3002\u9ED8\u8BA4 35000\u3002" },
          fallback_visible: { type: "boolean", description: "\u5143\u7D20/\u533A\u57DF/\u6574\u9875\u622A\u56FE\u65F6\uFF0C\u82E5\u7CBE\u786E CDP \u622A\u56FE\u5931\u8D25\u5219\u56DE\u9000\u4E3A\u53EF\u89C6\u533A\u622A\u56FE\u3002\u9ED8\u8BA4 false\u3002" }
        }
      }
    },
    {
      name: "browser_get_content",
      description: "\u8BFB\u53D6\u5F53\u524D\u9875\u9762\u7684\u53EF\u89C1\u6587\u672C\u3001URL\u3001\u6807\u9898\u3001\u94FE\u63A5\u3001meta \u4FE1\u606F\u548C\u5F52\u4E00\u5316\u6761\u76EE\u3002\u7528\u9014\uFF1A\u4EE5\u6587\u672C\u65B9\u5F0F\u7406\u89E3\u9875\u9762\u5185\u5BB9\u3002\u573A\u666F\uFF1A\u6293\u53D6\u6587\u7AE0\u6B63\u6587\u3001\u8BFB\u53D6\u5217\u8868\u3001\u5728\u4E0D\u622A\u56FE\u65F6\u83B7\u53D6\u9875\u9762\u4FE1\u606F\u3002",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "\u53EA\u53D6\u8BE5 CSS selector \u8303\u56F4\u5185\u7684\u5185\u5BB9\u3002\u9ED8\u8BA4 body\u3002" },
          include_html: { type: "boolean", description: "\u540C\u65F6\u8FD4\u56DE\uFF08\u622A\u65AD\u540E\u7684\uFF09\u539F\u59CB HTML\u3002" },
          max_chars: { type: "number", description: "\u8FD4\u56DE\u53EF\u89C1\u6587\u672C\u7684\u6700\u5927\u5B57\u7B26\u6570\u3002\u9ED8\u8BA4 8000\uFF0C\u6700\u5927 50000\u3002\u9700\u8981\u957F\u6B63\u6587\u65F6\u518D\u8C03\u5927\uFF0C\u907F\u514D\u4FE1\u606F\u8FC7\u8F7D\u3002" }
        }
      }
    },
    {
      name: "browser_dom_snapshot",
      description: "\u8FD4\u56DE\u7ED3\u6784\u5316\u7684 DOM \u6811\u5FEB\u7167\uFF0C\u4F5C\u4E3A\u622A\u56FE\u88AB\u7981\u7528\u6216\u4E0D\u53EF\u7528\u65F6\u7684\u6587\u672C\u66FF\u4EE3\u65B9\u6848\u3002\u7528\u9014\uFF1A\u4EE5\u5C42\u7EA7\u7ED3\u6784\u7406\u89E3\u9875\u9762\u3002\u573A\u666F\uFF1A\u5206\u6790\u590D\u6742\u5E03\u5C40\u3001\u5B9A\u4F4D\u5143\u7D20\u3001\u4E3A\u540E\u7EED\u64CD\u4F5C\u627E selector\u3002",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "\u53EA\u5FEB\u7167\u8BE5 CSS selector \u5B50\u6811\u3002\u9ED8\u8BA4\u6574\u9875\u3002" },
          max_depth: { type: "number", description: "DOM \u6811\u6700\u5927\u904D\u5386\u6DF1\u5EA6\u3002" },
          max_nodes: { type: "number", description: "\u8FD4\u56DE\u7684\u6700\u5927\u8282\u70B9\u6570\u3002" },
          trace: { type: "boolean", description: "\u5931\u8D25\u65F6\u8FD4\u56DE\u7ED3\u6784\u5316\u7684\u9519\u8BEF\u8BCA\u65AD\u4FE1\u606F\u3002" }
        }
      }
    },
    {
      name: "browser_page_info",
      description: "\u83B7\u53D6\u4F60\u5F53\u524D\u5728\u9875\u9762\u4E0A\u7684\u4F4D\u7F6E\u4FE1\u606F\uFF1A\u6EDA\u52A8\u4F4D\u7F6E\uFF08scrollY\u3001\u767E\u5206\u6BD4\u3001\u662F\u5426\u5230\u9876/\u5230\u5E95\uFF09\u3001\u89C6\u53E3\u5C3A\u5BF8\u3001\u6574\u9875\u9AD8\u5EA6\u3001\u5F53\u524D\u5C0F\u8282\u6807\u9898\u3001\u89C6\u53E3\u5185\u6240\u6709\u6807\u9898\u3001\u5143\u7D20\u8BA1\u6570\u3002\u7528\u9014\uFF1A\u81EA\u6211\u5B9A\u4F4D\u3002\u573A\u666F\uFF1A\u6EDA\u52A8\u6216\u4EA4\u4E92\u524D\u540E\u8C03\u7528\uFF0C\u786E\u8BA4\u843D\u70B9\u548C\u9875\u9762\u7ED3\u6784\u3002",
      input_schema: { type: "object", properties: {} }
    },
    {
      name: "browser_find_popups",
      description: "\u68C0\u6D4B\u9875\u9762\u4E0A\u53EF\u89C1\u7684\u5F39\u7A97\u3001\u6A21\u6001\u6846\u3001\u5BF9\u8BDD\u6846\u3001\u62BD\u5C49\u3001\u906E\u7F69\u4EE5\u53CA\u5B83\u4EEC\u53EF\u80FD\u7684\u5173\u95ED\u6309\u94AE\u3002\u7528\u9014\uFF1A\u53D1\u73B0\u6321\u4F4F\u64CD\u4F5C\u7684\u5F39\u5C42\u3002\u573A\u666F\uFF1A\u81EA\u52A8\u5316\u5361\u4F4F\u65F6\u5148\u6392\u67E5\u5F39\u7A97\uFF0C\u518D\u51B3\u5B9A\u5982\u4F55\u5173\u95ED\u3002",
      input_schema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "\u6700\u591A\u8FD4\u56DE\u7684\u5F39\u7A97\u6570\u3002\u9ED8\u8BA4 10\u3002" }
        }
      }
    },
    // ───── 页面交互 ───────────────────────────────────────────────────────
    {
      name: "browser_click",
      description: "\u70B9\u51FB click \u9875\u9762\u5143\u7D20\uFF0C\u4F1A\u6D3E\u53D1\u5B8C\u6574\u7684\u6307\u9488+\u9F20\u6807\u4E8B\u4EF6\u5E8F\u5217\uFF08pointerdown/mousedown/\u2026/click\uFF09\uFF0C\u517C\u5BB9\u81EA\u5B9A\u4E49\u7EC4\u4EF6\u3002\u5B9A\u4F4D\u4F18\u5148\u7EA7\uFF1Aref\uFF08browser_observe \u7684\u7F16\u53F7\uFF0C\u6700\u7A33\uFF09> selector > \u53EF\u89C1\u6587\u672C > \u5750\u6807\u3002\u975E\u5750\u6807\u70B9\u51FB\u4F1A\u5148\u505A\u906E\u6321\u68C0\u6D4B\uFF1A\u82E5\u76EE\u6807\u88AB\u5F39\u7A97/\u906E\u7F69/\u5E7F\u544A\u76D6\u4F4F\uFF0C\u8FD4\u56DE occluded \u8BCA\u65AD\u800C\u4E0D\u662F\u8BEF\u70B9\u80CC\u666F\u5143\u7D20\uFF08\u9700\u7A7F\u900F\u70B9\u51FB\u53EF\u4F20 force:true\uFF09\u3002\u7528\u9014\uFF1A\u89E6\u53D1\u6309\u94AE\u3001\u94FE\u63A5\u3001\u52FE\u9009\u6846\u7B49\u4EA4\u4E92\u3002\u573A\u666F\uFF1A\u5148 browser_observe \u518D\u7528 ref \u70B9\u300C\u767B\u5F55\u300D\u300C\u4E0B\u4E00\u6B65\u300D\u3001\u5C55\u5F00\u83DC\u5355\u3001\u6253\u5F00\u6761\u76EE\u3002",
      input_schema: {
        type: "object",
        properties: {
          ref: { type: "number", description: "browser_observe \u8FD4\u56DE\u7684\u5143\u7D20\u7F16\u53F7 id\u3002\u6700\u7A33\u7684\u5B9A\u4F4D\u65B9\u5F0F\uFF0C\u4F18\u5148\u4F7F\u7528\u3002" },
          selector: { type: "string", description: "\u76EE\u6807\u5143\u7D20\u7684 CSS selector\u3002" },
          text: { type: "string", description: "\u8981\u70B9\u51FB\u5143\u7D20\u7684\u53EF\u89C1\u6587\u672C\u3002" },
          x: { type: "number", description: "X \u5750\u6807\uFF08\u50CF\u7D20\uFF0C\u89C6\u53E3\u5750\u6807\uFF09\u3002\u4F1A\u70B9\u51FB\u8BE5\u70B9\u6700\u9876\u5C42\u7684\u5143\u7D20\u3002" },
          y: { type: "number", description: "Y \u5750\u6807\uFF08\u50CF\u7D20\uFF0C\u89C6\u53E3\u5750\u6807\uFF09\u3002" },
          force: { type: "boolean", description: "\u4E3A true \u65F6\u5373\u4F7F\u76EE\u6807\u88AB\u906E\u6321\u4E5F\u5F3A\u5236\u70B9\u51FB\u3002\u9ED8\u8BA4 false\uFF1A\u88AB\u906E\u6321\u65F6\u8FD4\u56DE occluded \u8BCA\u65AD\uFF0C\u63D0\u793A\u5148\u5173\u95ED\u906E\u6321\u5C42\u3002" }
        }
      }
    },
    {
      name: "browser_double_click",
      description: "\u53CC\u51FB double-click \u5143\u7D20\uFF0C\u53EF\u7528 CSS selector\u3001\u53EF\u89C1\u6587\u672C\u6216\u5750\u6807\u5B9A\u4F4D\uFF08\u5982\u9009\u4E2D\u4E00\u4E2A\u8BCD\u6216\u6253\u5F00\u67D0\u9879\uFF09\u3002\u7528\u9014\uFF1A\u9700\u8981\u53CC\u51FB\u624D\u751F\u6548\u7684\u4EA4\u4E92\u3002\u573A\u666F\uFF1A\u53CC\u51FB\u9009\u8BCD\u3001\u53CC\u51FB\u6253\u5F00\u6587\u4EF6\u9879\u3002",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "\u76EE\u6807\u5143\u7D20\u7684 CSS selector\u3002" },
          text: { type: "string", description: "\u5143\u7D20\u7684\u53EF\u89C1\u6587\u672C\u3002" },
          x: { type: "number", description: "X \u5750\u6807\uFF08\u50CF\u7D20\uFF09\u3002" },
          y: { type: "number", description: "Y \u5750\u6807\uFF08\u50CF\u7D20\uFF09\u3002" }
        }
      }
    },
    {
      name: "browser_right_click",
      description: "\u5728\u5143\u7D20\u4E0A\u53F3\u952E right-click\uFF08\u6253\u5F00\u4E0A\u4E0B\u6587\u83DC\u5355\uFF09\uFF0C\u53EF\u7528 CSS selector\u3001\u53EF\u89C1\u6587\u672C\u6216\u5750\u6807\u5B9A\u4F4D\u3002\u7528\u9014\uFF1A\u89E6\u53D1\u53F3\u952E\u83DC\u5355\u3002\u573A\u666F\uFF1A\u6253\u5F00\u300C\u5728\u65B0\u6807\u7B7E\u6253\u5F00\u300D\u300C\u68C0\u67E5\u300D\u7B49\u4E0A\u4E0B\u6587\u64CD\u4F5C\u3002",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "\u76EE\u6807\u5143\u7D20\u7684 CSS selector\u3002" },
          text: { type: "string", description: "\u5143\u7D20\u7684\u53EF\u89C1\u6587\u672C\u3002" },
          x: { type: "number", description: "X \u5750\u6807\uFF08\u50CF\u7D20\uFF09\u3002" },
          y: { type: "number", description: "Y \u5750\u6807\uFF08\u50CF\u7D20\uFF09\u3002" }
        }
      }
    },
    {
      name: "browser_type",
      description: "\u5411\u8F93\u5165\u6846 input \u6216\u6587\u672C\u57DF textarea \u8F93\u5165\u6587\u672C\u3002\u7528\u9014\uFF1A\u586B\u5199\u5355\u4E2A\u5B57\u6BB5\u3002\u573A\u666F\uFF1A\u8F93\u5165\u7528\u6237\u540D\u3001\u641C\u7D22\u8BCD\u3001\u8868\u5355\u5355\u9879\uFF08\u591A\u9879\u8BF7\u7528 browser_fill_form\uFF09\u3002",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "\u76EE\u6807\u8F93\u5165\u6846\u7684 CSS selector\u3002" },
          text: { type: "string", description: "\u8981\u8F93\u5165\u7684\u6587\u672C\u3002" },
          clear_first: { type: "boolean", description: "\u8F93\u5165\u524D\u5148\u6E05\u7A7A\u5B57\u6BB5\u3002\u9ED8\u8BA4 true\u3002" },
          submit: { type: "boolean", description: "\u8F93\u5165\u540E\u6309\u56DE\u8F66\u63D0\u4EA4\u3002" }
        },
        required: ["text"]
      }
    },
    {
      name: "browser_press_key",
      description: "\u5728\u7126\u70B9\u5143\u7D20\u6216\u6307\u5B9A selector \u4E0A\u6309\u4E0B\u67D0\u4E2A\u952E\uFF08\u53EF\u5E26\u4FEE\u9970\u952E\uFF09\u3002\u7528\u9014\uFF1A\u952E\u76D8\u4EA4\u4E92\u3002\u573A\u666F\uFF1A\u6309 Enter \u63D0\u4EA4\u3001Escape \u5173\u95ED\u3001Tab \u5207\u6362\u3001\u65B9\u5411\u952E\u3001Ctrl+A \u7B49\u5FEB\u6377\u952E\u3002",
      input_schema: {
        type: "object",
        properties: {
          key: { type: "string", description: '\u952E\u540D\uFF0C\u5982 "Enter"\u3001"Escape"\u3001"Tab"\u3001"ArrowDown"\u3001"a"\u3002' },
          selector: { type: "string", description: "\u53EF\u9009\uFF1A\u6309\u952E\u524D\u5148\u805A\u7126\u7684 CSS selector\u3002" },
          ctrl: { type: "boolean", description: "\u6309\u4F4F Ctrl\u3002" },
          shift: { type: "boolean", description: "\u6309\u4F4F Shift\u3002" },
          alt: { type: "boolean", description: "\u6309\u4F4F Alt\u3002" },
          meta: { type: "boolean", description: "\u6309\u4F4F Meta/Cmd\u3002" }
        },
        required: ["key"]
      }
    },
    {
      name: "browser_hover",
      description: "\u628A\u9F20\u6807\u60AC\u505C hover \u5230\u67D0\u4E2A\u5143\u7D20\u4E0A\uFF0C\u4EE5\u663E\u793A tooltip \u6216\u4E0B\u62C9\u83DC\u5355\u3002\u7528\u9014\uFF1A\u89E6\u53D1\u60AC\u505C\u624D\u51FA\u73B0\u7684\u5185\u5BB9\u3002\u573A\u666F\uFF1A\u5C55\u5F00\u60AC\u505C\u83DC\u5355\u3001\u663E\u793A\u63D0\u793A\u6C14\u6CE1\u540E\u518D\u64CD\u4F5C\u3002",
      input_schema: {
        type: "object",
        properties: { selector: { type: "string", description: "\u8981\u60AC\u505C\u5143\u7D20\u7684 CSS selector\u3002" } },
        required: ["selector"]
      }
    },
    {
      name: "browser_scroll",
      description: "\u6EDA\u52A8\u5F53\u524D\u9875\u9762\uFF0C\u8FD4\u56DE\u6EDA\u52A8\u540E\u7684\u4F4D\u7F6E\uFF08scrollY\u3001\u767E\u5206\u6BD4\u3001\u662F\u5426\u5230\u9876/\u5230\u5E95\uFF09\u3001\u5B9E\u9645\u79FB\u52A8\u7684\u50CF\u7D20\u6570\uFF0C\u4EE5\u53CA\u5F53\u524D\u8FDB\u5165\u89C6\u91CE\u7684\u5C0F\u8282/\u6807\u9898\u2014\u2014\u8BA9\u4F60\u77E5\u9053\u6EDA\u5230\u4E86\u54EA\u3001\u53D8\u5316\u4E86\u4EC0\u4E48\u3002\u7528\u9014\uFF1A\u6D4F\u89C8\u957F\u9875\u9762\u3002\u573A\u666F\uFF1A\u9010\u5C4F\u9605\u8BFB\u3001\u52A0\u8F7D\u61D2\u52A0\u8F7D\u5185\u5BB9\u3001\u6EDA\u5230\u9875\u5C3E\u3002",
      input_schema: {
        type: "object",
        properties: {
          direction: { type: "string", enum: ["up", "down", "top", "bottom"], description: "\u6EDA\u52A8\u65B9\u5411\uFF1Aup \u4E0A\u3001down \u4E0B\u3001top \u5230\u9876\u3001bottom \u5230\u5E95\u3002" },
          amount: { type: "number", description: "\u6EDA\u52A8\u50CF\u7D20\u6570\u3002\u9ED8\u8BA4 400\u3002" },
          selector: { type: "string", description: "\u53EF\u9009\uFF1A\u628A\u8BE5\u5143\u7D20\u6EDA\u52A8\u8FDB\u89C6\u53E3\uFF0C\u66FF\u4EE3\u6309 amount \u6EDA\u52A8\u3002" }
        },
        required: ["direction"]
      }
    },
    {
      name: "browser_wait",
      description: "\u7B49\u5F85\u67D0\u4E2A CSS selector \u51FA\u73B0\uFF0C\u6216\u56FA\u5B9A\u7B49\u5F85\u4E00\u6BB5\u65F6\u95F4\u3002\u7528\u9014\uFF1A\u7B49\u5F85\u9875\u9762/\u5143\u7D20\u5C31\u7EEA\u540E\u518D\u64CD\u4F5C\u3002\u573A\u666F\uFF1A\u7B49\u5F02\u6B65\u52A0\u8F7D\u7684\u6309\u94AE\u51FA\u73B0\u3001\u7B49\u52A8\u753B\u7ED3\u675F\u3001\u7ED9\u9875\u9762\u7559\u51FA\u6E32\u67D3\u65F6\u95F4\u3002",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "\u7B49\u5F85\u51FA\u73B0\u7684 CSS \u5143\u7D20\u3002" },
          ms: { type: "number", description: "\u56FA\u5B9A\u7B49\u5F85\u7684\u6BEB\u79D2\u6570\u3002" }
        }
      }
    },
    {
      name: "browser_drag",
      description: "\u4ECE\u6E90\u5143\u7D20/\u70B9\u62D6\u62FD drag \u5230\u76EE\u6807\u5143\u7D20/\u70B9\u5E76\u653E\u4E0B\uFF0C\u89E6\u53D1 HTML5\u3001pointer \u548C mouse \u4E8B\u4EF6\uFF0C\u5E76\u8FD4\u56DE\u6E90\u662F\u5426\u660E\u663E\u79FB\u52A8\u7684\u8BCA\u65AD\u4FE1\u606F\u3002\u7528\u9014\uFF1A\u62D6\u653E\u4EA4\u4E92\u3002\u573A\u666F\uFF1A\u62D6\u52A8\u6392\u5E8F\u3001\u628A\u5143\u7D20\u62D6\u5165\u6295\u653E\u533A\u3001\u6ED1\u5757\u64CD\u4F5C\u3002",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "\u6E90\u5143\u7D20 CSS selector\u3002" },
          text: { type: "string", description: "\u6E90\u5143\u7D20\u53EF\u89C1\u6587\u672C\u3002" },
          x: { type: "number", description: "\u6E90\u70B9 X \u5750\u6807\uFF08\u50CF\u7D20\uFF09\u3002" },
          y: { type: "number", description: "\u6E90\u70B9 Y \u5750\u6807\uFF08\u50CF\u7D20\uFF09\u3002" },
          to_selector: { type: "string", description: "\u76EE\u6807\u5143\u7D20 CSS selector\u3002" },
          to_text: { type: "string", description: "\u76EE\u6807\u5143\u7D20\u53EF\u89C1\u6587\u672C\u3002" },
          to_x: { type: "number", description: "\u76EE\u6807\u70B9 X \u5750\u6807\uFF08\u50CF\u7D20\uFF09\u3002" },
          to_y: { type: "number", description: "\u76EE\u6807\u70B9 Y \u5750\u6807\uFF08\u50CF\u7D20\uFF09\u3002" }
        }
      }
    },
    {
      name: "browser_fill_form",
      description: "\u4E00\u6B21\u6027\u586B\u5199\u591A\u4E2A\u8868\u5355\u5B57\u6BB5\uFF0C\u53EF\u6309 selector\u3001name\u3001label\u3001placeholder \u6216\u5BF9\u8C61\u6620\u5C04\u5B9A\u4F4D\u63A7\u4EF6\u3002\u7528\u9014\uFF1A\u6279\u91CF\u586B\u8868\u3002\u573A\u666F\uFF1A\u767B\u5F55/\u6CE8\u518C/\u7ED3\u7B97\u7B49\u9700\u8981\u586B\u591A\u4E2A\u5B57\u6BB5\u5E76\u63D0\u4EA4\u7684\u8868\u5355\u3002",
      input_schema: {
        type: "object",
        properties: {
          fields: {
            type: "array",
            description: '\u5B57\u6BB5\u5217\u8868\u3002\u793A\u4F8B\uFF1A[{selector:"input[name=email]", value:"me@example.com"}, {label:"Password", value:"secret"}, {selector:"#remember", action:"check"}]\uFF1B\u8FD0\u884C\u65F6\u4E5F\u63A5\u53D7\u5BF9\u8C61\u6620\u5C04\u5199\u6CD5\u3002',
            items: {
              type: "object",
              properties: {
                selector: { type: "string", description: "\u8F93\u5165\u6846/\u4E0B\u62C9/\u6587\u672C\u57DF\u7684 CSS selector\u3002" },
                name: { type: "string", description: "\u8868\u5355\u63A7\u4EF6\u7684 name \u6216 id\uFF08\u515C\u5E95\u5B9A\u4F4D\uFF09\u3002" },
                label: { type: "string", description: "\u5B57\u6BB5\u9644\u8FD1\u7684\u53EF\u89C1 label \u6587\u672C\u3002" },
                placeholder: { type: "string", description: "\u7528\u4E8E\u5339\u914D\u7684 placeholder \u6587\u672C\u3002" },
                value: { type: ["string", "number", "boolean"], description: "\u8981\u8BBE\u7F6E\u7684\u503C\u3002" },
                action: { type: "string", enum: ["set", "type", "select", "check", "uncheck", "click"], description: "\u5982\u4F55\u5E94\u7528\u503C\uFF1Aset \u8BBE\u503C\u3001type \u6A21\u62DF\u8F93\u5165\u3001select \u9009\u62E9\u3001check/uncheck \u52FE\u9009\u3001click \u70B9\u51FB\u3002\u9ED8\u8BA4 set\u3002" }
              }
            }
          },
          submit_selector: { type: "string", description: "\u586B\u5B8C\u540E\u8981\u70B9\u51FB\u7684\u63D0\u4EA4\u6309\u94AE CSS selector\u3002" }
        },
        required: ["fields"]
      }
    },
    {
      name: "browser_select",
      description: "\u5728\u539F\u751F <select> \u4E0B\u62C9\u6216\u5E38\u89C1\u81EA\u5B9A\u4E49\u4E0B\u62C9/\u5217\u8868\u6846\u4E2D\u9009\u62E9\u67D0\u9879\uFF1A\u901A\u8FC7\u70B9\u51FB\u63A7\u4EF6\u5E76\u6309\u9009\u9879\u6587\u672C/\u503C\u5339\u914D\u3002\u7528\u9014\uFF1A\u5904\u7406\u4E0B\u62C9\u9009\u62E9\u3002\u573A\u666F\uFF1A\u9009\u62E9\u56FD\u5BB6\u3001\u57CE\u5E02\u3001\u6570\u91CF\u7B49\u4E0B\u62C9\u9879\u3002",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "\u4E0B\u62C9/\u81EA\u5B9A\u4E49\u4E0B\u62C9\u63A7\u4EF6\u7684 CSS selector\u3002" },
          value: { type: "string", description: "\u8981\u9009\u62E9\u7684\u9009\u9879\u503C\u6216\u53EF\u89C1\u6587\u672C\u3002" },
          text: { type: "string", description: "value \u7684\u522B\u540D\u3002" },
          option_text: { type: "string", description: "value \u7684\u522B\u540D\u3002" }
        },
        required: ["selector"]
      }
    },
    {
      name: "browser_close_popup",
      description: "\u5173\u95ED\u53EF\u89C1\u7684\u5F39\u7A97/\u6A21\u6001\u6846/\u5BF9\u8BDD\u6846\uFF1A\u4F18\u5148\u70B9\u68C0\u6D4B\u5230\u7684\u5173\u95ED\u6309\u94AE\uFF0C\u518D\u56DE\u9000\u5230 Escape/\u70B9\u906E\u7F69\u3002\u9700\u8981\u5148\u67E5\u770B\u5019\u9009\u65F6\u8BF7\u5148\u8C03\u7528 browser_find_popups\u3002\u7528\u9014\uFF1A\u6E05\u9664\u906E\u6321\u3002\u573A\u666F\uFF1A\u5173\u95ED cookie \u540C\u610F\u6761\u3001\u8BA2\u9605\u5F39\u7A97\u3001\u767B\u5F55\u5F15\u5BFC\u5C42\u3002",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "\u53EF\u9009\uFF1A\u8981\u5173\u95ED\u5F39\u7A97\u7684 CSS selector\u3002" },
          text: { type: "string", description: "\u53EF\u9009\uFF1A\u5F39\u7A97\u5185\u5305\u542B\u7684\u6587\u672C\uFF0C\u7528\u4E8E\u5B9A\u4F4D\u5B83\u3002" },
          index: { type: "number", description: "browser_find_popups \u8FD4\u56DE\u7684\u5F39\u7A97\u5E8F\u53F7\u3002\u9ED8\u8BA4 0\u3002" },
          strategy: { type: "string", enum: ["auto", "close_button", "escape", "backdrop"], description: "\u5173\u95ED\u7B56\u7565\uFF1Aauto \u81EA\u52A8\u3001close_button \u5173\u95ED\u6309\u94AE\u3001escape \u6309 Esc\u3001backdrop \u70B9\u906E\u7F69\u3002\u9ED8\u8BA4 auto\u3002" },
          force_remove: { type: "boolean", description: "\u4E3A true \u65F6\u4F5C\u4E3A\u6700\u540E\u624B\u6BB5\u76F4\u63A5\u79FB\u9664\u5F39\u7A97 DOM \u8282\u70B9\u3002" }
        }
      }
    },
    // ───── 数据与脚本 ─────────────────────────────────────────────────────
    {
      name: "browser_evaluate",
      description: "\u5728\u9875\u9762\u4E0A\u4E0B\u6587\u4E2D\u6267\u884C\u4EFB\u610F JavaScript \u5E76\u8FD4\u56DE\u7ED3\u679C\uFF1B\u53EF\u7528\u65F6\u8D70 Chrome DevTools Protocol\uFF0C\u56E0\u6B64\u5728 CSP \u53D7\u9650\u9875\u9762\u4E0A\u4E5F\u80FD\u8FD0\u884C\u3002\u7528\u9014\uFF1A\u9AD8\u7EA7\u53D6\u6570/\u64CD\u4F5C\u7684\u515C\u5E95\u624B\u6BB5\u3002\u573A\u666F\uFF1A\u5185\u7F6E\u5DE5\u5177\u65E0\u6CD5\u6EE1\u8DB3\u65F6\u8BFB\u53D6\u590D\u6742\u6570\u636E\u6216\u89E6\u53D1\u7279\u6B8A\u884C\u4E3A\uFF08\u8BF7\u8C28\u614E\u4F7F\u7528\uFF09\u3002",
      input_schema: {
        type: "object",
        properties: {
          code: { type: "string", description: "\u8981\u6267\u884C\u7684 JavaScript \u8868\u8FBE\u5F0F\u6216\u8BED\u53E5\u3002" },
          function: { type: "string", description: "code \u7684\u522B\u540D\uFF0C\u4FDD\u7559\u517C\u5BB9\u3002" },
          fn: { type: "string", description: "code \u7684\u522B\u540D\u3002" },
          expression: { type: "string", description: "code \u7684\u522B\u540D\u3002" },
          trace: { type: "boolean", description: "\u5931\u8D25\u65F6\u8FD4\u56DE\u7ED3\u6784\u5316\u7684 {error, code, suggestion, trace}\u3002" }
        }
      }
    },
    {
      name: "browser_extract",
      description: "\u4ECE\u5339\u914D selector \u7684\u5143\u7D20\u4E2D\u63D0\u53D6\u7ED3\u6784\u5316\u6570\u636E\uFF0C\u8FD4\u56DE\u5E26 tag\u3001selector\u3001\u6587\u672C\u3001\u5C5E\u6027\u53CA\u5E38\u7528\u5C5E\u6027\u522B\u540D\u7684\u5F52\u4E00\u5316\u6761\u76EE\u3002\u7528\u9014\uFF1A\u6279\u91CF\u6293\u53D6\u5217\u8868/\u8868\u683C\u3002\u573A\u666F\uFF1A\u6293\u53D6\u641C\u7D22\u7ED3\u679C\u3001\u5546\u54C1\u5217\u8868\u3001\u8868\u683C\u884C\u3002",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "\u8981\u67E5\u8BE2\u7684 CSS selector\u3002" },
          attributes: { type: "array", items: { type: "string" }, description: "\u6BCF\u4E2A\u5143\u7D20\u9700\u8981\u91C7\u96C6\u7684\u5C5E\u6027\u540D\u5217\u8868\u3002" },
          limit: { type: "number", description: "\u6700\u591A\u63D0\u53D6\u7684\u5143\u7D20\u6570\u3002\u9ED8\u8BA4 50\u3002" }
        },
        required: ["selector"]
      }
    },
    {
      name: "browser_clipboard_write",
      description: "\u628A\u6587\u672C\u5199\u5165\u7CFB\u7EDF\u526A\u8D34\u677F\u3002\u7528\u9014\uFF1A\u590D\u5236\u5185\u5BB9\u4F9B\u5176\u4ED6\u7A0B\u5E8F\u7C98\u8D34\u3002\u573A\u666F\uFF1A\u590D\u5236\u63D0\u53D6\u5230\u7684\u7ED3\u679C\u3001\u590D\u5236\u751F\u6210\u7684\u94FE\u63A5\u3002",
      input_schema: {
        type: "object",
        properties: { text: { type: "string", description: "\u8981\u590D\u5236\u5230\u526A\u8D34\u677F\u7684\u6587\u672C\u3002" } },
        required: ["text"]
      }
    },
    {
      name: "browser_file_upload",
      description: "\u7528\u5185\u5B58\u4E2D\u7684\u6587\u4EF6\u5185\u5BB9\u586B\u5145 <input type=file>\u3002\u6CE8\u610F\uFF1A\u6269\u5C55\u65E0\u6CD5\u8BFB\u53D6\u672C\u673A\u6587\u4EF6\u7CFB\u7EDF\u8DEF\u5F84\uFF0C\u5FC5\u987B\u76F4\u63A5\u63D0\u4F9B\u5185\u5BB9\u3002\u7528\u9014\uFF1A\u4E0A\u4F20\u6587\u4EF6\u3002\u573A\u666F\uFF1A\u628A\u4E00\u6BB5\u6587\u672C/base64 \u5185\u5BB9\u4F5C\u4E3A\u6587\u4EF6\u4E0A\u4F20\u5230\u7F51\u9875\u3002",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "\u6587\u4EF6\u8F93\u5165\u6846\u7684 CSS selector\u3002\u9ED8\u8BA4 input[type=file]\u3002" },
          files: {
            type: "array",
            description: '\u8981\u5408\u6210\u7684\u6587\u4EF6\uFF0C\u4F8B\u5982 [{name:"a.txt", content:"hello", type:"text/plain"}]\uFF0C\u6216\u8BBE\u7F6E encoding:"base64"\u3002',
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "\u6587\u4EF6\u540D\u3002" },
                content: { type: "string", description: "\u6587\u4EF6\u5185\u5BB9\uFF08\u6309 encoding \u89E3\u91CA\uFF09\u3002" },
                type: { type: "string", description: "MIME \u7C7B\u578B\uFF0C\u5982 text/plain\u3002" },
                encoding: { type: "string", enum: ["text", "base64"], description: "content \u7684\u7F16\u7801\uFF1Atext \u7EAF\u6587\u672C\u6216 base64\u3002" }
              },
              required: ["name", "content"]
            }
          }
        },
        required: ["files"]
      }
    },
    {
      name: "browser_download",
      description: "\u901A\u8FC7 chrome.downloads \u4ECE\u67D0\u4E2A URL \u53D1\u8D77\u6D4F\u89C8\u5668\u4E0B\u8F7D\u3002\u7528\u9014\uFF1A\u4FDD\u5B58\u6587\u4EF6\u5230\u672C\u5730\u4E0B\u8F7D\u76EE\u5F55\u3002\u573A\u666F\uFF1A\u4E0B\u8F7D\u5BFC\u51FA\u6587\u4EF6\u3001\u56FE\u7247\u3001\u9644\u4EF6\u3002",
      input_schema: {
        type: "object",
        properties: {
          url: { type: "string", description: "\u8981\u4E0B\u8F7D\u7684 URL\u3002" },
          filename: { type: "string", description: "\u53EF\u9009\uFF1A\u4E0B\u8F7D\u76EE\u5F55\u4E0B\u7684\u76F8\u5BF9\u6587\u4EF6\u540D\u3002" },
          save_as: { type: "boolean", description: "\u663E\u793A\u300C\u53E6\u5B58\u4E3A\u300D\u5BF9\u8BDD\u6846\u3002" }
        },
        required: ["url"]
      }
    },
    // ───── 浏览器状态（资源 + action）────────────────────────────────────
    {
      name: "browser_tab",
      description: "\u7BA1\u7406\u6D4F\u89C8\u5668\u6807\u7B7E\u9875\uFF1A\u5217\u51FA\u3001\u65B0\u5F00\u6216\u5173\u95ED\u3002\u7528\u9014\uFF1A\u5728\u591A\u6807\u7B7E\u95F4\u7EC4\u7EC7\u5DE5\u4F5C\u3002\u573A\u666F\uFF1A\u67E5\u770B\u6709\u54EA\u4E9B\u6807\u7B7E\uFF08list\uFF09\u3001\u5E76\u884C\u6253\u5F00\u7F51\u5740\uFF08open\uFF09\u3001\u5B8C\u6210\u540E\u5173\u95ED\u6807\u7B7E\uFF08close\uFF09\u3002",
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "open", "close"], description: "\u52A8\u4F5C\uFF1Alist \u5217\u51FA\u6240\u6709\u6807\u7B7E\u3001open \u7528 url \u65B0\u5F00\u6807\u7B7E\u3001close \u5173\u95ED tab_id\uFF08\u4E0D\u4F20\u5219\u5F53\u524D\u6807\u7B7E\uFF09\u3002" },
          url: { type: "string", description: "action=open \u65F6\u8981\u6253\u5F00\u7684 URL\u3002" },
          tab_id: { type: "number", description: "action=close \u65F6\u8981\u5173\u95ED\u7684\u6807\u7B7E ID\uFF1B\u4E0D\u4F20\u5219\u5173\u95ED\u5F53\u524D\u6D3B\u52A8\u6807\u7B7E\u3002" }
        },
        required: ["action"]
      }
    },
    {
      name: "browser_cookie",
      description: "\u7BA1\u7406\u5F53\u524D\u6807\u7B7E\u9875 URL \u6216\u6307\u5B9A URL/\u57DF\u540D\u7684 cookie\uFF1A\u5217\u51FA\u3001\u8BFB\u53D6\u3001\u5199\u5165\u3001\u5220\u9664\u3002\u7528\u9014\uFF1A\u67E5\u770B\u6216\u64CD\u4F5C\u4F1A\u8BDD\u72B6\u6001\u3002\u573A\u666F\uFF1A\u68C0\u67E5\u767B\u5F55\u6001\uFF08list/get\uFF09\u3001\u6CE8\u5165\u767B\u5F55/\u504F\u597D cookie\uFF08set\uFF0C\u5199\u5165\uFF09\u3001\u9000\u51FA\u767B\u5F55\uFF08delete\uFF0C\u5199\u5165\uFF09\u3002",
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "get", "set", "delete"], description: "\u52A8\u4F5C\uFF1Alist \u5217\u51FA\u3001get \u6309 name \u53D6\u5355\u4E2A\u3001set \u5199\u5165\u3001delete \u5220\u9664\u3002" },
          url: { type: "string", description: "cookie \u6240\u5C5E URL\u3002\u9ED8\u8BA4\u5F53\u524D\u6807\u7B7E\u9875 URL\u3002" },
          domain: { type: "string", description: "action=list \u65F6\u53EF\u6309\u57DF\u540D\u8FC7\u6EE4\u3002" },
          name: { type: "string", description: "cookie \u540D\u79F0\uFF08get/set/delete \u5FC5\u586B\uFF09\u3002" },
          value: { type: "string", description: "action=set \u65F6\u7684 cookie \u503C\u3002" },
          path: { type: "string", description: "action=set \u65F6\u7684 cookie \u8DEF\u5F84\u3002" },
          secure: { type: "boolean", description: "action=set \u65F6\u662F\u5426\u4EC5 HTTPS \u4F20\u8F93\u3002" },
          http_only: { type: "boolean", description: "action=set \u65F6\u662F\u5426\u6807\u8BB0 HttpOnly\u3002" },
          expiration_date: { type: "number", description: "action=set \u65F6\u7684\u8FC7\u671F\u65F6\u95F4\uFF08Unix \u79D2\uFF09\u3002" }
        },
        required: ["action"]
      }
    },
    {
      name: "browser_storage",
      description: "\u8BFB\u5199\u5F53\u524D\u9875\u9762\u7684 localStorage / sessionStorage\uFF1A\u8BFB\u53D6\u3001\u5199\u5165\u3001\u5220\u9664\u3001\u5217\u51FA key\u3002\u7528\u9014\uFF1A\u67E5\u770B\u6216\u64CD\u4F5C\u524D\u7AEF\u5B58\u50A8\u72B6\u6001\u3002\u573A\u666F\uFF1A\u8BFB\u53D6 token/\u504F\u597D\uFF08get/list\uFF09\u3001\u6CE8\u5165\u6807\u8BB0\u4F4D\uFF08set\uFF0C\u5199\u5165\uFF09\u3001\u6E05\u9664\u7F13\u5B58\u9879\uFF08remove\uFF0C\u5199\u5165\uFF09\u3002",
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["get", "set", "remove", "list"], description: "\u52A8\u4F5C\uFF1Aget \u8BFB\u53D6 key\u3001set \u5199\u5165 key\u3001remove \u5220\u9664 key\u3001list \u5217\u51FA key\u3002" },
          type: { type: "string", enum: ["local", "session"], description: "\u5B58\u50A8\u7C7B\u578B\uFF1Alocal \u6216 session\u3002\u9ED8\u8BA4 local\u3002" },
          key: { type: "string", description: "\u5B58\u50A8\u952E\u540D\uFF08get/set/remove \u5FC5\u586B\uFF09\u3002" },
          value: { type: "string", description: "action=set \u65F6\u8981\u5B58\u50A8\u7684\u503C\u3002" },
          prefix: { type: "string", description: "action=list \u65F6\u6309\u952E\u540D\u524D\u7F00\u8FC7\u6EE4\u3002" },
          include_values: { type: "boolean", description: "action=list \u65F6\u5728\u7ED3\u679C\u4E2D\u5305\u542B value\u3002" },
          limit: { type: "number", description: "action=list \u65F6\u6700\u591A\u8FD4\u56DE\u7684 key/\u6761\u76EE\u6570\u3002\u9ED8\u8BA4 100\u3002" }
        },
        required: ["action"]
      }
    },
    {
      name: "browser_session",
      description: "\u7BA1\u7406\u8F7B\u91CF\u6D4F\u89C8\u5668\u4E0A\u4E0B\u6587\u5FEB\u7167\uFF08\u5F53\u524D URL/\u6807\u9898 + \u8BE5\u9875 localStorage/sessionStorage\uFF09\uFF1A\u4FDD\u5B58\u3001\u5217\u51FA\u3001\u6062\u590D\u3001\u5220\u9664\u3002\u7528\u9014\uFF1A\u7559\u5B58\u5E76\u56DE\u5230\u6B64\u524D\u7684\u4F1A\u8BDD\u73B0\u573A\u3002\u573A\u666F\uFF1A\u4FDD\u5B58\u767B\u5F55\u6001\u7A0D\u540E\u6062\u590D\uFF08save/restore\uFF09\u3001\u67E5\u770B\u53EF\u6062\u590D\u4F1A\u8BDD\uFF08list\uFF09\u3001\u6E05\u7406\u8FC7\u671F\u5FEB\u7167\uFF08delete\uFF09\u3002",
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["save", "list", "restore", "delete"], description: "\u52A8\u4F5C\uFF1Asave \u4FDD\u5B58\u5F53\u524D\u73B0\u573A\u3001list \u5217\u51FA\u5FEB\u7167\u3001restore \u6062\u590D\u5FEB\u7167\u3001delete \u5220\u9664\u5FEB\u7167\u3002" },
          id: { type: "string", description: "\u4F1A\u8BDD id\uFF08restore/delete \u7528\uFF0Csave \u53EF\u9009\uFF09\u3002" },
          name: { type: "string", description: "\u4FBF\u4E8E\u8BC6\u522B\u7684\u4F1A\u8BDD\u540D\u79F0\uFF08restore/delete \u4E5F\u53EF\u6309 name \u5B9A\u4F4D\uFF09\u3002" },
          new_tab: { type: "boolean", description: "action=restore \u65F6\u5728\u65B0\u6807\u7B7E\u9875\u4E2D\u6062\u590D\u3002" }
        },
        required: ["action"]
      }
    }
  ];
  var BROWSER_CAPABILITIES = BROWSER_TOOLS.map((t) => t.name);
  var BROWSER_TOOL_KIND_LABELS = {
    basic: "\u57FA\u7840\u7C7B",
    special: "\u7279\u6B8A\u7C7B"
  };
  var BROWSER_TOOL_CATEGORIES = [
    {
      title: "\u5BFC\u822A\u4E0E\u641C\u7D22",
      kind: "basic",
      tools: ["browser_navigate", "browser_search", "browser_history"]
    },
    {
      title: "\u9875\u9762\u89C2\u5BDF",
      kind: "basic",
      tools: [
        "browser_observe",
        "browser_screenshot",
        "browser_get_content",
        "browser_dom_snapshot",
        "browser_page_info",
        "browser_find_popups"
      ]
    },
    {
      title: "\u9875\u9762\u4EA4\u4E92",
      kind: "basic",
      tools: [
        "browser_click",
        "browser_double_click",
        "browser_right_click",
        "browser_type",
        "browser_press_key",
        "browser_hover",
        "browser_scroll",
        "browser_wait",
        "browser_drag",
        "browser_fill_form",
        "browser_select",
        "browser_close_popup"
      ]
    },
    {
      title: "\u6570\u636E\u4E0E\u811A\u672C",
      kind: "special",
      tools: [
        "browser_evaluate",
        "browser_extract",
        "browser_clipboard_write",
        "browser_file_upload",
        "browser_download"
      ]
    },
    {
      title: "\u6D4F\u89C8\u5668\u72B6\u6001",
      kind: "special",
      tools: ["browser_tab", "browser_cookie", "browser_storage", "browser_session"]
    }
  ];
  function browserToolCategory(name) {
    const tool = String(name || "").trim();
    for (const cat of BROWSER_TOOL_CATEGORIES) {
      if (cat.tools.includes(tool))
        return cat.title;
    }
    return "";
  }
  function browserToolKind(name) {
    const tool = String(name || "").trim();
    for (const cat of BROWSER_TOOL_CATEGORIES) {
      if (cat.tools.includes(tool))
        return cat.kind;
    }
    return "basic";
  }
  function isToolEnabledByDefault(name) {
    return browserToolKind(name) === "basic";
  }

  // src/lib/tools/overrides.ts
  async function resolveToolEnabledMap() {
    const explicit = await getToolEnabledMap();
    const out = {};
    for (const tool of BROWSER_TOOLS) {
      out[tool.name] = tool.name in explicit ? !!explicit[tool.name] : isToolEnabledByDefault(tool.name);
    }
    return out;
  }

  // src/popup/mcp.ts
  var overrides = {};
  var enabledMap = {};
  async function applyEnabledChange(fn) {
    await fn();
    sendToBackground({ type: "agent:connect" });
    await renderMcpList();
  }
  function esc2(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  function isEdited(name) {
    const o = overrides[name];
    return !!(o && (o.description || o.parameters && Object.keys(o.parameters).length));
  }
  function effDescription(t) {
    return overrides[t.name]?.description?.trim() || t.description || "";
  }
  function effParamDesc(tool, param, raw) {
    return overrides[tool]?.parameters?.[param]?.trim() || raw || "";
  }
  function paramEntries(t) {
    const props = t.input_schema?.properties || {};
    const required = new Set(t.input_schema?.required || []);
    return Object.keys(props).map((p) => {
      const cfg = props[p] || {};
      const ty = Array.isArray(cfg.type) ? cfg.type.join("|") : cfg.type || "any";
      return { name: p, type: String(ty), required: required.has(p), desc: String(cfg.description || "") };
    });
  }
  function renderIntroHtml() {
    return `
    <div class="mcp-intro">
      <div class="mcp-intro-title">
        <span>\u57FA\u7840 MCP \u4ECB\u7ECD</span>
        <span class="pane-sub">\u5148\u770B\u6982\u5FF5\uFF0C\u518D\u770B\u5DE5\u5177</span>
      </div>
      <div class="mcp-intro-list">
        <div class="mcp-intro-item">
          <div class="mcp-intro-key">MCP</div>
          <div class="mcp-intro-text">\u6A21\u578B\u4E0A\u4E0B\u6587\u534F\u8BAE\u3002\u8FD9\u91CC\u5C55\u793A\u7684\u662F\u6D4F\u89C8\u5668\u63D2\u4EF6\u5BF9\u5916\u63D0\u4F9B\u7684\u5DE5\u5177\u80FD\u529B\uFF0CAI \u53EF\u4EE5\u6309\u540D\u79F0\u8C03\u7528\u8FD9\u4E9B\u5DE5\u5177\u5B8C\u6210\u6D4F\u89C8\u5668\u64CD\u4F5C\u3002</div>
        </div>
        <div class="mcp-intro-item">
          <div class="mcp-intro-key">list_tools</div>
          <div class="mcp-intro-text">\u7528\u4E8E\u67E5\u770B\u5F53\u524D\u53EF\u7528\u5DE5\u5177\u5217\u8868\u3002\u5148\u770B\u5217\u8868\uFF0C\u518D\u51B3\u5B9A\u8981\u4E0D\u8981\u5C55\u5F00\u5177\u4F53\u5DE5\u5177\u8BE6\u60C5\u3002</div>
        </div>
        <div class="mcp-intro-item">
          <div class="mcp-intro-key">describe_tool</div>
          <div class="mcp-intro-text">\u7528\u4E8E\u8BFB\u53D6\u67D0\u4E2A\u5DE5\u5177\u7684\u7528\u9014\u3001\u53C2\u6570\u548C\u8BF4\u660E\u3002\u9700\u8981\u77E5\u9053\u600E\u4E48\u4F20\u53C2\u65F6\uFF0C\u5148\u770B\u8FD9\u91CC\u3002</div>
        </div>
        <div class="mcp-intro-item">
          <div class="mcp-intro-key">test</div>
          <div class="mcp-intro-text">\u7528\u4E8E\u5728\u5F53\u524D\u6D4F\u89C8\u5668\u73AF\u5883\u4E2D\u76F4\u63A5\u6D4B\u8BD5\u4E00\u4E2A\u5DE5\u5177\uFF0C\u4FBF\u4E8E\u9A8C\u8BC1\u63CF\u8FF0\u548C\u53C2\u6570\u662F\u5426\u6B63\u786E\u3002</div>
        </div>
        <div class="mcp-intro-item">
          <div class="mcp-intro-key">\u52FE\u9009</div>
          <div class="mcp-intro-text">\u5DE5\u5177\u5206\u300C\u57FA\u7840\u7C7B\u300D\u548C\u300C\u7279\u6B8A\u7C7B\u300D\u3002\u52FE\u9009\u5373\u5F00\u542F\uFF0C\u53D6\u6D88\u52FE\u9009\u540E\u670D\u52A1\u5668\u4E0E AI \u90FD\u62FF\u4E0D\u5230\u8BE5\u5DE5\u5177\u7684\u6570\u636E\uFF0C\u65E0\u6CD5\u8C03\u7528\u3002\u7279\u6B8A\u7C7B\uFF08\u6267\u884C\u811A\u672C\u3001cookie/storage\u3001\u4F1A\u8BDD\u3001\u6587\u4EF6\u4E0A\u4F20\u4E0B\u8F7D\u7B49\uFF09\u9ED8\u8BA4\u5173\u95ED\uFF0C\u6309\u9700\u5F00\u542F\u3002</div>
        </div>
      </div>
    </div>`;
  }
  async function renderMcpList() {
    state.openToolName = null;
    mcpDetailPane.classList.add("hidden");
    mcpListPane.classList.remove("hidden");
    overrides = await getToolDescOverrides();
    enabledMap = await resolveToolEnabledMap();
    const enabledTotal = BROWSER_TOOLS.filter((t) => enabledMap[t.name]).length;
    mcpCount.textContent = `\u5DF2\u542F\u7528 ${enabledTotal} / ${BROWSER_TOOLS.length}`;
    mcpList.innerHTML = renderIntroHtml();
    const byName = new Map(BROWSER_TOOLS.map((t) => [t.name, t]));
    const kinds = ["basic", "special"];
    for (const kind of kinds) {
      const cats = BROWSER_TOOL_CATEGORIES.filter((c) => c.kind === kind);
      if (!cats.length)
        continue;
      const kindTools = cats.flatMap((c) => c.tools).filter((n) => byName.has(n));
      const kindOn = kindTools.filter((n) => enabledMap[n]).length;
      const allOn = kindOn === kindTools.length;
      const kh = document.createElement("div");
      kh.className = "tool-kind-head";
      kh.innerHTML = `
      <div class="tool-kind-title">
        <span>${esc2(BROWSER_TOOL_KIND_LABELS[kind])}</span>
        <span class="tool-kind-tag ${kind}">${kind === "special" ? "\u9ED8\u8BA4\u5173\u95ED" : "\u9ED8\u8BA4\u5F00\u542F"}</span>
        <span class="pane-sub">${kindOn}/${kindTools.length}</span>
      </div>
      <button class="tool-kind-toggle">${allOn ? "\u5168\u90E8\u5173\u95ED" : "\u5168\u90E8\u5F00\u542F"}</button>`;
      kh.querySelector("button").addEventListener("click", () => void applyEnabledChange(() => setManyToolEnabled(kindTools, !allOn)));
      mcpList.appendChild(kh);
      for (const cat of cats) {
        const tools = cat.tools.map((n) => byName.get(n)).filter((t) => !!t);
        if (!tools.length)
          continue;
        const catOn = tools.filter((t) => enabledMap[t.name]).length;
        const head = document.createElement("div");
        head.className = "tool-cat-head";
        head.innerHTML = `<span>${esc2(cat.title)}</span><span class="pane-sub">${catOn}/${tools.length}</span>`;
        mcpList.appendChild(head);
        for (const t of tools) {
          const on = !!enabledMap[t.name];
          const el = document.createElement("div");
          el.className = on ? "tool-item" : "tool-item off";
          el.innerHTML = `
          <div class="tool-item-top">
            <input type="checkbox" class="tool-toggle" ${on ? "checked" : ""} title="${on ? "\u5DF2\u542F\u7528\uFF0C\u53D6\u6D88\u52FE\u9009\u540E\u670D\u52A1\u5668\u62FF\u4E0D\u5230\u6B64\u5DE5\u5177" : "\u5DF2\u5173\u95ED\uFF0C\u52FE\u9009\u540E\u624D\u4E0A\u62A5\u7ED9\u670D\u52A1\u5668"}"/>
            <span class="tool-name">${esc2(t.name)}</span>
            ${isEdited(t.name) ? '<span class="tool-edited">\u5DF2\u81EA\u5B9A\u4E49</span>' : ""}
          </div>
          <div class="tool-desc">${esc2((effDescription(t) || "\uFF08\u65E0\u63CF\u8FF0\uFF09").slice(0, 110))}</div>`;
          const cb = el.querySelector(".tool-toggle");
          cb.addEventListener("click", (e) => e.stopPropagation());
          cb.addEventListener("change", () => void applyEnabledChange(() => setToolEnabled(t.name, cb.checked)));
          el.addEventListener("click", () => void openTool(t.name));
          mcpList.appendChild(el);
        }
      }
    }
  }
  async function openTool(name) {
    const tool = BROWSER_TOOLS.find((t) => t.name === name);
    if (!tool)
      return;
    state.openToolName = name;
    mcpListPane.classList.add("hidden");
    mcpDetailPane.classList.remove("hidden");
    mcpDetail.scrollTop = 0;
    await renderDetail(tool);
  }
  async function renderDetail(tool) {
    overrides = await getToolDescOverrides();
    enabledMap = await resolveToolEnabledMap();
    const on = !!enabledMap[tool.name];
    const kind = browserToolKind(tool.name);
    const params = paramEntries(tool);
    const paramHtml = params.length ? params.map((p) => `
        <div class="param-row">
          <div class="param-head">
            <span class="param-name">${esc2(p.name)}</span>
            <span class="param-type">${esc2(p.type)}</span>
            ${p.required ? '<span class="param-req">\u5FC5\u586B</span>' : ""}
          </div>
          <div class="tool-desc">${esc2(effParamDesc(tool.name, p.name, p.desc) || "\uFF08\u65E0\u8BF4\u660E\uFF09")}</div>
          <input type="text" data-param="${esc2(p.name)}" class="edit-param" placeholder="\u81EA\u5B9A\u4E49\u53C2\u6570\u8BF4\u660E\uFF08\u7559\u7A7A\u7528\u9ED8\u8BA4\uFF09" value="${esc2(overrides[tool.name]?.parameters?.[p.name] || "")}" style="margin-top:5px;"/>
        </div>`).join("") : '<div class="empty-note">\u8BE5\u5DE5\u5177\u65E0\u53C2\u6570</div>';
    const argTemplate = JSON.stringify(Object.fromEntries(params.filter((p) => p.required).map((p) => [p.name, ""])), null, 2);
    mcpDetail.innerHTML = `
    <div class="card">
      <div class="card-title">${esc2(tool.name)}</div>
      <div class="tool-desc" style="font-size:11px;">${esc2(effDescription(tool) || "\uFF08\u65E0\u63CF\u8FF0\uFF09")}</div>
      <div class="detail-enable">
        <label class="check-row" style="margin:0;">
          <input type="checkbox" id="detail-enable" ${on ? "checked" : ""}/>
          <span>\u542F\u7528\u6B64\u5DE5\u5177\uFF08\u4E0A\u62A5\u7ED9\u670D\u52A1\u5668\uFF0CAI \u53EF\u8C03\u7528\uFF09</span>
        </label>
        <span class="tool-kind-tag ${kind}">${esc2(BROWSER_TOOL_KIND_LABELS[kind])} \xB7 ${esc2(browserToolCategory(tool.name) || "\u672A\u5206\u7C7B")}</span>
      </div>
    </div>
    <div class="card">
      <div class="card-title">\u53C2\u6570\u8BF4\u660E</div>
      ${paramHtml}
    </div>
    <div class="card">
      <div class="card-title">\u7F16\u8F91\u63CF\u8FF0\uFF08\u672C\u5730\u4FDD\u5B58\uFF0C\u968F\u4E0A\u62A5\u540C\u6B65\u7ED9\u670D\u52A1\u5668\uFF09</div>
      <div class="fg"><label>\u5DE5\u5177\u63CF\u8FF0\uFF08\u7528\u9014 + \u4F7F\u7528\u573A\u666F\uFF09</label>
        <textarea class="ta" id="edit-desc" placeholder="\u7559\u7A7A\u4F7F\u7528\u9ED8\u8BA4\u63CF\u8FF0">${esc2(overrides[tool.name]?.description || "")}</textarea>
      </div>
      <button class="btn btn-primary" id="edit-save">\u4FDD\u5B58\u63CF\u8FF0</button>
      <button class="btn btn-secondary" id="edit-reset">\u6062\u590D\u9ED8\u8BA4</button>
      <div class="save-feedback" id="edit-feedback"></div>
    </div>
    <div class="card">
      <div class="card-title">\u6D4B\u8BD5\u8C03\u7528 (mcp.test)</div>
      <div class="login-hint">\u5728\u5F53\u524D\u6D4F\u89C8\u5668\u73AF\u5883\u76F4\u63A5\u6267\u884C\u8BE5\u5DE5\u5177\u5E76\u8FD4\u56DE\u539F\u59CB\u7ED3\u679C\u3002</div>
      <div class="fg"><label>\u53C2\u6570 (JSON)</label>
        <textarea class="ta" id="test-args" style="min-height:70px;font-family:'Cascadia Code',Consolas,monospace;">${esc2(argTemplate)}</textarea>
      </div>
      <button class="btn btn-primary" id="test-run">\u6D4B\u8BD5</button>
      <div class="test-result" id="test-result" style="display:none;"></div>
    </div>`;
    mcpDetail.querySelector("#detail-enable").addEventListener("change", async (e) => {
      const checked = e.target.checked;
      await setToolEnabled(tool.name, checked);
      sendToBackground({ type: "agent:connect" });
      await renderDetail(tool);
    });
    mcpDetail.querySelector("#edit-save").addEventListener("click", async () => {
      const description = mcpDetail.querySelector("#edit-desc").value;
      const parameters = {};
      mcpDetail.querySelectorAll(".edit-param").forEach((inp) => {
        parameters[inp.dataset.param] = inp.value;
      });
      await setToolDescOverride(tool.name, { description, parameters });
      sendToBackground({ type: "agent:connect" });
      const fb = mcpDetail.querySelector("#edit-feedback");
      fb.textContent = "\u5DF2\u4FDD\u5B58\uFF0C\u7A0D\u540E\u540C\u6B65\u7ED9\u670D\u52A1\u5668";
      fb.style.color = "var(--success)";
      await renderDetail(tool);
    });
    mcpDetail.querySelector("#edit-reset").addEventListener("click", async () => {
      await setToolDescOverride(tool.name, { description: "", parameters: {} });
      sendToBackground({ type: "agent:connect" });
      await renderDetail(tool);
    });
    mcpDetail.querySelector("#test-run").addEventListener("click", () => {
      const out = mcpDetail.querySelector("#test-result");
      let args = {};
      const raw = mcpDetail.querySelector("#test-args").value.trim();
      if (raw) {
        try {
          args = JSON.parse(raw);
        } catch (e) {
          out.style.display = "block";
          out.className = "test-result fail";
          out.textContent = `\u53C2\u6570 JSON \u89E3\u6790\u5931\u8D25\uFF1A${e?.message || e}`;
          return;
        }
      }
      out.style.display = "block";
      out.className = "test-result";
      out.textContent = "\u6267\u884C\u4E2D\u2026";
      const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      state.pendingTests.set(requestId, (r) => {
        if (r.ok) {
          out.className = "test-result ok";
          out.textContent = "\u6210\u529F\n" + safeStringify(r.result);
        } else {
          out.className = "test-result fail";
          out.textContent = "\u5931\u8D25\uFF1A" + (r.error || "\u672A\u77E5\u9519\u8BEF");
        }
      });
      sendToBackground({ type: "mcp:test", requestId, tool: tool.name, args });
    });
  }
  function safeStringify(v) {
    try {
      return typeof v === "string" ? v : JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  }
  function resolveTest(requestId, r) {
    const fn = state.pendingTests.get(requestId);
    if (!fn)
      return;
    state.pendingTests.delete(requestId);
    fn(r);
  }
  function wireMcp() {
    mcpBack.addEventListener("click", () => void renderMcpList());
  }

  // src/popup/index.ts
  function handleBackgroundMessage(msg) {
    switch (msg.type) {
      case "agent:status":
        setStatus(msg.status);
        if (typeof msg.aiConfigId !== "undefined")
          setBoundAi(msg.aiConfigId ?? null);
        break;
      case "task:start":
        state.stats.total += 1;
        state.stats.running += 1;
        renderStats();
        break;
      case "task:result":
        state.stats.running = Math.max(0, state.stats.running - 1);
        if (msg.data?.success)
          state.stats.success += 1;
        else
          state.stats.failed += 1;
        renderStats();
        break;
      case "settings:data":
        loadSettings(msg.settings);
        break;
      case "mcp:test:result":
        resolveTest(msg.requestId, { ok: msg.ok, result: msg.result, error: msg.error });
        break;
    }
  }
  async function init() {
    initPopupPort(handleBackgroundMessage);
    sendToBackground({ type: "settings:get" });
    renderStats();
    void renderMcpList();
    const s = await getSettings();
    state.serverUrl = s.serverUrl || "";
    state.offlineMode = !!s.offlineMode;
    state.localModel = s.aiModel || "";
    state.auth = await getAuth();
    loginAccount.value = state.auth.account || "";
    loginPassword.value = state.auth.password || "";
    loginRemember.checked = !!state.auth.rememberLogin;
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
        } catch (err) {
          if (isAuthError(err)) {
            await doLogout();
          } else {
            console.warn("getMe failed (transient), keeping session", err);
          }
        }
      })();
    }
  }
  wireUi();
  wireMembers();
  wireSettings();
  wireMcp();
  void init();
})();
