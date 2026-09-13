(() => {
  if (window.__wpcmLoaded) return;
  window.__wpcmLoaded = true;

  function normalizedVisibleText() {
    const clone = document.body?.cloneNode(true);
    if (!clone) return "";

    clone.querySelectorAll("script,style,noscript,svg,canvas,video,audio").forEach(el => el.remove());

    return (clone.innerText || clone.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "WPCM_CAPTURE_PAGE") {
      sendResponse({
        ok: true,
        url: location.href,
        title: document.title || location.hostname,
        text: normalizedVisibleText().slice(0, 200000)
      });
    }
  });
})();
