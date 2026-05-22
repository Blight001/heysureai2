(() => {
  // src/content.ts
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    handleAction(msg).then(sendResponse).catch((err) => sendResponse({ error: err.message || String(err) }));
    return true;
  });
  async function handleAction(msg) {
    switch (msg.action) {
      case "click":
        return doClick(msg);
      case "type":
        return doType(msg);
      case "get_content":
        return getContent(msg);
      case "scroll":
        return doScroll(msg);
      case "wait":
        return doWait(msg);
      case "evaluate":
        return doEvaluate(msg);
      case "extract":
        return doExtract(msg);
      case "find_text":
        return findText(msg);
      case "fill_form":
        return fillForm(msg);
      case "select":
        return doSelect(msg);
      case "hover":
        return doHover(msg);
      case "storage_get":
        return storageGet(msg);
      default:
        throw new Error(`Unknown content action: ${msg.action}`);
    }
  }
  function findEl(selector, text) {
    if (selector)
      return document.querySelector(selector);
    if (text) {
      const xp = `.//*[normalize-space(.)='${text.replace(/'/g, "\\'")}'][not(.//*)]`;
      const r = document.evaluate(xp, document.body, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      if (r.singleNodeValue)
        return r.singleNodeValue;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      while (walker.nextNode()) {
        const el = walker.currentNode;
        if (!el.children.length && el.innerText?.trim() === text)
          return el;
      }
    }
    return null;
  }
  function doClick(msg) {
    const { selector, text, x, y } = msg;
    let el = null;
    if (x !== void 0 && y !== void 0) {
      el = document.elementFromPoint(Number(x), Number(y));
    } else {
      el = findEl(selector, text);
    }
    if (!el)
      throw new Error(`Element not found: selector=${selector || ""} text=${text || ""} coords=${x},${y}`);
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.click();
    return { success: true, tag: el.tagName, text: el.innerText?.slice(0, 100) };
  }
  function doType(msg) {
    const selector = msg.selector || "input:focus, textarea:focus, [contenteditable]:focus";
    const text = String(msg.text ?? "");
    const clearFirst = msg.clearFirst !== false;
    let el = selector ? document.querySelector(selector) : null;
    if (!el)
      el = document.activeElement;
    if (!el)
      throw new Error("No input element found \u2014 try providing a selector");
    el.focus();
    if (el.isContentEditable) {
      if (clearFirst)
        el.textContent = "";
      el.textContent += text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      if (clearFirst) {
        el.value = "";
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
      el.value += text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (msg.submit)
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    return { success: true, text, length: text.length };
  }
  function getContent(msg) {
    const root = msg.selector ? document.querySelector(msg.selector) : document.body;
    if (!root)
      throw new Error(`Element not found: ${msg.selector}`);
    const text = root.innerText?.slice(0, 5e4) || "";
    const result = {
      success: true,
      url: location.href,
      title: document.title,
      text,
      links: [...document.querySelectorAll("a[href]")].slice(0, 50).map((a) => ({ text: a.innerText?.trim().slice(0, 100), href: a.href })),
      meta: {
        description: document.querySelector('meta[name="description"]')?.getAttribute("content") || "",
        keywords: document.querySelector('meta[name="keywords"]')?.getAttribute("content") || ""
      }
    };
    if (msg.includeHtml)
      result.html = root.innerHTML?.slice(0, 1e5);
    return result;
  }
  function doScroll(msg) {
    const amount = Number(msg.amount || 400);
    switch (msg.direction) {
      case "up":
        window.scrollBy({ top: -amount, behavior: "smooth" });
        break;
      case "down":
        window.scrollBy({ top: amount, behavior: "smooth" });
        break;
      case "top":
        window.scrollTo({ top: 0, behavior: "smooth" });
        break;
      case "bottom":
        window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
        break;
      default:
        throw new Error(`Unknown scroll direction: ${msg.direction}`);
    }
    return { success: true, direction: msg.direction, amount };
  }
  async function doWait(msg) {
    if (msg.ms) {
      await new Promise((r) => setTimeout(r, Math.min(Number(msg.ms), 1e4)));
      return { success: true, waited_ms: msg.ms };
    }
    if (msg.selector) {
      const start = Date.now();
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Element "${msg.selector}" not found after 10s`)), 1e4);
        function check() {
          if (document.querySelector(msg.selector)) {
            clearTimeout(timeout);
            resolve();
          } else
            requestAnimationFrame(check);
        }
        check();
      });
      return { success: true, selector: msg.selector, waited_ms: Date.now() - start };
    }
    return { success: true, waited_ms: 0 };
  }
  function doEvaluate(msg) {
    const code = String(msg.code || "");
    if (!code)
      throw new Error("code is required");
    const result = (0, eval)(code);
    return { success: true, result: typeof result === "function" ? "[Function]" : result };
  }
  function doExtract(msg) {
    const { selector, attributes, limit = 50 } = msg;
    if (!selector)
      throw new Error("selector is required");
    const els = [...document.querySelectorAll(selector)].slice(0, limit);
    const items = els.map((el) => {
      const item = { text: el.innerText?.trim().slice(0, 500) };
      const attrs = attributes || ["href", "src", "id", "class", "value", "data-id", "name"];
      for (const attr of attrs) {
        const v = el.getAttribute(attr);
        if (v !== null)
          item[attr] = v;
      }
      return item;
    });
    return { success: true, selector, count: items.length, items };
  }
  function findText(msg) {
    const target = String(msg.text || "");
    if (!target)
      throw new Error("text is required");
    const exact = !!msg.exact;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    const found = [];
    while (walker.nextNode() && found.length < 20) {
      const el = walker.currentNode;
      const inner = el.innerText?.trim() || "";
      const match = exact ? inner === target : inner.includes(target);
      if (match && inner.length > 0 && inner.length < 500) {
        found.push({
          tag: el.tagName,
          text: inner.slice(0, 200),
          selector: el.id ? `#${el.id}` : el.className ? `.${el.className.trim().split(" ")[0]}` : el.tagName.toLowerCase()
        });
      }
    }
    return { success: true, query: target, count: found.length, elements: found };
  }
  function fillForm(msg) {
    const fields = msg.fields || [];
    const filled = [];
    const errors = [];
    for (const field of fields) {
      const el = document.querySelector(field.selector);
      if (!el) {
        errors.push(`Not found: ${field.selector}`);
        continue;
      }
      el.focus();
      el.value = field.value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      filled.push(field.selector);
    }
    if (msg.submitSelector) {
      const btn = document.querySelector(msg.submitSelector);
      if (btn)
        btn.click();
    }
    return { success: errors.length === 0, filled, errors };
  }
  function doSelect(msg) {
    const el = document.querySelector(msg.selector);
    if (!el || el.tagName !== "SELECT")
      throw new Error(`<select> not found: ${msg.selector}`);
    const value = String(msg.value);
    const opt = [...el.options].find((o) => o.value === value || o.text.trim() === value);
    if (!opt)
      throw new Error(`Option "${value}" not found in ${msg.selector}`);
    el.value = opt.value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { success: true, selector: msg.selector, selected: opt.text };
  }
  function storageGet(msg) {
    const store = msg.storageType === "session" ? sessionStorage : localStorage;
    const value = store.getItem(msg.key);
    return { success: true, key: msg.key, value, found: value !== null };
  }
  function doHover(msg) {
    const el = document.querySelector(msg.selector);
    if (!el)
      throw new Error(`Element not found: ${msg.selector}`);
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    return { success: true, selector: msg.selector };
  }
})();
