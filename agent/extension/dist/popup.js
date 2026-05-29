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
    activeTab: "chat",
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
    chat: $("tab-chat"),
    tasks: $("tab-tasks"),
    cards: $("tab-cards"),
    settings: $("tab-settings")
  };
  var panes = {
    chat: $("chat-pane"),
    tasks: $("task-pane"),
    cards: $("cards-pane"),
    settings: $("settings-pane")
  };
  var feed = $("feed");
  var feedEmpty = $("feed-empty");
  var chatMsgs = $("chat-messages");
  var chatNoKey = $("chat-no-key");
  var chatInput = $("chat-input");
  var chatSendBtn = $("chat-send");
  var chatTarget = $("chat-target");
  var chatTargetText = $("chat-target-text");
  var chatClearBtn = $("chat-clear-btn");
  var chatSessionSelect = $("chat-session-select");
  var chatSessionDeleteBtn = $("chat-session-delete-btn");
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
  var CHAT_KEY = "_chat_history";
  var MAX_CHAT = 120;
  function normalizeChatHistory(raw) {
    if (!Array.isArray(raw))
      return [];
    return raw.filter((item) => item && (item.role === "user" || item.role === "assistant")).map((item) => ({
      role: item.role,
      content: item.content
    })).slice(-MAX_CHAT);
  }
  async function getChatHistory() {
    const r = await chrome.storage.local.get(CHAT_KEY);
    return normalizeChatHistory(r[CHAT_KEY]);
  }
  async function setChatHistory(messages) {
    await chrome.storage.local.set({ [CHAT_KEY]: normalizeChatHistory(messages) });
  }
  async function clearChatHistory() {
    await chrome.storage.local.remove(CHAT_KEY);
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
  async function startChatRun(serverUrl, token, aiConfigId, sessionId, content, sessionName) {
    return requestJson(
      `${trimUrl(serverUrl)}/api/chat/run/start`,
      {
        method: "POST",
        headers: authHeaders(token, true),
        body: JSON.stringify({
          ai_config_id: aiConfigId,
          ai_kind: "assistant",
          session_id: sessionId,
          session_name: sessionName || "\u6D4F\u89C8\u5668\u63D2\u4EF6\u4F1A\u8BDD",
          visible_content: content,
          model_content: content
        })
      },
      "\u53D1\u8D77\u5BF9\u8BDD\u5931\u8D25"
    );
  }
  async function getChatRun(serverUrl, token, runId, after) {
    const q = after !== void 0 ? `?after=${after}` : "";
    return requestJson(
      `${trimUrl(serverUrl)}/api/chat/run/status/${encodeURIComponent(runId)}${q}`,
      { headers: authHeaders(token) },
      "\u83B7\u53D6\u5BF9\u8BDD\u72B6\u6001\u5931\u8D25"
    );
  }
  async function stopChatRun(serverUrl, token, runId) {
    await fetch(`${trimUrl(serverUrl)}/api/chat/run/${encodeURIComponent(runId)}/stop`, {
      method: "POST",
      headers: authHeaders(token),
      signal: AbortSignal.timeout(1e4)
    }).catch(() => {
    });
  }
  var chatQs = (aiConfigId, extra = {}) => {
    const params = { ai_kind: "assistant", ...extra };
    if (aiConfigId !== null && aiConfigId !== void 0)
      params.ai_config_id = String(aiConfigId);
    return new URLSearchParams(params).toString();
  };
  async function listChatSessions(serverUrl, token, aiConfigId) {
    const rows = await requestJson(
      `${trimUrl(serverUrl)}/api/chat/sessions?${chatQs(aiConfigId)}`,
      { headers: authHeaders(token) },
      "\u4F1A\u8BDD\u5217\u8868\u52A0\u8F7D\u5931\u8D25"
    );
    return (Array.isArray(rows) ? rows : []).map((row) => ({
      id: String(row?.id || ""),
      name: String(row?.name || "\u672A\u547D\u540D\u4F1A\u8BDD"),
      total_tokens: Number(row?.total_tokens || 0)
    }));
  }
  async function createChatSession(serverUrl, token, name, aiConfigId) {
    const row = await requestJson(
      `${trimUrl(serverUrl)}/api/chat/sessions`,
      {
        method: "POST",
        headers: authHeaders(token, true),
        body: JSON.stringify({ name, ai_config_id: aiConfigId, ai_kind: "assistant" })
      },
      "\u521B\u5EFA\u4F1A\u8BDD\u5931\u8D25"
    );
    return { id: String(row?.id || ""), name: String(row?.name || name || "\u672A\u547D\u540D\u4F1A\u8BDD") };
  }
  async function deleteChatSession(serverUrl, token, sessionId, aiConfigId) {
    const res = await fetch(
      `${trimUrl(serverUrl)}/api/chat/sessions/${encodeURIComponent(sessionId)}?${chatQs(aiConfigId)}`,
      { method: "DELETE", headers: authHeaders(token), signal: AbortSignal.timeout(1e4) }
    );
    if (!res.ok)
      throw new ApiError(await parseError(res, "\u5220\u9664\u4F1A\u8BDD\u5931\u8D25"), res.status);
  }
  async function fetchChatHistory(serverUrl, token, sessionId, aiConfigId) {
    const rows = await requestJson(
      `${trimUrl(serverUrl)}/api/chat/history?${chatQs(aiConfigId, { session_id: sessionId })}`,
      { headers: authHeaders(token) },
      "\u52A0\u8F7D\u5BF9\u8BDD\u8BB0\u5F55\u5931\u8D25"
    );
    return Array.isArray(rows) ? rows : [];
  }
  async function deleteServerChatMessage(serverUrl, token, msgId) {
    const res = await fetch(
      `${trimUrl(serverUrl)}/api/chat/${msgId}`,
      { method: "DELETE", headers: authHeaders(token), signal: AbortSignal.timeout(1e4) }
    );
    if (!res.ok)
      throw new ApiError(await parseError(res, "\u5220\u9664\u6D88\u606F\u5931\u8D25"), res.status);
  }
  async function recallServerChatMessage(serverUrl, token, msgId) {
    return requestJson(
      `${trimUrl(serverUrl)}/api/chat/recall/${msgId}`,
      { method: "POST", headers: authHeaders(token) },
      "\u64A4\u56DE\u5931\u8D25"
    );
  }
  async function triggerTask(serverUrl, token, configId, payload) {
    return requestJson(
      `${trimUrl(serverUrl)}/api/ai/configs/${configId}/task-trigger`,
      { method: "POST", headers: authHeaders(token, true), body: JSON.stringify(payload) },
      "\u5B89\u6392\u4EFB\u52A1\u5931\u8D25"
    );
  }
  async function listTaskJobs(serverUrl, token, configId) {
    const data = await requestJson(
      `${trimUrl(serverUrl)}/api/ai/configs/${configId}/task-jobs`,
      { headers: authHeaders(token) },
      "\u4EFB\u52A1\u5217\u8868\u52A0\u8F7D\u5931\u8D25"
    );
    return Array.isArray(data?.jobs) ? data.jobs : [];
  }
  async function taskJobAction(serverUrl, token, configId, jobId, action) {
    const base = `${trimUrl(serverUrl)}/api/ai/configs/${configId}/task-jobs/${encodeURIComponent(jobId)}`;
    if (action === "delete") {
      const res2 = await fetch(base, { method: "DELETE", headers: authHeaders(token), signal: AbortSignal.timeout(1e4) });
      if (!res2.ok)
        throw new ApiError(await parseError(res2, "\u5220\u9664\u4EFB\u52A1\u5931\u8D25"), res2.status);
      return;
    }
    const res = await fetch(`${base}/${action}`, { method: "POST", headers: authHeaders(token), signal: AbortSignal.timeout(1e4) });
    if (!res.ok)
      throw new ApiError(await parseError(res, `${action} \u4EFB\u52A1\u5931\u8D25`), res.status);
  }

  // src/popup/markdown.ts
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function inlineMd(text) {
    const placeholders = [];
    const stash = (html) => {
      const key = `@@HTML_${placeholders.length}@@`;
      placeholders.push(html);
      return key;
    };
    let out = esc(text);
    out = out.replace(/`([^`]+)`/g, (_, code) => stash(`<code>${esc(code)}</code>`));
    out = out.replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      (_, label, url) => stash(`<a href="${esc(url)}" target="_blank" rel="noreferrer">${esc(label)}</a>`)
    );
    out = out.replace(
      /(^|[\s(])(https?:\/\/[^\s<)]+)/g,
      (_, prefix, url) => `${prefix}${stash(`<a href="${esc(url)}" target="_blank" rel="noreferrer">${esc(url)}</a>`)}`
    );
    out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/__([^_]+)__/g, "<strong>$1</strong>").replace(/\*([^*\n]+)\*/g, "<em>$1</em>").replace(/_([^_\n]+)_/g, "<em>$1</em>").replace(/~~([^~]+)~~/g, "<del>$1</del>");
    placeholders.forEach((html, idx) => {
      out = out.replaceAll(`@@HTML_${idx}@@`, html);
    });
    return out;
  }
  function isMarkdownTableStart(lines, index) {
    const head = lines[index]?.trim() || "";
    const sep = lines[index + 1]?.trim() || "";
    return /^\|.+\|$/.test(head) && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(sep);
  }
  function parseTableRow(line) {
    return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
  }
  function renderMarkdownTable(lines, start) {
    const headers = parseTableRow(lines[start]);
    let idx = start + 2;
    const rows = [];
    while (idx < lines.length && /^\|.+\|$/.test(lines[idx].trim())) {
      rows.push(parseTableRow(lines[idx]));
      idx++;
    }
    const head = headers.map((cell) => `<th>${inlineMd(cell)}</th>`).join("");
    const body = rows.map((row) => `<tr>${headers.map((_, i) => `<td>${inlineMd(row[i] || "")}</td>`).join("")}</tr>`).join("");
    return {
      html: `<div class="chat-table-wrap"><table class="chat-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`,
      next: idx
    };
  }
  function renderMarkdown(text) {
    const src = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
    if (!src)
      return "";
    const blocks = [];
    const parts = src.split(/(```[\s\S]*?```)/g);
    for (const part of parts) {
      if (!part)
        continue;
      const fence = part.match(/^```([\w-]*)\n?([\s\S]*?)```$/);
      if (fence) {
        const lang = fence[1] ? `<div class="chat-mcp-title">${esc(fence[1])}</div>` : "";
        blocks.push(`${lang}<pre>${esc(fence[2].trim())}</pre>`);
        continue;
      }
      const lines = part.split("\n");
      let para = [];
      let list = [];
      let ordered = false;
      const flushPara = () => {
        if (para.length) {
          blocks.push(`<p>${inlineMd(para.join("\n")).replace(/\n/g, "<br>")}</p>`);
          para = [];
        }
      };
      const flushList = () => {
        if (list.length) {
          blocks.push(`<${ordered ? "ol" : "ul"}>${list.join("")}</${ordered ? "ol" : "ul"}>`);
          list = [];
        }
      };
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        const trimmed = line.trim();
        if (!trimmed) {
          flushPara();
          flushList();
          continue;
        }
        if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
          flushPara();
          flushList();
          blocks.push("<hr>");
          continue;
        }
        if (isMarkdownTableStart(lines, lineIndex)) {
          flushPara();
          flushList();
          const table = renderMarkdownTable(lines, lineIndex);
          blocks.push(table.html);
          lineIndex = table.next - 1;
          continue;
        }
        const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
        if (heading) {
          flushPara();
          flushList();
          const level = Math.min(3, heading[1].length);
          blocks.push(`<h${level}>${inlineMd(heading[2])}</h${level}>`);
          continue;
        }
        const quote = trimmed.match(/^>\s+(.+)$/);
        if (quote) {
          flushPara();
          flushList();
          blocks.push(`<blockquote>${inlineMd(quote[1])}</blockquote>`);
          continue;
        }
        const task = trimmed.match(/^[-*]\s+\[([ xX])\]\s+(.+)$/);
        const unordered = trimmed.match(/^[-*]\s+(.+)$/);
        const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
        if (task || unordered || orderedMatch) {
          flushPara();
          const nextOrdered = !!orderedMatch;
          if (list.length && ordered !== nextOrdered)
            flushList();
          ordered = nextOrdered;
          if (task) {
            const checked = task[1].trim().toLowerCase() === "x";
            list.push(`<li class="chat-task"><span class="chat-check">${checked ? "\u2713" : ""}</span>${inlineMd(task[2])}</li>`);
          } else {
            list.push(`<li>${inlineMd((unordered || orderedMatch)[1])}</li>`);
          }
          continue;
        }
        flushList();
        para.push(line);
      }
      flushPara();
      flushList();
    }
    return `<div class="chat-md">${blocks.join("")}</div>`;
  }
  function normalizeJsonText(raw) {
    const text = String(raw || "").trim();
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }
  var MCP_CALL_BLOCK_RE = /<mcp[-_]call>\s*([\s\S]*?)\s*<\/\s*(?:mcp[-_]call|[｜|]*\s*DSML\s*[｜|]*\s*(?:invoke|tool[-_]?calls?))\s*>/gi;
  var MCP_HEADER_LINE_RE = /^(?:#{1,6}\s*)?(\[MCP执行[^\]]*\]|\[工具参数\]|\[工具执行结果\]|系统已执行工具[：:].*|工具(?:名称)?[：:].*|执行状态[：:].*|状态[：:].*|可用工具[：:].*)$/i;
  function splitInlineContent(text) {
    let body = String(text || "");
    const reasoning = [];
    body = body.replace(/<think>\s*([\s\S]*?)\s*<\/think>/gi, (_, inner) => {
      reasoning.push(String(inner || "").trim());
      return "";
    });
    const parts = [];
    const matches = [];
    for (const m of body.matchAll(MCP_CALL_BLOCK_RE)) {
      matches.push({
        index: m.index ?? 0,
        length: m[0].length,
        payload: normalizeJsonText(String(m[1] || "").trim())
      });
    }
    matches.sort((a, b) => a.index - b.index);
    let cursor = 0;
    for (const m of matches) {
      if (m.index > cursor) {
        const slice = body.slice(cursor, m.index);
        if (slice.trim())
          parts.push({ kind: "text", content: slice });
      }
      parts.push({ kind: "mcp-block", content: m.payload });
      cursor = m.index + m.length;
    }
    if (cursor < body.length) {
      const tail = body.slice(cursor);
      if (tail.trim())
        parts.push({ kind: "text", content: tail });
    }
    if (!parts.length && body.trim())
      parts.push({ kind: "text", content: body });
    const refined = [];
    for (const part of parts) {
      if (part.kind !== "text") {
        refined.push(part);
        continue;
      }
      const lines = part.content.split("\n");
      const headerIdx = lines.findIndex((line) => MCP_HEADER_LINE_RE.test(line.trim()));
      if (headerIdx < 0) {
        refined.push(part);
        continue;
      }
      const plain = lines.slice(0, headerIdx).join("\n").trimEnd();
      const mcpText = lines.slice(headerIdx).join("\n").trim();
      if (plain)
        refined.push({ kind: "text", content: plain });
      if (mcpText)
        refined.push({ kind: "mcp-snippet", content: mcpText });
    }
    return { reasoning, parts: refined };
  }
  function renderChatEvent(event) {
    return `<div class="chat-mcp-card"><div class="chat-mcp-title">${esc(event.label)}</div>` + (event.imageUrl ? `<img class="chat-tool-image" src="${esc(event.imageUrl)}" alt="browser screenshot" />` : "") + (event.detail ? `<pre class="chat-mcp-pre">${esc(event.detail)}</pre>` : "") + `</div>`;
  }
  function renderMcpBlockHtml(payload) {
    return `<div class="chat-mcp-card"><div class="chat-mcp-title">\u{1F9F0} MCP \u8C03\u7528</div><pre class="chat-mcp-pre">${esc(payload)}</pre></div>`;
  }
  function renderMcpSnippetHtml(text) {
    return `<div class="chat-mcp-card"><div class="chat-mcp-title">MCP \u64CD\u4F5C</div><pre class="chat-mcp-pre">${esc(text)}</pre></div>`;
  }
  function renderChatContent(text, opts = {}) {
    const { reasoning: inlineReasoning, parts } = splitInlineContent(text);
    const reasoningParts = [opts.reasoning, ...inlineReasoning].map((v) => String(v || "").trim()).filter(Boolean);
    const chunks = [];
    if (reasoningParts.length) {
      chunks.push(
        `<details class="chat-reasoning" ${opts.loading ? "open" : ""}><summary>\u6DF1\u5EA6\u601D\u8003</summary><div class="chat-reasoning-body">${esc(reasoningParts.join("\n\n"))}</div></details>`
      );
    }
    if (opts.currentTool) {
      chunks.push(`<div class="chat-tool-phase">\u2699 \u7B49\u5F85 MCP: ${esc(opts.currentTool)}</div>`);
    }
    for (const part of parts) {
      if (part.kind === "text")
        chunks.push(renderMarkdown(part.content));
      else if (part.kind === "mcp-block")
        chunks.push(renderMcpBlockHtml(part.content));
      else
        chunks.push(renderMcpSnippetHtml(part.content));
    }
    if (opts.toolsUsed?.length) {
      chunks.push(
        `<div class="chat-mcp-card"><div class="chat-mcp-title">\u{1F9F0} MCP \u8C03\u7528</div><div class="tool-chips">${opts.toolsUsed.map((tool) => `<span class="tool-chip">${esc(tool)}</span>`).join("")}</div></div>`
      );
    }
    if (!chunks.length && opts.loading) {
      chunks.push('<div class="chat-empty-live">\u601D\u8003\u4E2D...</div><div class="thinking"><span></span><span></span><span></span></div>');
    }
    return chunks.join("");
  }
  function renderChatFrame(text, opts = {}) {
    return [
      ...(opts.events || []).map(renderChatEvent),
      renderChatContent(text, opts)
    ].filter(Boolean).join("");
  }

  // src/popup/helpers.ts
  var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
  function useServerChat() {
    return !!(!state.offlineMode && state.auth.token && state.selectedMemberId);
  }
  function syncSelectedAiToBackground(force = false) {
    if (!state.selectedMemberId)
      return;
    if (!state.auth.token && !force)
      return;
    if (!memberById(state.selectedMemberId))
      return;
    state.port.postMessage({ type: "agent:selected-ai", aiConfigId: state.selectedMemberId });
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

  // src/popup/chat.ts
  function syncChatHistory() {
    if (useServerChat())
      return Promise.resolve();
    return setChatHistory(state.chatHistory);
  }
  function clearChatMessages() {
    chatMsgs.querySelectorAll(".chat-msg").forEach((e) => e.remove());
  }
  function chatContentToText(content) {
    return typeof content === "string" ? content : JSON.stringify(content);
  }
  function makeChatRequestId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  function rowActionsHtml(role, supportsRecall) {
    const isUser = role === "user";
    const buttons = [
      '<button class="chat-action-btn" type="button" data-chat-action="copy" title="\u590D\u5236">\u590D\u5236</button>'
    ];
    if (isUser && supportsRecall) {
      buttons.push('<button class="chat-action-btn" type="button" data-chat-action="revoke" title="\u64A4\u56DE\u6B64\u6D88\u606F\u53CA\u4E4B\u540E\u6240\u6709\u5BF9\u8BDD">\u64A4\u56DE</button>');
    }
    buttons.push('<button class="chat-action-btn danger" type="button" data-chat-action="delete" title="\u5220\u9664\u6B64\u6D88\u606F">\u5220\u9664</button>');
    return `<div class="chat-msg-actions" aria-label="\u6D88\u606F\u64CD\u4F5C">${buttons.join("")}</div>`;
  }
  function appendChatMsg(role, content, historyIndex) {
    chatNoKey.style.display = "none";
    const el = document.createElement("div");
    el.className = `chat-msg ${role}`;
    if (historyIndex !== void 0)
      el.dataset.historyIndex = String(historyIndex);
    const supportsRecall = role === "user";
    const avatar = role === "ai" ? "\u2728" : currentAvatarHtml("\u{1F464}");
    el.innerHTML = `<div class="chat-avatar">${avatar}</div><div class="chat-bubble">${rowActionsHtml(role, supportsRecall)}${renderChatContent(content)}</div>`;
    chatMsgs.appendChild(el);
    chatMsgs.scrollTop = chatMsgs.scrollHeight;
    return el;
  }
  function renderChatHistory() {
    clearChatMessages();
    if (!state.chatHistory.length) {
      refreshChatAvailability();
      return;
    }
    state.chatHistory.forEach((msg, index) => {
      const role = msg.role === "assistant" ? "ai" : "user";
      const el = appendChatMsg(role, chatContentToText(msg.content), index);
      if (msg.serverId !== void 0)
        el.dataset.serverId = String(msg.serverId);
    });
    refreshChatAvailability();
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
    state.chatBusy = busy;
    refreshChatAvailability();
  }
  async function restoreChatHistory() {
    if (useServerChat())
      return;
    state.chatHistory = await getChatHistory();
    renderChatHistory();
  }
  function defaultSessionIdForMember() {
    return `ext-${state.selectedMemberId}`;
  }
  function isExtensionSession(name) {
    return /^浏览器插件(?:会话| 对话)/.test(String(name || "").trim());
  }
  function pickPreferredSessionId(items) {
    if (!items.length)
      return "";
    const ext = items.find((item) => isExtensionSession(item.name));
    return (ext || items[0]).id;
  }
  function updateChatSessionControls() {
    if (!useServerChat()) {
      chatSessionSelect.classList.add("hidden");
      chatSessionDeleteBtn.style.display = "none";
      chatClearBtn.textContent = "\u6E05\u7A7A";
      chatClearBtn.title = "\u6E05\u7A7A\u672C\u5730\u5BF9\u8BDD\u8BB0\u5F55";
      return;
    }
    chatClearBtn.textContent = "\u65B0\u5EFA\u5BF9\u8BDD";
    chatClearBtn.title = "\u5728\u670D\u52A1\u5668\u4E0A\u65B0\u5EFA\u4E00\u6BB5\u5BF9\u8BDD\uFF08\u4FDD\u7559\u5F53\u524D\u5386\u53F2\uFF09";
    if (state.serverSessions.length === 0) {
      chatSessionSelect.classList.add("hidden");
      chatSessionDeleteBtn.style.display = "none";
      return;
    }
    chatSessionSelect.innerHTML = state.serverSessions.map((s) => `<option value="${esc(s.id)}"${s.id === state.currentServerSessionId ? " selected" : ""}>${esc(s.name)}</option>`).join("");
    chatSessionSelect.classList.remove("hidden");
    chatSessionDeleteBtn.style.display = state.serverSessions.length > 1 ? "block" : "none";
  }
  function chatMessageFromServer(row) {
    const role = String(row?.role || "");
    if (role !== "user" && role !== "assistant" && role !== "system")
      return null;
    const content = String(row?.content || "");
    const think = String(row?.think || "");
    const merged = think ? `<think>${think}</think>${content}` : content;
    return {
      role,
      content: merged,
      serverId: typeof row?.id === "number" ? row.id : void 0,
      think: think || void 0,
      createdAt: typeof row?.created_at === "number" ? row.created_at : void 0
    };
  }
  async function loadServerChatHistory(sessionId) {
    if (!useServerChat() || !sessionId)
      return false;
    if (state.chatHistoryLoading)
      return false;
    state.chatHistoryLoading = true;
    try {
      const rows = await fetchChatHistory(state.serverUrl, state.auth.token, sessionId, state.selectedMemberId);
      state.chatHistory = rows.map(chatMessageFromServer).filter((m) => m !== null);
      state.lastSyncedMessageId = state.chatHistory.reduce(
        (max, m) => m.serverId && m.serverId > max ? m.serverId : max,
        0
      );
      renderChatHistory();
      return true;
    } catch (err) {
      if (isAuthError(err)) {
        await doLogout();
        return false;
      }
      console.warn("loadServerChatHistory failed", err);
      return false;
    } finally {
      state.chatHistoryLoading = false;
    }
  }
  async function refreshServerSessionsAndHistory(targetSessionId) {
    if (!useServerChat())
      return;
    try {
      state.serverSessions = await listChatSessions(state.serverUrl, state.auth.token, state.selectedMemberId);
    } catch (err) {
      if (isAuthError(err)) {
        await doLogout();
        return;
      }
      console.warn("listChatSessions failed", err);
      state.serverSessions = [];
    }
    if (!state.serverSessions.length) {
      try {
        const created = await createChatSession(state.serverUrl, state.auth.token, "\u6D4F\u89C8\u5668\u63D2\u4EF6\u4F1A\u8BDD", state.selectedMemberId);
        state.serverSessions = [created];
      } catch (err) {
        console.warn("createChatSession failed", err);
      }
    }
    const preferred = targetSessionId && state.serverSessions.some((s) => s.id === targetSessionId) ? targetSessionId : state.currentServerSessionId && state.serverSessions.some((s) => s.id === state.currentServerSessionId) ? state.currentServerSessionId : pickPreferredSessionId(state.serverSessions);
    state.currentServerSessionId = preferred;
    updateChatSessionControls();
    if (preferred)
      await loadServerChatHistory(preferred);
    else {
      state.chatHistory = [];
      renderChatHistory();
    }
  }
  async function syncIncrementalServerHistory() {
    if (!useServerChat() || !state.currentServerSessionId)
      return;
    try {
      const rows = await fetchChatHistory(state.serverUrl, state.auth.token, state.currentServerSessionId, state.selectedMemberId);
      const incoming = [];
      let maxId = state.lastSyncedMessageId;
      for (const row of rows) {
        const msg = chatMessageFromServer(row);
        if (!msg)
          continue;
        if (msg.serverId !== void 0 && msg.serverId <= state.lastSyncedMessageId)
          continue;
        incoming.push(msg);
        if (msg.serverId !== void 0 && msg.serverId > maxId)
          maxId = msg.serverId;
      }
      if (!incoming.length)
        return;
      for (const msg of incoming) {
        if (msg.role !== "assistant")
          continue;
        const idx = state.chatHistory.findIndex((item) => item.serverId === void 0 && item.role === "assistant" && chatContentToText(item.content).trim() === chatContentToText(msg.content).trim());
        if (idx >= 0)
          state.chatHistory.splice(idx, 1);
      }
      state.chatHistory.push(...incoming);
      state.lastSyncedMessageId = maxId;
      renderChatHistory();
    } catch (err) {
      console.warn("syncIncrementalServerHistory failed", err);
    }
  }
  async function clearConversation() {
    if (state.chatBusy)
      stopPendingChatUi();
    if (useServerChat()) {
      try {
        const name = `\u6D4F\u89C8\u5668\u63D2\u4EF6\u4F1A\u8BDD ${(/* @__PURE__ */ new Date()).toLocaleString("zh-CN", { hour12: false })}`;
        const created = await createChatSession(state.serverUrl, state.auth.token, name, state.selectedMemberId);
        state.chatHistory = [];
        state.lastSyncedMessageId = 0;
        renderChatHistory();
        await refreshServerSessionsAndHistory(created.id);
      } catch (err) {
        console.warn("createChatSession failed", err);
        alert(`\u65B0\u5EFA\u5BF9\u8BDD\u5931\u8D25\uFF1A${err?.message || err}`);
      }
      return;
    }
    state.chatHistory = [];
    await clearChatHistory();
    renderChatHistory();
  }
  async function deleteCurrentServerSession() {
    if (!useServerChat() || !state.currentServerSessionId)
      return;
    if (state.serverSessions.length <= 1)
      return;
    const target = state.serverSessions.find((s) => s.id === state.currentServerSessionId);
    if (!target)
      return;
    if (!confirm(`\u786E\u5B9A\u5220\u9664\u4F1A\u8BDD\u300C${target.name}\u300D\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u6062\u590D\u3002`))
      return;
    try {
      await deleteChatSession(state.serverUrl, state.auth.token, state.currentServerSessionId, state.selectedMemberId);
      state.currentServerSessionId = "";
      await refreshServerSessionsAndHistory();
    } catch (err) {
      alert(`\u5220\u9664\u4F1A\u8BDD\u5931\u8D25\uFF1A${err?.message || err}`);
    }
  }
  async function writeClipboardText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  function stopPendingChatUi() {
    state.activeChatRequestId = null;
    const thinking = window._chatThinking;
    thinking?.remove();
    window._chatThinking = null;
    const liveThinking = document.getElementById("thinking");
    liveThinking?.remove();
    if (state.activeRunId && state.auth.token) {
      void stopChatRun(state.serverUrl, state.auth.token, state.activeRunId).catch(() => {
      });
    }
    state.activeRunId = null;
    setChatBusy(false);
  }
  async function deleteChatMessage(index) {
    const msg = state.chatHistory[index];
    if (!msg)
      return;
    const lastUserIndex = state.chatHistory.map((m) => m.role).lastIndexOf("user");
    if (state.chatBusy && index === lastUserIndex)
      stopPendingChatUi();
    if (useServerChat() && msg.serverId !== void 0) {
      if (!confirm("\u786E\u5B9A\u8981\u5220\u9664\u8FD9\u6761\u6D88\u606F\u5417\uFF1F"))
        return;
      try {
        await deleteServerChatMessage(state.serverUrl, state.auth.token, msg.serverId);
      } catch (err) {
        alert(`\u5220\u9664\u5931\u8D25\uFF1A${err?.message || err}`);
        return;
      }
    }
    state.chatHistory.splice(index, 1);
    await syncChatHistory();
    renderChatHistory();
  }
  async function revokeChatMessage(index) {
    const msg = state.chatHistory[index];
    if (!msg || msg.role !== "user")
      return;
    const text = chatContentToText(msg.content);
    if (state.chatBusy)
      stopPendingChatUi();
    if (useServerChat() && msg.serverId !== void 0) {
      if (!confirm("\u786E\u5B9A\u64A4\u56DE\u6B64\u6D88\u606F\uFF1F\u5C06\u5220\u9664\u5B83\u4E4B\u540E\u7684\u5BF9\u8BDD\u3002"))
        return;
      try {
        const result = await recallServerChatMessage(state.serverUrl, state.auth.token, msg.serverId);
        chatInput.value = result?.recall_content || text;
      } catch (err) {
        alert(`\u64A4\u56DE\u5931\u8D25\uFF1A${err?.message || err}`);
        return;
      }
      state.chatHistory.splice(index);
      state.lastSyncedMessageId = state.chatHistory.reduce(
        (max, m) => m.serverId && m.serverId > max ? m.serverId : max,
        0
      );
    } else {
      state.chatHistory.splice(index);
      chatInput.value = text;
    }
    await syncChatHistory();
    renderChatHistory();
    chatInput.style.height = "auto";
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
    refreshChatAvailability();
    chatInput.focus();
  }
  async function runServerChat(text, thinking) {
    if (!state.currentServerSessionId) {
      await refreshServerSessionsAndHistory();
    }
    const sessionId = state.currentServerSessionId || defaultSessionIdForMember();
    const sessionName = state.serverSessions.find((s) => s.id === sessionId)?.name || "\u6D4F\u89C8\u5668\u63D2\u4EF6\u4F1A\u8BDD";
    const { run_id } = await startChatRun(state.serverUrl, state.auth.token, state.selectedMemberId, sessionId, text, sessionName);
    state.activeRunId = run_id;
    let after = 0;
    let lastText = "";
    let lastReasoning = "";
    let lastPhaseKey = "";
    const liveEvents = [];
    const MAX_POLLS = 600;
    for (let i = 0; i < MAX_POLLS; i++) {
      await sleep(800);
      let st;
      try {
        st = await getChatRun(state.serverUrl, state.auth.token, run_id, after);
      } catch {
        continue;
      }
      lastReasoning = String(st.live_reasoning || lastReasoning || "");
      const phase = String(st.live_phase || "");
      const currentTool = String(st.current_tool || "");
      if (currentTool && phase === "waiting_mcp") {
        const key = `${phase}:${currentTool}:${liveEvents.length}`;
        if (lastPhaseKey !== `${phase}:${currentTool}`) {
          liveEvents.push({
            key,
            label: "MCP \u8C03\u7528\u4E2D",
            detail: currentTool
          });
          lastPhaseKey = `${phase}:${currentTool}`;
        }
      } else if (phase && phase !== "waiting_mcp") {
        lastPhaseKey = `${phase}:${currentTool}`;
      }
      if (st.live_text && st.live_text !== lastText) {
        lastText = st.live_text;
        after = st.live_len;
        setBubble(thinking, renderChatFrame(lastText, {
          reasoning: lastReasoning,
          currentTool,
          loading: true,
          events: liveEvents
        }));
      } else if (lastReasoning || currentTool || liveEvents.length) {
        setBubble(thinking, renderChatFrame(lastText, {
          reasoning: lastReasoning,
          currentTool,
          loading: true,
          events: liveEvents
        }));
      }
      if (["completed", "error", "stopped"].includes(st.status)) {
        state.activeRunId = null;
        if (st.status === "error")
          return { text: `\u26A0 \u9519\u8BEF: ${st.error_message || "\u6267\u884C\u5931\u8D25"}`, reasoning: lastReasoning, events: liveEvents, ok: false };
        if (st.status === "stopped")
          return { text: lastText || "\uFF08\u5DF2\u505C\u6B62\uFF09", reasoning: lastReasoning, events: liveEvents, ok: true };
        return { text: lastText || "\u5B8C\u6210", reasoning: lastReasoning, events: liveEvents, ok: true };
      }
    }
    state.activeRunId = null;
    return { text: lastText || "\uFF08\u8D85\u65F6\uFF0C\u672A\u6536\u5230\u5B8C\u6574\u56DE\u590D\uFF09", reasoning: lastReasoning, events: liveEvents, ok: false };
  }
  async function sendChat() {
    const enabled = useServerChat() || state.hasAiKey;
    if (state.chatBusy || !enabled)
      return;
    const text = chatInput.value.trim();
    if (!text)
      return;
    chatInput.value = "";
    chatInput.style.height = "auto";
    state.chatHistory.push({ role: "user", content: text });
    appendChatMsg("user", text, state.chatHistory.length - 1);
    void syncChatHistory();
    const thinking = showThinking();
    const requestId = makeChatRequestId();
    state.activeChatRequestId = requestId;
    setChatBusy(true);
    if (useServerChat()) {
      try {
        const res = await runServerChat(text, thinking);
        if (state.activeChatRequestId !== requestId)
          return;
        setBubble(thinking, renderChatFrame(res.text, { reasoning: res.reasoning, events: res.events }));
        thinking.removeAttribute("id");
        const lastIdx = state.chatHistory.length - 1;
        if (lastIdx >= 0 && state.chatHistory[lastIdx].serverId === void 0 && state.chatHistory[lastIdx].role === "user") {
          state.chatHistory.splice(lastIdx, 1);
        }
        await syncIncrementalServerHistory();
      } catch (err) {
        if (state.activeChatRequestId !== requestId)
          return;
        const errorText = `\u26A0 \u9519\u8BEF: ${err?.message || err}`;
        setBubble(thinking, renderChatContent(errorText));
        thinking.removeAttribute("id");
        await syncIncrementalServerHistory();
      } finally {
        if (state.activeChatRequestId === requestId) {
          state.activeChatRequestId = null;
          setChatBusy(false);
        }
      }
    } else {
      ;
      window._chatThinking = thinking;
      state.port.postMessage({ type: "chat:send", messages: state.chatHistory, requestId });
    }
  }
  function wireChat() {
    chatMsgs.addEventListener("click", (e) => {
      const btn = e.target.closest(".chat-action-btn");
      if (!btn)
        return;
      e.preventDefault();
      e.stopPropagation();
      const msgEl = btn.closest(".chat-msg");
      const index = Number(msgEl?.dataset.historyIndex);
      if (!Number.isInteger(index) || !state.chatHistory[index])
        return;
      const action = btn.dataset.chatAction;
      if (action === "copy") {
        const originalText = btn.textContent;
        void writeClipboardText(chatContentToText(state.chatHistory[index].content)).then(() => {
          btn.textContent = "\u5DF2\u590D\u5236";
          setTimeout(() => {
            btn.textContent = originalText || "\u590D\u5236";
          }, 900);
        });
      } else if (action === "revoke") {
        void revokeChatMessage(index);
      } else if (action === "delete") {
        void deleteChatMessage(index);
      }
    });
    chatClearBtn.addEventListener("click", () => void clearConversation());
    chatSessionDeleteBtn.addEventListener("click", () => void deleteCurrentServerSession());
    chatSessionSelect.addEventListener("change", () => {
      const next = chatSessionSelect.value;
      if (!next || next === state.currentServerSessionId)
        return;
      state.currentServerSessionId = next;
      state.lastSyncedMessageId = 0;
      void loadServerChatHistory(next);
    });
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
      syncSelectedAiToBackground(true);
      renderSettingsViews();
      if (useServerChat())
        await refreshServerSessionsAndHistory();
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
    state.port.postMessage({ type: "agent:selected-ai", aiConfigId: null });
    state.auth = await getAuth();
    state.avatarDataUrl = "";
    await clearAvatarCache();
    closeMembersModal();
    state.members = [];
    state.selectedMemberId = null;
    state.serverSessions = [];
    state.currentServerSessionId = "";
    state.lastSyncedMessageId = 0;
    state.chatHistory = [];
    renderChatHistory();
    updateChatSessionControls();
    updateUserChip();
    renderMembers();
    updateTargetBanners();
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
      if (state.selectedMemberId) {
        const stillExists = rows.some((m) => m.id === state.selectedMemberId);
        if (!stillExists) {
          state.selectedMemberId = null;
          state.port.postMessage({ type: "agent:selected-ai", aiConfigId: null });
          state.serverSessions = [];
          state.currentServerSessionId = "";
          state.lastSyncedMessageId = 0;
          state.chatHistory = [];
          renderChatHistory();
          updateChatSessionControls();
        } else {
          if (!state.members.some((m) => m.id === state.selectedMemberId)) {
            const sel = rows.find((m) => m.id === state.selectedMemberId);
            if (sel)
              state.members = [...state.members, sel];
          }
          state.port.postMessage({ type: "agent:selected-ai", aiConfigId: state.selectedMemberId });
        }
      }
      renderMembers();
      updateTargetBanners();
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
      el.className = `member-card${m.id === state.selectedMemberId ? " selected" : ""}`;
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
  async function selectMember(id) {
    if (!state.auth.token) {
      state.selectedMemberId = null;
      state.port.postMessage({ type: "agent:selected-ai", aiConfigId: null });
      loginFeedback.textContent = "\u8BF7\u5148\u767B\u5F55\u540E\u518D\u9009\u62E9 AI \u6210\u5458";
      loginFeedback.style.color = "var(--warn)";
      switchTab("settings");
      renderMembers();
      updateTargetBanners();
      renderSettingsViews();
      return;
    }
    state.selectedMemberId = id;
    await saveSettings({ selectedAiConfigId: id });
    state.port.postMessage({ type: "agent:selected-ai", aiConfigId: id });
    renderMembers();
    updateTargetBanners();
    renderSettingsViews();
    renderStatus();
    state.chatHistory = [];
    state.serverSessions = [];
    state.currentServerSessionId = "";
    state.lastSyncedMessageId = 0;
    chatMsgs.querySelectorAll(".chat-msg").forEach((e) => e.remove());
    updateChatSessionControls();
    if (useServerChat())
      void refreshServerSessionsAndHistory();
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

  // src/popup/tasks.ts
  async function submitTask() {
    if (!state.auth.token || !state.selectedMemberId)
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
      const res = await triggerTask(state.serverUrl, state.auth.token, state.selectedMemberId, {
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
  async function loadJobs() {
    if (!state.auth.token || !state.selectedMemberId)
      return;
    jobsEmpty.textContent = "\u52A0\u8F7D\u4E2D\u2026";
    jobsEmpty.style.display = "block";
    try {
      const jobs = await listTaskJobs(state.serverUrl, state.auth.token, state.selectedMemberId);
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
    if (!state.auth.token || !state.selectedMemberId)
      return;
    try {
      await taskJobAction(state.serverUrl, state.auth.token, state.selectedMemberId, jobId, action);
      await loadJobs();
    } catch (err) {
      taskFeedback.textContent = `\u64CD\u4F5C\u5931\u8D25\uFF1A${err?.message || err}`;
      taskFeedback.style.color = "var(--error)";
    }
  }
  function wireTasks() {
    taskSchedEnabled.addEventListener("change", () => {
      taskSchedOpts.style.display = taskSchedEnabled.checked ? "block" : "none";
    });
    taskSubmit.addEventListener("click", () => void submitTask());
    jobsRefresh.addEventListener("click", () => void loadJobs());
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
    if (tab === "chat") {
      chatMsgs.scrollTop = chatMsgs.scrollHeight;
      if (useServerChat())
        void refreshServerSessionsAndHistory();
    }
    if (tab === "settings" && state.auth.token && state.members.length === 0)
      void loadMembers();
    if (tab === "tasks" && state.selectedMemberId && state.auth.token)
      void loadJobs();
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
    updateTargetBanners();
  }
  function updateTargetBanners() {
    const m = memberById(state.selectedMemberId);
    if (state.offlineMode) {
      chatTarget.classList.remove("empty");
      chatTargetText.innerHTML = `\u{1F6DC} \u79BB\u7EBF\u6A21\u5F0F \xB7 \u6A21\u578B <span class="tb-name">${esc(state.localModel || "\u672A\u914D\u7F6E")}</span>`;
    } else if (m) {
      chatTarget.classList.remove("empty");
      chatTargetText.innerHTML = `\u5BF9\u8BDD\u76EE\u6807\uFF1A<span class="tb-name">${esc(m.name)}</span>\uFF08${ROLE_LABELS[roleOf(m)] || ""}\uFF09`;
    } else {
      chatTarget.classList.add("empty");
      chatTargetText.textContent = "\u672A\u9009\u62E9 AI \u6210\u5458\uFF08\u5C06\u4F7F\u7528\u672C\u5730 AI Key \u76F4\u8FDE\uFF09";
    }
    if (m && !state.offlineMode) {
      taskTarget.classList.remove("empty");
      taskTarget.innerHTML = `\u4EFB\u52A1\u76EE\u6807\uFF1A<span class="tb-name">${esc(m.name)}</span>`;
      taskForm.style.display = "block";
      taskJobsCard.style.display = "block";
    } else {
      taskTarget.classList.add("empty");
      taskTarget.textContent = state.offlineMode ? "\u79BB\u7EBF\u6A21\u5F0F\u4E0B\u4E0D\u53EF\u5B89\u6392\u4EFB\u52A1\uFF08\u4EFB\u52A1\u9700\u767B\u5F55\u670D\u52A1\u5668\uFF09" : state.auth.token ? "\u8BF7\u5148\u5728\u201C\u6210\u5458\u201D\u4E2D\u9009\u62E9\u4E00\u4E2A AI \u6210\u5458" : "\u8BF7\u5148\u767B\u5F55\u5E76\u9009\u62E9 AI \u6210\u5458";
      taskForm.style.display = "none";
      taskJobsCard.style.display = "none";
    }
    refreshChatAvailability();
  }
  function refreshChatAvailability() {
    const enabled = useServerChat() || state.hasAiKey;
    const hasMessages = chatMsgs.querySelectorAll(".chat-msg").length > 0;
    chatNoKey.style.display = enabled || hasMessages ? "none" : "flex";
    chatInput.disabled = !enabled || state.chatBusy;
    chatSendBtn.disabled = !enabled || state.chatBusy;
    if (useServerChat()) {
      chatClearBtn.disabled = state.chatBusy;
    } else {
      chatClearBtn.disabled = !hasMessages && !state.chatHistory.length && !state.chatBusy;
    }
    updateChatSessionControls();
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
    syncSelectedAiToBackground();
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
        case "chat:response": {
          if (msg.requestId !== state.activeChatRequestId)
            break;
          const thinking = window._chatThinking;
          if (!thinking) {
            state.activeChatRequestId = null;
            setChatBusy(false);
            break;
          }
          thinking?.remove();
          window._chatThinking = null;
          state.activeChatRequestId = null;
          setChatBusy(false);
          const reply = msg.text || "\u5B8C\u6210";
          state.chatHistory.push({ role: "assistant", content: reply });
          const el = appendChatMsg("ai", "", state.chatHistory.length - 1);
          setBubble(el, renderChatFrame(reply, { toolsUsed: msg.toolsUsed || [], events: msg.toolEvents || [] }));
          void syncChatHistory();
          if (msg.toolsUsed?.length) {
            addEntry({ id: Date.now().toString(), type: "task", status: "success", message: `AI \u4F7F\u7528\u5DE5\u5177: ${msg.toolsUsed.join(", ")}`, timestamp: Date.now() });
          }
          break;
        }
        case "chat:error": {
          if (msg.requestId !== state.activeChatRequestId)
            break;
          const thinking = window._chatThinking;
          if (!thinking) {
            state.activeChatRequestId = null;
            setChatBusy(false);
            break;
          }
          thinking?.remove();
          window._chatThinking = null;
          state.activeChatRequestId = null;
          setChatBusy(false);
          const errorText = `\u26A0 \u9519\u8BEF: ${msg.error}`;
          state.chatHistory.push({ role: "assistant", content: errorText });
          appendChatMsg("ai", errorText, state.chatHistory.length - 1);
          void syncChatHistory();
          break;
        }
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
    switchTab("chat");
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
    void restoreChatHistory();
    if (state.auth.token) {
      void (async () => {
        try {
          const me = await getMe(state.serverUrl, state.auth.token);
          state.auth.userName = me?.name || state.auth.userName;
          state.auth.avatar = me?.avatar || "";
          await saveAuth({ userName: state.auth.userName, avatar: state.auth.avatar });
          await refreshAvatarCache();
          updateUserChip();
          renderChatHistory();
          await loadMembers();
          syncSelectedAiToBackground(true);
          if (useServerChat())
            await refreshServerSessionsAndHistory();
        } catch (err) {
          if (isAuthError(err)) {
            await doLogout();
          } else {
            console.warn("getMe failed (transient), keeping session", err);
            loginFeedback.textContent = "\u6682\u65F6\u65E0\u6CD5\u8FDE\u63A5\u670D\u52A1\u5668\uFF0C\u7A0D\u540E\u5C06\u81EA\u52A8\u91CD\u8BD5";
            loginFeedback.style.color = "var(--warn)";
            try {
              await loadMembers();
              syncSelectedAiToBackground(true);
              if (useServerChat())
                await refreshServerSessionsAndHistory();
            } catch {
            }
          }
        }
      })();
    }
    updateChatSessionControls();
  }
  wireUi();
  wireMembers();
  wireChat();
  wireTasks();
  wireCards();
  wireSettings();
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
