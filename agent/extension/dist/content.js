(() => {
  // src/content/fx.ts
  var FX = "__hs_mouse_fx__";
  var fxEnabled = true;
  var fxCursor = null;
  var fxX = 0;
  var fxY = 0;
  var fxHideTimer = null;
  var fxSleep = (ms) => new Promise((r) => setTimeout(r, ms));
  var isFxEnabled = () => fxEnabled;
  try {
    chrome.storage?.local?.get("mouseFx").then((r) => {
      if (r && typeof r.mouseFx === "boolean")
        fxEnabled = r.mouseFx;
    }).catch(() => {
    });
    chrome.storage?.onChanged?.addListener((changes, area) => {
      if (area === "local" && changes.mouseFx)
        fxEnabled = changes.mouseFx.newValue !== false;
    });
  } catch {
  }
  function fxEnsure() {
    if (!fxEnabled || !document.body)
      return null;
    if (fxCursor && document.documentElement.contains(fxCursor))
      return fxCursor;
    if (!document.getElementById(FX + "_style")) {
      const style = document.createElement("style");
      style.id = FX + "_style";
      style.textContent = `
      .${FX}-cur{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;opacity:0;
        transition:transform .3s cubic-bezier(.22,1,.36,1),opacity .2s ease;will-change:transform;}
      .${FX}-cur.show{opacity:1;}
      .${FX}-cur-in{display:block;transform:scale(1);transition:transform .13s ease;
        filter:drop-shadow(0 2px 3px rgba(0,0,0,.45));}
      .${FX}-cur.press .${FX}-cur-in{transform:scale(.72);}
      .${FX}-cur.grab .${FX}-cur-in{transform:scale(.88) rotate(-12deg);}
      .${FX}-cur.noanim{transition:none;}
      .${FX}-ring,.${FX}-dot,.${FX}-trail{position:fixed;left:0;top:0;z-index:2147483646;pointer-events:none;}
      .${FX}-ring{width:16px;height:16px;border-radius:50%;border:2px solid rgba(99,102,241,.9);
        transform:translate(-50%,-50%) scale(.4);opacity:.9;animation:${FX}-ring .62s ease-out forwards;}
      @keyframes ${FX}-ring{to{transform:translate(-50%,-50%) scale(3.4);opacity:0;}}
      .${FX}-dot{width:10px;height:10px;border-radius:50%;background:rgba(99,102,241,.55);
        transform:translate(-50%,-50%) scale(1);opacity:.85;animation:${FX}-dot .46s ease-out forwards;}
      @keyframes ${FX}-dot{to{transform:translate(-50%,-50%) scale(2.6);opacity:0;}}
      .${FX}-trail{width:4px;border-radius:4px;transform:translateX(-50%);opacity:0;
        background:linear-gradient(rgba(99,102,241,0),rgba(99,102,241,.55),rgba(99,102,241,0));
        animation:${FX}-trail .5s ease-out forwards;}
      .${FX}-line{height:3px;border-radius:3px;transform-origin:0 50%;opacity:0;
        background:linear-gradient(90deg,rgba(99,102,241,.15),rgba(99,102,241,.7));
        animation:${FX}-trail .7s ease-out forwards;}
      @keyframes ${FX}-trail{0%{opacity:.7;}100%{opacity:0;}}`;
      document.documentElement.appendChild(style);
    }
    const cur = document.createElement("div");
    cur.className = `${FX}-cur noanim`;
    cur.innerHTML = `<span class="${FX}-cur-in"><svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M4 2.2 L4 19.6 L8.7 15.2 L11.8 21.9 L14.4 20.7 L11.3 14.1 L17.8 13.9 Z" fill="#fff" stroke="#111827" stroke-width="1.2" stroke-linejoin="round"/></svg></span>`;
    document.body.appendChild(cur);
    fxCursor = cur;
    if (!fxX && !fxY) {
      fxX = window.innerWidth / 2;
      fxY = window.innerHeight / 2;
    }
    fxPlace(fxX, fxY, false);
    return cur;
  }
  function fxPlace(x, y, animate) {
    const cur = fxCursor;
    if (!cur)
      return;
    fxX = x;
    fxY = y;
    cur.classList.toggle("noanim", !animate);
    cur.style.transform = `translate(${x - 3}px, ${y - 2}px)`;
  }
  function fxScheduleHide() {
    if (fxHideTimer)
      clearTimeout(fxHideTimer);
    fxHideTimer = setTimeout(() => fxCursor?.classList.remove("show"), 1600);
  }
  function fxSpawn(cls, x, y, life = 700, extra) {
    if (!document.body)
      return;
    const el = document.createElement("div");
    el.className = `${FX}-${cls}`;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    extra?.(el);
    document.body.appendChild(el);
    setTimeout(() => el.remove(), life);
  }
  async function fxMoveTo(x, y) {
    const cur = fxEnsure();
    if (!cur)
      return;
    cur.classList.add("show");
    void cur.offsetWidth;
    fxPlace(x, y, true);
    await fxSleep(300);
  }
  function fxClickAt(x, y, variant = "left") {
    const cur = fxEnsure();
    if (!cur)
      return;
    cur.classList.add("press");
    const ringColor = variant === "right" ? "rgba(245,158,11,.95)" : "rgba(99,102,241,.9)";
    const dotColor = variant === "right" ? "rgba(245,158,11,.55)" : "rgba(99,102,241,.55)";
    fxSpawn("ring", x, y, 640, (el) => {
      el.style.borderColor = ringColor;
    });
    fxSpawn("dot", x, y, 480, (el) => {
      el.style.background = dotColor;
    });
    if (variant === "double")
      setTimeout(() => fxSpawn("ring", x, y, 640), 150);
    setTimeout(() => cur.classList.remove("press"), 160);
    fxScheduleHide();
  }
  async function fxDragPath(sx, sy, ex, ey) {
    const cur = fxEnsure();
    if (!cur)
      return;
    cur.classList.add("show");
    fxPlace(sx, sy, false);
    void cur.offsetWidth;
    cur.classList.add("grab", "press");
    const dx = ex - sx, dy = ey - sy;
    const dist = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx) * 180 / Math.PI;
    fxSpawn("line", sx, sy, 720, (el) => {
      el.style.width = `${dist}px`;
      el.style.transform = `rotate(${ang}deg)`;
    });
    fxSpawn("ring", sx, sy, 600);
    await fxMoveTo(ex, ey);
    fxSpawn("ring", ex, ey, 600);
    setTimeout(() => cur.classList.remove("grab", "press"), 200);
    fxScheduleHide();
  }
  async function fxToElement(el) {
    if (!fxEnabled)
      return;
    const r = el.getBoundingClientRect();
    const x = Math.min(Math.max(r.left + r.width / 2, 4), window.innerWidth - 4);
    const y = Math.min(Math.max(r.top + r.height / 2, 4), window.innerHeight - 4);
    await fxMoveTo(x, y);
  }
  function fxScrollDrag(direction, amount) {
    const cur = fxEnsure();
    if (!cur)
      return;
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const len = Math.min(Math.max(amount || 0, 80), 220);
    let startY = cy, endY = cy;
    if (direction === "down") {
      startY = cy + len / 2;
      endY = cy - len / 2;
    } else if (direction === "up") {
      startY = cy - len / 2;
      endY = cy + len / 2;
    } else if (direction === "bottom") {
      startY = cy + 110;
      endY = cy - 110;
    } else if (direction === "top") {
      startY = cy - 110;
      endY = cy + 110;
    }
    cur.classList.add("show");
    fxPlace(cx, startY, false);
    void cur.offsetWidth;
    cur.classList.add("grab", "press");
    fxSpawn("trail", cx, Math.min(startY, endY), 540, (el) => {
      el.style.height = `${Math.abs(endY - startY)}px`;
    });
    fxPlace(cx, endY, true);
    setTimeout(() => cur.classList.remove("grab", "press"), 320);
    fxScheduleHide();
  }
  var getFxPos = () => ({ x: fxX, y: fxY });

  // src/content/dom.ts
  function isVisible(el) {
    if (!el || !(el instanceof HTMLElement))
      return false;
    if (el.id?.startsWith(FX))
      return false;
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0)
      return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom >= 0 && r.right >= 0 && r.top <= window.innerHeight && r.left <= window.innerWidth;
  }
  function textOf(el, max = 200) {
    const h = el;
    const parts = [
      h.innerText,
      h.getAttribute("aria-label"),
      h.getAttribute("title"),
      h.value,
      h.textContent
    ];
    return parts.map((v) => String(v || "").replace(/\s+/g, " ").trim()).find(Boolean)?.slice(0, max) || "";
  }
  function cssPath(el) {
    if (el.id)
      return `#${CSS.escape(el.id)}`;
    const parts = [];
    let cur = el;
    while (cur && cur !== document.body && parts.length < 5) {
      const tag = cur.tagName.toLowerCase();
      const cls = String(cur.className || "").split(/\s+/).filter(Boolean).slice(0, 2).map((c) => `.${CSS.escape(c)}`).join("");
      const parent = cur.parentElement;
      const same = parent ? Array.from(parent.children).filter((c) => c.tagName === cur.tagName) : [];
      const nth = same.length > 1 && parent ? `:nth-of-type(${same.indexOf(cur) + 1})` : "";
      parts.unshift(`${tag}${cls}${nth}`);
      cur = parent;
    }
    return parts.length ? parts.join(" > ") : el.tagName.toLowerCase();
  }
  function zIndexOf(el) {
    const z = Number.parseInt(getComputedStyle(el).zIndex || "0", 10);
    return Number.isFinite(z) ? z : 0;
  }
  function elementArea(el) {
    const r = el.getBoundingClientRect();
    return Math.max(0, r.width) * Math.max(0, r.height);
  }
  function clickableAncestor(el) {
    return el.closest('button,a,[role="button"],input[type="button"],input[type="submit"],[onclick],[tabindex]') || el;
  }
  function textMatches(el, text, exact = false) {
    const target = String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!target)
      return false;
    const haystack = [
      el.innerText,
      el.textContent,
      el.getAttribute("aria-label"),
      el.getAttribute("title"),
      el.value,
      el.getAttribute("placeholder")
    ].map((v) => String(v || "").replace(/\s+/g, " ").trim().toLowerCase()).filter(Boolean);
    return haystack.some((v) => exact ? v === target : v === target || v.includes(target));
  }
  function findEl(selector, text) {
    if (selector) {
      const bySelector = document.querySelector(selector);
      if (bySelector && isVisible(bySelector))
        return bySelector;
      return bySelector;
    }
    if (text) {
      const preferred = Array.from(document.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"],[aria-label],[title]'));
      const exact = preferred.find((el) => isVisible(el) && textMatches(el, text, true));
      if (exact)
        return exact;
      const partial = preferred.find((el) => isVisible(el) && textMatches(el, text, false));
      if (partial)
        return partial;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      while (walker.nextNode()) {
        const el = walker.currentNode;
        if (isVisible(el) && textMatches(el, text, true))
          return clickableAncestor(el);
      }
      const walker2 = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      while (walker2.nextNode()) {
        const el = walker2.currentNode;
        if (isVisible(el) && textMatches(el, text, false))
          return clickableAncestor(el);
      }
    }
    return null;
  }
  function elCenter(el) {
    const r = el.getBoundingClientRect();
    return {
      x: Math.min(Math.max(r.left + r.width / 2, 1), window.innerWidth - 1),
      y: Math.min(Math.max(r.top + r.height / 2, 1), window.innerHeight - 1)
    };
  }
  function clickLikeUser(el) {
    const c = elCenter(el);
    const opts = { bubbles: true, cancelable: true, view: window, clientX: c.x, clientY: c.y };
    el.dispatchEvent(new PointerEvent("pointerdown", opts));
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new PointerEvent("pointerup", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.dispatchEvent(new MouseEvent("click", opts));
    el.click?.();
  }
  function resolveTarget(msg) {
    if (msg.x !== void 0 && msg.y !== void 0) {
      const el2 = document.elementFromPoint(Number(msg.x), Number(msg.y));
      return { el: el2, x: Number(msg.x), y: Number(msg.y) };
    }
    const el = findEl(msg.selector, msg.text);
    if (!el)
      return { el: null, x: 0, y: 0 };
    const c = elCenter(el);
    return { el, x: c.x, y: c.y };
  }

  // src/content/viewport.ts
  function viewportContext() {
    const doc = document.documentElement;
    const scrollY = Math.round(window.scrollY);
    const scrollX = Math.round(window.scrollX);
    const innerH = window.innerHeight;
    const innerW = window.innerWidth;
    const scrollHeight = Math.max(doc.scrollHeight, document.body ? document.body.scrollHeight : 0);
    const maxScroll = Math.max(0, scrollHeight - innerH);
    const scrollPercent = maxScroll > 0 ? Math.round(scrollY / maxScroll * 100) : 100;
    const atTop = scrollY <= 2;
    const atBottom = scrollY >= maxScroll - 2;
    const heads = Array.from(document.querySelectorAll("h1,h2,h3,h4"));
    const visibleHeadings = [];
    let currentSection = "";
    for (const h of heads) {
      const r = h.getBoundingClientRect();
      const txt = (h.innerText || "").trim().slice(0, 120);
      if (!txt)
        continue;
      if (r.top <= 90)
        currentSection = txt;
      if (r.bottom > 0 && r.top < innerH && visibleHeadings.length < 10) {
        visibleHeadings.push({ tag: h.tagName, text: txt, top: Math.round(r.top) });
      }
    }
    return {
      url: location.href,
      title: document.title,
      scrollX,
      scrollY,
      innerWidth: innerW,
      innerHeight: innerH,
      scrollHeight,
      maxScroll,
      scrollPercent,
      atTop,
      atBottom,
      currentSection,
      visibleHeadings,
      counts: {
        links: document.querySelectorAll("a[href]").length,
        buttons: document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]').length,
        inputs: document.querySelectorAll("input, textarea, select").length
      }
    };
  }
  async function waitScrollSettle(timeout = 900) {
    const start = Date.now();
    let last = window.scrollY;
    let stable = 0;
    while (Date.now() - start < timeout) {
      await fxSleep(80);
      if (Math.abs(window.scrollY - last) < 1) {
        if (++stable >= 2)
          break;
      } else
        stable = 0;
      last = window.scrollY;
    }
  }
  function doPageInfo() {
    return { success: true, ...viewportContext() };
  }

  // src/content/actions.ts
  async function doClick(msg) {
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
    if (isFxEnabled()) {
      await fxSleep(220);
      await fxToElement(el);
      const r = el.getBoundingClientRect();
      fxClickAt(r.left + r.width / 2, r.top + r.height / 2);
      await fxSleep(120);
    }
    ;
    el.click();
    const ctx = viewportContext();
    return {
      success: true,
      tag: el.tagName,
      text: el.innerText?.slice(0, 100),
      position: { scrollY: ctx.scrollY, scrollPercent: ctx.scrollPercent, currentSection: ctx.currentSection }
    };
  }
  async function doDoubleClick(msg) {
    const { el } = resolveTarget(msg);
    if (!el)
      throw new Error(`Element not found: selector=${msg.selector || ""} text=${msg.text || ""} coords=${msg.x},${msg.y}`);
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    if (isFxEnabled()) {
      await fxSleep(220);
      await fxToElement(el);
      const c2 = elCenter(el);
      fxClickAt(c2.x, c2.y, "double");
      await fxSleep(120);
    }
    const c = elCenter(el);
    const opts = { bubbles: true, cancelable: true, view: window, clientX: c.x, clientY: c.y };
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.dispatchEvent(new MouseEvent("click", { ...opts, detail: 1 }));
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.dispatchEvent(new MouseEvent("click", { ...opts, detail: 2 }));
    el.dispatchEvent(new MouseEvent("dblclick", { ...opts, detail: 2 }));
    return { success: true, tag: el.tagName, text: el.innerText?.slice(0, 100) };
  }
  async function doRightClick(msg) {
    const { el } = resolveTarget(msg);
    if (!el)
      throw new Error(`Element not found: selector=${msg.selector || ""} text=${msg.text || ""} coords=${msg.x},${msg.y}`);
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    if (isFxEnabled()) {
      await fxSleep(220);
      await fxToElement(el);
      const c2 = elCenter(el);
      fxClickAt(c2.x, c2.y, "right");
      await fxSleep(120);
    }
    const c = elCenter(el);
    const opts = { bubbles: true, cancelable: true, view: window, button: 2, buttons: 2, clientX: c.x, clientY: c.y };
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.dispatchEvent(new MouseEvent("contextmenu", opts));
    return { success: true, tag: el.tagName, text: el.innerText?.slice(0, 100) };
  }
  function dragDiagnostics(src, dst, msg) {
    const describe = (el) => {
      if (!el)
        return null;
      const html = el;
      const r = html.getBoundingClientRect();
      const style = getComputedStyle(html);
      return {
        selector: cssPath(el),
        tag: el.tagName,
        text: textOf(el, 120),
        draggable: html.draggable || html.getAttribute("draggable") === "true",
        role: html.getAttribute("role") || "",
        visible: isVisible(el),
        cursor: style.cursor,
        rect: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
      };
    };
    return {
      source: describe(src),
      target: describe(dst),
      requested: {
        selector: msg.selector,
        text: msg.text,
        x: msg.x,
        y: msg.y,
        toSelector: msg.toSelector,
        toText: msg.toText,
        toX: msg.toX,
        toY: msg.toY
      }
    };
  }
  async function doDrag(msg) {
    const src = resolveTarget({ selector: msg.selector, text: msg.text, x: msg.x, y: msg.y });
    const dst = resolveTarget({ selector: msg.toSelector, text: msg.toText, x: msg.toX, y: msg.toY });
    if (!src.el && msg.x === void 0) {
      const diag = dragDiagnostics(src.el, dst.el, msg);
      throw new Error(`Drag source not found. diagnostics=${JSON.stringify(diag)}`);
    }
    if (!dst.el && msg.toX === void 0) {
      const diag = dragDiagnostics(src.el, dst.el, msg);
      throw new Error(`Drag target not found. diagnostics=${JSON.stringify(diag)}`);
    }
    if (src.el)
      src.el.scrollIntoView({ block: "center", behavior: "smooth" });
    if (isFxEnabled())
      await fxSleep(200);
    const s = src.el ? elCenter(src.el) : { x: src.x, y: src.y };
    const d = dst.el ? elCenter(dst.el) : { x: dst.x, y: dst.y };
    const before = src.el ? src.el.getBoundingClientRect() : null;
    if (isFxEnabled())
      await fxDragPath(s.x, s.y, d.x, d.y);
    const dt = (() => {
      try {
        return new DataTransfer();
      } catch {
        return null;
      }
    })();
    const mk = (type, x, y, target) => {
      if (!target)
        return;
      const init = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };
      if (dt)
        init.dataTransfer = dt;
      const ev = type.startsWith("drag") || type === "drop" ? new DragEvent(type, init) : new MouseEvent(type, init);
      target.dispatchEvent(ev);
    };
    mk("pointerdown", s.x, s.y, src.el);
    mk("mousedown", s.x, s.y, src.el);
    mk("dragstart", s.x, s.y, src.el);
    mk("drag", s.x, s.y, src.el);
    mk("mousemove", d.x, d.y, dst.el || src.el);
    mk("dragenter", d.x, d.y, dst.el);
    mk("dragover", d.x, d.y, dst.el);
    mk("drop", d.x, d.y, dst.el);
    mk("dragend", d.x, d.y, src.el);
    mk("pointerup", d.x, d.y, dst.el || src.el);
    mk("mouseup", d.x, d.y, dst.el || src.el);
    await fxSleep(80);
    const after = src.el ? src.el.getBoundingClientRect() : null;
    const moved = before && after ? Math.abs(before.left - after.left) > 1 || Math.abs(before.top - after.top) > 1 : false;
    return {
      success: true,
      moved,
      warning: moved ? "" : "Drag events were dispatched, but the source element did not visibly move. The page may require native browser/OS drag support or a framework-specific gesture.",
      from: { x: Math.round(s.x), y: Math.round(s.y) },
      to: { x: Math.round(d.x), y: Math.round(d.y) },
      diagnostics: dragDiagnostics(src.el, dst.el, msg)
    };
  }
  function doPressKey(msg) {
    const key = String(msg.key || "");
    if (!key)
      throw new Error("key is required");
    let el = msg.selector ? document.querySelector(msg.selector) : null;
    if (!el)
      el = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body;
    el.focus?.();
    const init = {
      key,
      code: /^[a-zA-Z]$/.test(key) ? `Key${key.toUpperCase()}` : key,
      bubbles: true,
      cancelable: true,
      ctrlKey: !!msg.ctrl,
      shiftKey: !!msg.shift,
      altKey: !!msg.alt,
      metaKey: !!msg.meta
    };
    el.dispatchEvent(new KeyboardEvent("keydown", init));
    el.dispatchEvent(new KeyboardEvent("keypress", init));
    el.dispatchEvent(new KeyboardEvent("keyup", init));
    return { success: true, key, target: el.tagName };
  }
  async function doType(msg) {
    const selector = msg.selector || "input:focus, textarea:focus, [contenteditable]:focus";
    const text = String(msg.text ?? "");
    const clearFirst = msg.clearFirst !== false;
    let el = selector ? document.querySelector(selector) : null;
    if (!el)
      el = document.activeElement;
    if (!el)
      throw new Error("No input element found \u2014 try providing a selector");
    if (isFxEnabled()) {
      await fxToElement(el);
      const p = getFxPos();
      fxClickAt(p.x, p.y);
    }
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
    const root = msg.selector ? document.querySelector(String(msg.selector)) : document.body;
    if (!root)
      throw new Error(`Element not found: ${msg.selector}`);
    const text = root.innerText?.slice(0, 5e4) || "";
    const links = Array.from(root.querySelectorAll("a[href]")).slice(0, 50).map((a) => ({
      tag: "A",
      selector: cssPath(a),
      text: textOf(a, 100),
      href: a.href,
      attributes: { href: a.href }
    }));
    const result = {
      success: true,
      source: "browser_get_content",
      selector: msg.selector || "body",
      url: location.href,
      title: document.title,
      text,
      content: { text, html: msg.includeHtml ? root.innerHTML?.slice(0, 1e5) : void 0 },
      links,
      items: links,
      meta: {
        description: document.querySelector('meta[name="description"]')?.getAttribute("content") || "",
        keywords: document.querySelector('meta[name="keywords"]')?.getAttribute("content") || ""
      }
    };
    if (msg.includeHtml)
      result.html = root.innerHTML?.slice(0, 1e5);
    return result;
  }
  function canScroll(el, direction) {
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 2)
      return false;
    if (direction === "up")
      return el.scrollTop > 2;
    if (direction === "down")
      return el.scrollTop < max - 2;
    return true;
  }
  function scrollableElement(direction) {
    const candidates = Array.from(document.querySelectorAll("*")).filter((el) => {
      const style = getComputedStyle(el);
      const overflowY = style.overflowY;
      if (!/(auto|scroll|overlay)/.test(overflowY))
        return false;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0)
        return false;
      if (rect.bottom <= 0 || rect.top >= window.innerHeight)
        return false;
      return canScroll(el, direction);
    }).sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return br.width * br.height - ar.width * ar.height;
    });
    return candidates[0] || null;
  }
  function elementLabel(el) {
    if (!el)
      return "window";
    const html = el;
    if (html.id)
      return `#${html.id}`;
    const cls = typeof html.className === "string" ? html.className.trim().split(/\s+/)[0] : "";
    return cls ? `${html.tagName.toLowerCase()}.${cls}` : html.tagName.toLowerCase();
  }
  async function doScroll(msg) {
    const amount = Number(msg.amount || 400);
    const beforeY = Math.round(window.scrollY);
    let target = null;
    let beforeElementY = 0;
    if (msg.selector) {
      const el = document.querySelector(msg.selector);
      if (!el)
        throw new Error(`Element not found: ${msg.selector}`);
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    } else {
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
    }
    fxScrollDrag(msg.direction, amount);
    await waitScrollSettle();
    let ctx = viewportContext();
    let pageScrolledBy = ctx.scrollY - beforeY;
    let elementScrolledBy = 0;
    if (!msg.selector && pageScrolledBy === 0 && !ctx.atTop && !ctx.atBottom) {
      const delta = msg.direction === "up" ? -amount : amount;
      target = scrollableElement(msg.direction);
      if (target) {
        beforeElementY = target.scrollTop;
        target.scrollBy({ top: delta, behavior: "auto" });
        elementScrolledBy = Math.round(target.scrollTop - beforeElementY);
        await waitScrollSettle(250);
        ctx = viewportContext();
        pageScrolledBy = ctx.scrollY - beforeY;
      }
    }
    const scrolledBy = pageScrolledBy || elementScrolledBy;
    return {
      success: true,
      direction: msg.direction,
      requestedAmount: amount,
      scrolledBy,
      // actual pixels moved (0 = nothing happened)
      pageScrolledBy,
      elementScrolledBy,
      scrollTarget: msg.selector ? msg.selector : elementLabel(target),
      reachedEdge: ctx.atTop ? "top" : ctx.atBottom ? "bottom" : null,
      ...ctx
    };
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
    const els = Array.from(document.querySelectorAll(selector)).slice(0, limit);
    const items = els.map((el) => {
      const collected = {};
      const attrs = attributes || ["href", "src", "id", "class", "value", "data-id", "name"];
      for (const attr of attrs) {
        const v = el.getAttribute(attr);
        if (v !== null)
          collected[attr] = v;
      }
      const item = {
        tag: el.tagName,
        selector: cssPath(el),
        text: textOf(el, 500),
        attributes: collected
      };
      for (const [k, v] of Object.entries(collected))
        item[k] = v;
      return item;
    });
    return {
      success: true,
      source: "browser_extract",
      url: location.href,
      title: document.title,
      selector,
      count: items.length,
      items
    };
  }
  function attrMap(el, names) {
    const out = {};
    for (const name of names) {
      const v = el.getAttribute(name);
      if (v !== null)
        out[name] = v;
    }
    return out;
  }
  function snapshotNode(el, depth, maxDepth, state) {
    state.count++;
    const html = el;
    const children = depth >= maxDepth || state.count >= state.maxNodes ? [] : Array.from(el.children).filter((child) => isVisible(child) || ["SCRIPT", "STYLE", "META", "LINK"].includes(child.tagName) === false).slice(0, Math.max(0, state.maxNodes - state.count)).map((child) => snapshotNode(child, depth + 1, maxDepth, state)).filter(Boolean);
    return {
      tag: el.tagName.toLowerCase(),
      selector: cssPath(el),
      text: textOf(el, 160),
      visible: isVisible(el),
      role: html.getAttribute("role") || "",
      attrs: attrMap(el, ["id", "class", "name", "type", "href", "src", "alt", "title", "aria-label", "placeholder"]),
      children
    };
  }
  function domSnapshot(msg) {
    const root = msg.selector ? document.querySelector(String(msg.selector)) : document.body;
    if (!root)
      throw new Error(`Element not found: ${msg.selector}`);
    const maxDepth = Math.min(Math.max(Number(msg.max_depth ?? 4), 0), 8);
    const maxNodes = Math.min(Math.max(Number(msg.max_nodes ?? 120), 1), 1e3);
    const state = { count: 0, maxNodes };
    const tree = snapshotNode(root, 0, maxDepth, state);
    return {
      success: true,
      source: "browser_dom_snapshot",
      url: location.href,
      title: document.title,
      selector: msg.selector || "body",
      maxDepth,
      maxNodes,
      truncated: state.count >= maxNodes,
      tree
    };
  }
  function iframeList() {
    const frames = Array.from(document.querySelectorAll("iframe,frame")).map((frame) => {
      const el = frame;
      const r = el.getBoundingClientRect();
      let accessible = false;
      let title = "";
      try {
        accessible = !!el.contentDocument;
        title = el.contentDocument?.title || "";
      } catch {
        accessible = false;
      }
      return {
        selector: cssPath(el),
        src: el.src || el.getAttribute("src") || "",
        name: el.name || el.getAttribute("name") || "",
        title,
        accessible,
        visible: isVisible(el),
        rect: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
      };
    });
    return { success: true, url: location.href, count: frames.length, frames };
  }
  function performanceInfo() {
    const nav = performance.getEntriesByType("navigation")[0];
    const resources = performance.getEntriesByType("resource");
    const byType = {};
    for (const r of resources)
      byType[r.initiatorType || "other"] = (byType[r.initiatorType || "other"] || 0) + 1;
    return {
      success: true,
      url: location.href,
      title: document.title,
      navigation: nav ? {
        type: nav.type,
        domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
        loadMs: Math.round(nav.loadEventEnd - nav.startTime),
        transferSize: nav.transferSize,
        encodedBodySize: nav.encodedBodySize,
        decodedBodySize: nav.decodedBodySize
      } : null,
      resources: {
        count: resources.length,
        byType,
        slowest: resources.slice().sort((a, b) => b.duration - a.duration).slice(0, 20).map((r) => ({
          name: r.name,
          type: r.initiatorType,
          durationMs: Math.round(r.duration),
          transferSize: r.transferSize,
          encodedBodySize: r.encodedBodySize
        }))
      }
    };
  }
  function fileUpload(msg) {
    const input = document.querySelector(String(msg.selector || 'input[type="file"]'));
    if (!input || input.type !== "file")
      throw new Error(`File input not found: ${msg.selector || 'input[type="file"]'}`);
    const files = Array.isArray(msg.files) ? msg.files : [];
    if (!files.length)
      throw new Error("files is required. Use [{name, content, type?, encoding?}]. Local filesystem paths cannot be read by a content script.");
    const dt = new DataTransfer();
    for (const f of files) {
      const name = String(f.name || "upload.txt");
      const type = String(f.type || "application/octet-stream");
      const raw = String(f.content || "");
      const data = f.encoding === "base64" ? Uint8Array.from(atob(raw), (c) => c.charCodeAt(0)) : raw;
      dt.items.add(new File([data], name, { type }));
    }
    input.files = dt.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return { success: true, selector: cssPath(input), count: input.files?.length || 0, files: Array.from(input.files || []).map((f) => ({ name: f.name, size: f.size, type: f.type })) };
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
  function cssEscape(value) {
    const esc = window.CSS?.escape;
    return esc ? esc(value) : value.replace(/["\\]/g, "\\$&");
  }
  function normalizeFields(raw) {
    if (Array.isArray(raw))
      return raw;
    if (raw && typeof raw === "object") {
      return Object.entries(raw).map(([key, value]) => /^[.#[]|^[a-z]+[.#[:\s>+~]/i.test(key) ? { selector: key, value } : { name: key, value });
    }
    return [];
  }
  function fieldByLabel(text) {
    const target = text.trim().toLowerCase();
    const labels = Array.from(document.querySelectorAll("label"));
    for (const label of labels) {
      const labelText = (label.innerText || label.textContent || "").trim().toLowerCase();
      if (!labelText || !labelText.includes(target))
        continue;
      if (label.htmlFor) {
        const byFor = document.getElementById(label.htmlFor);
        if (byFor)
          return byFor;
      }
      const nested = label.querySelector('input, textarea, select, [contenteditable="true"]');
      if (nested)
        return nested;
    }
    return null;
  }
  function resolveField(field) {
    if (field.selector) {
      const bySelector = document.querySelector(field.selector);
      if (bySelector)
        return bySelector;
    }
    if (field.name) {
      const name = cssEscape(String(field.name));
      const byName = document.querySelector(`[name="${name}"], #${name}`);
      if (byName)
        return byName;
    }
    if (field.placeholder) {
      const target = String(field.placeholder).toLowerCase();
      const byPlaceholder = Array.from(document.querySelectorAll("input[placeholder], textarea[placeholder]")).find((el) => (el.placeholder || "").toLowerCase().includes(target));
      if (byPlaceholder)
        return byPlaceholder;
    }
    if (field.label || field.text)
      return fieldByLabel(String(field.label || field.text));
    return null;
  }
  function setNativeValue(el, field) {
    const value = field.value;
    const action = field.action || "set";
    el.focus?.();
    if (action === "click") {
      el.click();
      return;
    }
    if (el instanceof HTMLSelectElement) {
      const wanted = String(value ?? "");
      const opt = Array.from(el.options).find((o) => o.value === wanted || o.text.trim() === wanted);
      if (!opt)
        throw new Error(`Option not found: ${wanted}`);
      el.value = opt.value;
    } else if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
      if (action === "uncheck")
        el.checked = false;
      else if (action === "check")
        el.checked = true;
      else
        el.checked = Boolean(value);
    } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.value = String(value ?? "");
    } else if (el.isContentEditable) {
      el.textContent = String(value ?? "");
    } else {
      throw new Error(`Unsupported form element: ${el.tagName}`);
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function fillForm(msg) {
    const fields = normalizeFields(msg.fields);
    const filled = [];
    const errors = [];
    if (!fields.length) {
      return {
        success: false,
        filled,
        errors: ['fields must be an array like [{ selector, value }] or an object map like { "input[name=email]": "a@b.com" }']
      };
    }
    for (const field of fields) {
      try {
        const el = resolveField(field);
        if (!el) {
          errors.push(`Not found: ${field.selector || field.name || field.label || field.placeholder || field.text || "[unknown]"}`);
          continue;
        }
        setNativeValue(el, field);
        filled.push({
          target: field.selector || field.name || field.label || field.placeholder || field.text || elementLabel(el),
          resolved: elementLabel(el),
          tag: el.tagName,
          type: el.type || void 0,
          action: field.action || "set"
        });
      } catch (err) {
        errors.push(`${field.selector || field.name || field.label || field.placeholder || field.text || "[unknown]"}: ${err.message || String(err)}`);
      }
    }
    if (msg.submitSelector) {
      const btn = document.querySelector(msg.submitSelector);
      if (btn)
        btn.click();
      else
        errors.push(`Submit not found: ${msg.submitSelector}`);
    }
    return { success: errors.length === 0, filled, errors };
  }
  function findCustomOption(value, root) {
    const query = [
      '[role="option"]',
      '[role="menuitem"]',
      '[role="menuitemradio"]',
      '[role="listitem"]',
      "[data-value]",
      "li",
      "button",
      "a",
      "div",
      "span"
    ].join(",");
    const scope = root || document;
    const candidates = Array.from(scope.querySelectorAll(query));
    return candidates.find((el) => {
      if (!isVisible(el))
        return false;
      const dataValue = el.getAttribute("data-value") || el.getAttribute("value") || "";
      return dataValue === value || textMatches(el, value, true);
    }) || candidates.find((el) => isVisible(el) && textMatches(el, value, false)) || null;
  }
  async function doSelect(msg) {
    const el = document.querySelector(msg.selector);
    if (!el)
      throw new Error(`Select target not found: ${msg.selector}`);
    if (msg.value === void 0 || msg.value === null || String(msg.value) === "")
      throw new Error("value is required");
    const value = String(msg.value);
    if (el instanceof HTMLSelectElement) {
      const opt = Array.from(el.options).find((o) => o.value === value || o.text.trim() === value);
      if (!opt)
        throw new Error(`Option "${value}" not found in ${msg.selector}`);
      el.value = opt.value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { success: true, selector: msg.selector, selected: opt.text, value: opt.value, mode: "native" };
    }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    if (isFxEnabled()) {
      await fxSleep(160);
      await fxToElement(el);
    }
    clickLikeUser(el);
    await fxSleep(250);
    const expanded = el.getAttribute("aria-controls");
    const popup = expanded ? document.getElementById(expanded) : null;
    const option = findCustomOption(value, popup) || findCustomOption(value);
    if (!option) {
      throw new Error(`Custom dropdown option "${value}" not found after opening ${msg.selector}`);
    }
    if (isFxEnabled())
      await fxToElement(option);
    clickLikeUser(option);
    return {
      success: true,
      selector: msg.selector,
      selected: textOf(option, 120) || value,
      value,
      mode: "custom",
      optionSelector: cssPath(option)
    };
  }
  function storageGet(msg) {
    const store = msg.storageType === "session" ? sessionStorage : localStorage;
    const value = store.getItem(msg.key);
    return { success: true, key: msg.key, value, found: value !== null };
  }
  function storageSet(msg) {
    const store = msg.storageType === "session" ? sessionStorage : localStorage;
    if (!msg.key)
      throw new Error("key is required");
    store.setItem(String(msg.key), String(msg.value ?? ""));
    return { success: true, key: String(msg.key), type: msg.storageType === "session" ? "session" : "local" };
  }
  function storageRemove(msg) {
    const store = msg.storageType === "session" ? sessionStorage : localStorage;
    if (!msg.key)
      throw new Error("key is required");
    store.removeItem(String(msg.key));
    return { success: true, key: String(msg.key), type: msg.storageType === "session" ? "session" : "local" };
  }
  function storageList(msg) {
    const store = msg.storageType === "session" ? sessionStorage : localStorage;
    const prefix = String(msg.prefix || "");
    const keys = Array.from({ length: store.length }, (_, i) => store.key(i)).filter(Boolean);
    const filtered = prefix ? keys.filter((k) => k.startsWith(prefix)) : keys;
    const limit = Math.min(Number(msg.limit || 100), 500);
    return {
      success: true,
      type: msg.storageType === "session" ? "session" : "local",
      count: filtered.length,
      keys: filtered.slice(0, limit),
      items: msg.include_values ? filtered.slice(0, limit).map((key) => ({ key, value: store.getItem(key) })) : void 0
    };
  }
  async function doHover(msg) {
    const el = document.querySelector(msg.selector);
    if (!el)
      throw new Error(`Element not found: ${msg.selector}`);
    if (isFxEnabled())
      await fxToElement(el);
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    return { success: true, selector: msg.selector };
  }

  // src/content/popups.ts
  var POPUP_SELECTOR = [
    "dialog[open]",
    '[role="dialog"]',
    '[role="alertdialog"]',
    '[aria-modal="true"]',
    '[class*="modal" i]',
    '[class*="dialog" i]',
    '[class*="popup" i]',
    '[class*="popover" i]',
    '[class*="drawer" i]',
    '[class*="toast" i]',
    '[class*="overlay" i]',
    '[class*="ant-modal" i]',
    '[class*="el-dialog" i]',
    '[class*="MuiDialog" i]',
    '[class*="van-popup" i]'
  ].join(",");
  var CLOSE_SELECTOR = [
    'button[aria-label*="close" i]',
    'button[aria-label*="\u5173\u95ED" i]',
    '[role="button"][aria-label*="close" i]',
    '[role="button"][aria-label*="\u5173\u95ED" i]',
    'button[title*="close" i]',
    'button[title*="\u5173\u95ED" i]',
    "[data-dismiss]",
    "[data-bs-dismiss]",
    '[data-testid*="close" i]',
    '[class*="close" i]',
    '[class*="cancel" i]',
    ".ant-modal-close",
    ".el-dialog__headerbtn",
    ".MuiDialog-root button[aria-label]",
    ".btn-close"
  ].join(",");
  var CLOSE_TEXTS = [
    "\u5173\u95ED",
    "\u5173 \u95ED",
    "\u53D6\u6D88",
    "\u7A0D\u540E",
    "\u7A0D\u540E\u518D\u8BF4",
    "\u6211\u77E5\u9053\u4E86",
    "\u77E5\u9053\u4E86",
    "\u786E\u5B9A",
    "\u786E\u8BA4",
    "\u4E0D\u518D\u63D0\u793A",
    "\u8DF3\u8FC7",
    "\u5173\u95ED\u5F39\u7A97",
    "Close",
    "Cancel",
    "OK",
    "Ok",
    "Got it",
    "Dismiss",
    "\xD7",
    "x",
    "X"
  ];
  function isLikelyPopup(el) {
    if (!isVisible(el) || el === document.body || el === document.documentElement)
      return false;
    const h = el;
    const tag = h.tagName.toLowerCase();
    const role = h.getAttribute("role");
    const cls = String(h.className || "").toLowerCase();
    const explicit = tag === "dialog" || role === "dialog" || role === "alertdialog" || h.getAttribute("aria-modal") === "true" || /(modal|dialog|popup|popover|drawer|toast|overlay|ant-modal|el-dialog|muidialog|van-popup)/i.test(cls);
    if (explicit)
      return true;
    const s = getComputedStyle(h);
    if (!["fixed", "sticky"].includes(s.position))
      return false;
    const z = zIndexOf(h);
    const r = h.getBoundingClientRect();
    const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
    const areaRatio = r.width * r.height / viewportArea;
    const coversCenter = r.left <= window.innerWidth / 2 && r.right >= window.innerWidth / 2 && r.top <= window.innerHeight / 2 && r.bottom >= window.innerHeight / 2;
    const hasClose = findCloseCandidates(h, 1).length > 0;
    return z >= 10 && (hasClose || coversCenter || areaRatio >= 0.12);
  }
  function findCloseCandidates(root, limit = 12) {
    const candidates = [];
    const seen = /* @__PURE__ */ new Set();
    const add = (el) => {
      if (!el || seen.has(el) || !isVisible(el))
        return;
      const clickable2 = clickableAncestor(el);
      if (!isVisible(clickable2) || seen.has(clickable2))
        return;
      seen.add(clickable2);
      candidates.push(clickable2);
    };
    root.querySelectorAll(CLOSE_SELECTOR).forEach(add);
    const clickable = root.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"],[aria-label],[title]');
    clickable.forEach((el) => {
      const txt = textOf(el, 80);
      const cls = String(el.className || "").toLowerCase();
      const labelledClose = /(close|cancel|dismiss)/.test(cls) || /关闭|取消/.test(txt);
      if (labelledClose || CLOSE_TEXTS.some((t) => txt.toLowerCase() === t.toLowerCase()))
        add(el);
    });
    return candidates.sort((a, b) => {
      const ta = textOf(a, 80);
      const tb = textOf(b, 80);
      const score = (t) => {
        if (/^(×|x)$/i.test(t))
          return 0;
        if (/关闭|close/i.test(t))
          return 1;
        if (/取消|cancel|dismiss|稍后|知道了|ok/i.test(t))
          return 2;
        return 3;
      };
      return score(ta) - score(tb);
    }).slice(0, limit);
  }
  function collectPopupElements() {
    const raw = /* @__PURE__ */ new Set();
    document.querySelectorAll(POPUP_SELECTOR).forEach((el) => raw.add(el));
    document.querySelectorAll("body *").forEach((el) => {
      if (isLikelyPopup(el))
        raw.add(el);
    });
    const popups = Array.from(raw).filter(isLikelyPopup).sort((a, b) => {
      const z = zIndexOf(b) - zIndexOf(a);
      if (z !== 0)
        return z;
      return elementArea(a) - elementArea(b);
    });
    const out = [];
    for (const el of popups) {
      if (out.some((existing) => existing === el || existing.contains(el) && findCloseCandidates(existing, 1).length > 0))
        continue;
      out.push(el);
    }
    return out.slice(0, 10);
  }
  function popupInfo(el, index) {
    const r = el.getBoundingClientRect();
    const closes = findCloseCandidates(el, 6);
    return {
      index,
      selector: cssPath(el),
      tag: el.tagName,
      role: el.getAttribute("role") || "",
      ariaModal: el.getAttribute("aria-modal") || "",
      zIndex: zIndexOf(el),
      rect: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
      text: textOf(el, 260),
      closeCandidates: closes.map((c) => ({ selector: cssPath(c), text: textOf(c, 80), tag: c.tagName }))
    };
  }
  function doFindPopups(msg) {
    const limit = Math.max(1, Math.min(Number(msg.limit || 10), 20));
    const popups = collectPopupElements().slice(0, limit).map(popupInfo);
    return { success: true, count: popups.length, popups };
  }
  async function doClosePopup(msg) {
    const strategy = String(msg.strategy || "auto");
    const before = collectPopupElements();
    let target = null;
    if (msg.selector)
      target = document.querySelector(String(msg.selector));
    if (!target && msg.text) {
      const needle = String(msg.text);
      target = before.find((el) => textOf(el, 1e3).includes(needle)) || null;
    }
    if (!target)
      target = before[Math.max(0, Number(msg.index || 0))] || null;
    if (!target)
      return { success: false, closed: false, reason: "no_popup_found", beforeCount: 0, afterCount: 0 };
    const beforeSelector = cssPath(target);
    const tryCloseButton = async () => {
      const candidates = findCloseCandidates(target, 8);
      const btn = candidates[0];
      if (!btn)
        return false;
      if (isFxEnabled()) {
        await fxToElement(btn);
        const c2 = elCenter(btn);
        fxClickAt(c2.x, c2.y);
        await fxSleep(80);
      }
      const c = elCenter(btn);
      const opts = { bubbles: true, cancelable: true, view: window, clientX: c.x, clientY: c.y };
      btn.dispatchEvent(new PointerEvent("pointerdown", opts));
      btn.dispatchEvent(new MouseEvent("mousedown", opts));
      btn.dispatchEvent(new PointerEvent("pointerup", opts));
      btn.dispatchEvent(new MouseEvent("mouseup", opts));
      btn.dispatchEvent(new MouseEvent("click", opts));
      btn.click?.();
      return true;
    };
    const pressEscape = () => {
      const init = { key: "Escape", code: "Escape", bubbles: true, cancelable: true };
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", init));
      document.dispatchEvent(new KeyboardEvent("keydown", init));
      document.dispatchEvent(new KeyboardEvent("keyup", init));
    };
    const clickBackdrop = () => {
      const r = target.getBoundingClientRect();
      const points = [
        { x: Math.max(2, r.left + 8), y: Math.max(2, r.top + 8) },
        { x: Math.min(window.innerWidth - 2, r.right - 8), y: Math.max(2, r.top + 8) },
        { x: window.innerWidth / 2, y: Math.min(window.innerHeight - 2, r.bottom - 8) }
      ];
      const pt = points.find((p) => {
        const hit2 = document.elementFromPoint(p.x, p.y);
        return hit2 === target || !!hit2 && target.contains(hit2);
      }) || points[0];
      const hit = document.elementFromPoint(pt.x, pt.y) || target;
      hit.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window, clientX: pt.x, clientY: pt.y }));
      hit.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window, clientX: pt.x, clientY: pt.y }));
      hit.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window, clientX: pt.x, clientY: pt.y }));
    };
    const targetGone = () => !document.documentElement.contains(target) || !isVisible(target);
    let method = "";
    if (strategy === "close_button" || strategy === "auto") {
      if (await tryCloseButton())
        method = "close_button";
      else if (strategy === "close_button")
        throw new Error("No close button found in popup");
    }
    if (!method && (strategy === "escape" || strategy === "auto")) {
      pressEscape();
      method = "escape";
    }
    await fxSleep(260);
    if (!targetGone() && (strategy === "backdrop" || strategy === "auto")) {
      clickBackdrop();
      method = method ? `${method}+backdrop` : "backdrop";
      await fxSleep(260);
    }
    if (!targetGone() && msg.force_remove === true) {
      ;
      target.remove();
      method = method ? `${method}+force_remove` : "force_remove";
      await fxSleep(60);
    }
    const after = collectPopupElements();
    return {
      success: targetGone() || after.length < before.length,
      closed: targetGone() || after.length < before.length,
      reason: targetGone() || after.length < before.length ? "" : "popup_still_visible",
      method: method || "none",
      selector: beforeSelector,
      beforeCount: before.length,
      afterCount: after.length,
      remainingPopups: after.map(popupInfo)
    };
  }

  // src/content/index.ts
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    handleAction(msg).then(sendResponse).catch((err) => sendResponse({
      success: false,
      error: {
        message: err.message || String(err),
        code: err.code || "CONTENT_ACTION_FAILED",
        suggestion: err.suggestion || "Check the selector, page state, and whether the target element is visible/interactable."
      },
      trace: msg?.trace ? { action: msg.action, args: msg } : void 0
    }));
    return true;
  });
  async function handleAction(msg) {
    switch (msg.action) {
      case "click":
        return doClick(msg);
      case "double_click":
        return doDoubleClick(msg);
      case "right_click":
        return doRightClick(msg);
      case "drag":
        return doDrag(msg);
      case "press_key":
        return doPressKey(msg);
      case "find_popups":
        return doFindPopups(msg);
      case "close_popup":
        return doClosePopup(msg);
      case "page_info":
        return doPageInfo();
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
      case "dom_snapshot":
        return domSnapshot(msg);
      case "iframe_list":
        return iframeList();
      case "performance":
        return performanceInfo();
      case "file_upload":
        return fileUpload(msg);
      case "select":
        return doSelect(msg);
      case "hover":
        return doHover(msg);
      case "storage_get":
        return storageGet(msg);
      case "storage_set":
        return storageSet(msg);
      case "storage_remove":
        return storageRemove(msg);
      case "storage_list":
        return storageList(msg);
      default:
        throw new Error(`Unknown content action: ${msg.action}`);
    }
  }
})();
