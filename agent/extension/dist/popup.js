(() => {
  // src/popup.ts
  var currentTheme = "dark";
  var activeTab = "feed";
  var currentStatus = "disconnected";
  var chatHistory = [];
  var chatBusy = false;
  var hasAiKey = false;
  var port;
  var STATUS_LABELS = {
    disconnected: "\u672A\u8FDE\u63A5",
    connecting: "\u8FDE\u63A5\u4E2D...",
    connected: "\u5DF2\u8FDE\u63A5",
    registered: "\u5DF2\u6CE8\u518C",
    error: "\u8FDE\u63A5\u9519\u8BEF"
  };
  var $ = (id) => document.getElementById(id);
  var statusDot = $("status-dot");
  var statusLabel = $("status-label");
  var themeToggle = $("theme-toggle");
  var tabFeed = $("tab-feed");
  var tabChat = $("tab-chat");
  var tabSettings = $("tab-settings");
  var feedPane = $("feed-pane");
  var chatPane = $("chat-pane");
  var settingsPane = $("settings-pane");
  var feed = $("feed");
  var feedEmpty = $("feed-empty");
  var chatMsgs = $("chat-messages");
  var chatNoKey = $("chat-no-key");
  var chatInput = $("chat-input");
  var chatSendBtn = $("chat-send");
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
  function switchTab(tab) {
    activeTab = tab;
    [feedPane, chatPane, settingsPane].forEach((p) => p.classList.add("hidden"));
    [tabFeed, tabChat, tabSettings].forEach((b) => b.classList.remove("active"));
    if (tab === "feed") {
      feedPane.classList.remove("hidden");
      tabFeed.classList.add("active");
    }
    if (tab === "chat") {
      chatPane.classList.remove("hidden");
      tabChat.classList.add("active");
      chatMsgs.scrollTop = chatMsgs.scrollHeight;
    }
    if (tab === "settings") {
      settingsPane.classList.remove("hidden");
      tabSettings.classList.add("active");
    }
  }
  tabFeed.addEventListener("click", () => switchTab("feed"));
  tabChat.addEventListener("click", () => switchTab("chat"));
  tabSettings.addEventListener("click", () => switchTab("settings"));
  function setStatus(status) {
    currentStatus = status;
    const label = STATUS_LABELS[status] || status;
    statusDot.className = `status-dot ${status}`;
    statusLabel.textContent = label;
  }
  function applyTheme(theme, persist = true) {
    currentTheme = theme;
    document.body.className = theme;
    themeToggle.textContent = theme === "dark" ? "\u2600\uFE0F" : "\u{1F319}";
    if (persist)
      port.postMessage({ type: "settings:save", payload: { theme } });
  }
  themeToggle.addEventListener("click", () => applyTheme(currentTheme === "dark" ? "light" : "dark"));
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function fmt(ts) {
    return new Date(ts).toTimeString().slice(0, 8);
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
  clearBtn.addEventListener("click", () => {
    feed.querySelectorAll(".entry").forEach((e) => e.remove());
    feedEmpty.style.display = "flex";
  });
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
  function setChatBusy(busy) {
    chatBusy = busy;
    chatSendBtn.disabled = busy || !hasAiKey;
    chatInput.disabled = busy;
  }
  async function sendChat() {
    if (chatBusy || !hasAiKey)
      return;
    const text = chatInput.value.trim();
    if (!text)
      return;
    chatInput.value = "";
    chatInput.style.height = "auto";
    chatHistory.push({ role: "user", content: text });
    appendChatMsg("user", text);
    const thinking = showThinking();
    setChatBusy(true);
    port.postMessage({ type: "chat:send", messages: chatHistory });
    window._chatThinking = thinking;
  }
  chatSendBtn.addEventListener("click", sendChat);
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  });
  chatInput.addEventListener("input", () => {
    chatInput.style.height = "auto";
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
  });
  function loadSettings(s) {
    cfgServer.value = s.serverUrl || "";
    cfgToken.value = s.agentToken || "";
    cfgName.value = s.agentName || "";
    cfgId.value = s.agentId || "";
    cfgGroup.value = s.agentGroup || "";
    cfgAiKey.value = s.aiKey || "";
    cfgAiBase.value = s.aiBaseUrl || "";
    cfgAiModel.value = s.aiModel || "";
    cfgAutoConn.checked = !!s.autoConnect;
    hasAiKey = !!s.aiKey?.trim();
    if (!hasAiKey) {
      chatNoKey.style.display = "flex";
      chatInput.disabled = true;
      chatSendBtn.disabled = true;
    } else {
      chatNoKey.style.display = "none";
      chatInput.disabled = false;
      chatSendBtn.disabled = false;
    }
    applyTheme(s.theme || "dark", false);
  }
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
      autoConnect: cfgAutoConn.checked
    };
    port.postMessage({ type: "settings:save", payload });
    hasAiKey = !!payload.aiKey;
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
  chrome.storage.session.get("_pendingChat").then((r) => {
    if (r._pendingChat) {
      chrome.storage.session.remove("_pendingChat");
      switchTab("chat");
      chatInput.value = String(r._pendingChat);
    }
  }).catch(() => {
  });
  initPort();
})();
