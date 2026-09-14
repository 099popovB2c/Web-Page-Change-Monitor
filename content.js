(() => {
  if (window.__wpcmLoaded) return;
  window.__wpcmLoaded = true;

  let picker = null;

  function normalize(value) { return String(value || "").replace(/\s+/g, " ").trim(); }

  function normalizedVisibleText() {
    const clone = document.body?.cloneNode(true);
    if (!clone) return "";
    clone.querySelectorAll("script,style,noscript,svg,canvas,video,audio").forEach(el => el.remove());
    return normalize(clone.innerText || clone.textContent || "");
  }

  function escapeAttribute(value) { return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"'); }

  function uniqueSelector(element) {
    if (!(element instanceof Element)) return "";
    if (element.id) {
      const candidate = `#${CSS.escape(element.id)}`;
      try { if (document.querySelectorAll(candidate).length === 1) return candidate; } catch {}
    }
    const testId = element.getAttribute("data-testid");
    if (testId) {
      const candidate = `[data-testid="${escapeAttribute(testId)}"]`;
      try { if (document.querySelectorAll(candidate).length === 1) return candidate; } catch {}
    }
    const parts = [];
    let node = element;
    while (node && node.nodeType === Node.ELEMENT_NODE) {
      const tag = node.tagName.toLowerCase();
      if (node.id) { parts.unshift(`#${CSS.escape(node.id)}`); break; }
      const parent = node.parentElement;
      if (!parent) { parts.unshift(tag); break; }
      const sameTag = [...parent.children].filter(child => child.tagName === node.tagName);
      const index = sameTag.indexOf(node) + 1;
      parts.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${index})` : tag);
      node = parent;
      if (tag === "body") break;
    }
    return parts.join(" > ");
  }

  function elementText(selector) {
    if (!selector) return { ok: false, error: "No selector saved." };
    let element;
    try { element = document.querySelector(selector); } catch { return { ok: false, error: "Saved selector is no longer valid." }; }
    if (!element) return { ok: false, error: "Selected element was not found on the page." };
    return { ok: true, selector, text: normalize(element.innerText || element.textContent || "").slice(0, 200000) };
  }

  function stopPicker(message = "") {
    if (!picker) return;
    document.removeEventListener("mouseover", picker.onOver, true);
    document.removeEventListener("mouseout", picker.onOut, true);
    document.removeEventListener("click", picker.onClick, true);
    document.removeEventListener("keydown", picker.onKey, true);
    if (picker.current) {
      picker.current.style.outline = picker.previousOutline || "";
      picker.current.style.outlineOffset = picker.previousOffset || "";
    }
    picker.toast?.remove();
    picker = null;
    if (message) {
      const toast = document.createElement("div");
      toast.dataset.wpcmPickerUi = "true";
      toast.textContent = message;
      Object.assign(toast.style, {position:"fixed",right:"18px",top:"18px",zIndex:"2147483647",maxWidth:"360px",padding:"12px 14px",borderRadius:"12px",background:"#111827",color:"#fff",font:"600 12px/1.4 Arial,sans-serif",boxShadow:"0 12px 35px rgba(0,0,0,.35)"});
      document.documentElement.appendChild(toast);
      setTimeout(() => toast.remove(), 4000);
    }
  }

  function startPicker() {
    stopPicker();
    const toast = document.createElement("div");
    toast.dataset.wpcmPickerUi = "true";
    toast.textContent = "Web Page Change Monitor: click the element to monitor. Press Esc to cancel.";
    Object.assign(toast.style, {position:"fixed",right:"18px",top:"18px",zIndex:"2147483647",maxWidth:"390px",padding:"12px 14px",borderRadius:"12px",background:"#2563eb",color:"#fff",font:"700 12px/1.4 Arial,sans-serif",boxShadow:"0 12px 35px rgba(0,0,0,.35)",pointerEvents:"none"});
    document.documentElement.appendChild(toast);
    const state = { toast, current:null, previousOutline:"", previousOffset:"" };
    state.onOver = event => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest('[data-wpcm-picker-ui="true"]')) return;
      if (state.current && state.current !== target) {
        state.current.style.outline = state.previousOutline;
        state.current.style.outlineOffset = state.previousOffset;
      }
      state.current = target;
      state.previousOutline = target.style.outline;
      state.previousOffset = target.style.outlineOffset;
      target.style.outline = "3px solid #2563eb";
      target.style.outlineOffset = "2px";
    };
    state.onOut = event => {
      const target = event.target;
      if (!(target instanceof Element) || target !== state.current) return;
      target.style.outline = state.previousOutline;
      target.style.outlineOffset = state.previousOffset;
      state.current = null;
    };
    state.onClick = async event => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest('[data-wpcm-picker-ui="true"]')) return;
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
      const selector = uniqueSelector(target);
      const preview = normalize(target.innerText || target.textContent || "").slice(0, 260);
      await chrome.storage.local.set({ pendingElementSelection: { url: location.href.split("#")[0], title: document.title || location.hostname, selector, preview, selectedAt: Date.now() } });
      stopPicker(`Element selected${preview ? `: ${preview}` : ""}. Reopen the extension to save the monitor.`);
    };
    state.onKey = event => { if (event.key === "Escape") { event.preventDefault(); stopPicker("Element selection cancelled."); } };
    picker = state;
    document.addEventListener("mouseover", state.onOver, true);
    document.addEventListener("mouseout", state.onOut, true);
    document.addEventListener("click", state.onClick, true);
    document.addEventListener("keydown", state.onKey, true);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "WPCM_CAPTURE_PAGE") { sendResponse({ ok:true, url:location.href, title:document.title || location.hostname, text:normalizedVisibleText().slice(0,300000) }); return; }
    if (message?.type === "WPCM_CAPTURE_ELEMENT") { sendResponse(elementText(message.selector)); return; }
    if (message?.type === "WPCM_START_PICKER") { startPicker(); sendResponse({ ok:true }); }
  });
})();
