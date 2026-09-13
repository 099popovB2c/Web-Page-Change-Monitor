const DEFAULT_INTERVAL = 15;

function alarmName(id) {
  return `WPCM_${id}`;
}

function normalizeText(value) {
  return String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function simpleHash(input) {
  let hash = 2166136261;
  const text = String(input || "");
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

async function getWatches() {
  const stored = await chrome.storage.local.get({ watches: [] });
  return Array.isArray(stored.watches) ? stored.watches : [];
}

async function saveWatches(watches) {
  await chrome.storage.local.set({ watches });
}

async function notify(title, message) {
  await chrome.notifications.create({
    type: "basic",
    iconUrl: "icon128.png",
    title,
    message: message.slice(0, 240)
  });
}

async function fetchPage(url) {
  const target = String(url || "").split("#")[0];
  const tabs = await chrome.tabs.query({});

  for (const tab of tabs) {
    const tabUrl = String(tab.url || "").split("#")[0];
    if (!tab.id || tabUrl !== target) continue;

    try {
      const rendered = await chrome.tabs.sendMessage(tab.id, {
        type: "WPCM_CAPTURE_PAGE"
      });

      if (rendered?.ok && typeof rendered.text === "string") {
        return {
          html: null,
          text: rendered.text.slice(0, 300000),
          source: "open-tab"
        };
      }
    } catch {
      // Fall back to HTTP fetch below.
    }
  }

  const response = await fetch(url, {
    cache: "no-store",
    credentials: "omit",
    redirect: "follow"
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/") && !contentType.includes("html")) {
    throw new Error("Unsupported content type");
  }

  const html = await response.text();

  return {
    html,
    text: normalizeText(html).slice(0, 300000),
    source: "fetch"
  };
}

async function ensureAlarm(watch) {
  if (!watch.enabled) {
    await chrome.alarms.clear(alarmName(watch.id));
    return;
  }

  const minutes = Math.max(5, Number(watch.intervalMinutes || DEFAULT_INTERVAL));
  const current = await chrome.alarms.get(alarmName(watch.id));

  if (
    current &&
    Math.round(Number(current.periodInMinutes || 0)) === minutes
  ) {
    return;
  }

  await chrome.alarms.clear(alarmName(watch.id));
  await chrome.alarms.create(alarmName(watch.id), {
    delayInMinutes: minutes,
    periodInMinutes: minutes
  });
}

async function ensureAllAlarms() {
  const watches = await getWatches();

  const allAlarms = await chrome.alarms.getAll();
  for (const alarm of allAlarms) {
    if (alarm.name.startsWith("WPCM_")) {
      const id = alarm.name.slice(5);
      if (!watches.some(w => String(w.id) === id && w.enabled)) {
        await chrome.alarms.clear(alarm.name);
      }
    }
  }

  for (const watch of watches) {
    await ensureAlarm(watch);
  }
}

function evaluatePhraseMode(watch, text) {
  const phrase = String(watch.phrase || "").trim();
  const haystack = text.toLocaleLowerCase();
  const needle = phrase.toLocaleLowerCase();

  const contains = needle ? haystack.includes(needle) : false;
  const previous = typeof watch.lastPhraseState === "boolean"
    ? watch.lastPhraseState
    : null;

  let changed = false;
  let reason = "";

  if (previous !== null && previous !== contains) {
    changed = true;
    reason = contains
      ? `Text appeared: "${phrase}"`
      : `Text disappeared: "${phrase}"`;
  }

  return { contains, changed, reason };
}

async function checkWatchById(id, manual = false) {
  const watches = await getWatches();
  const index = watches.findIndex(w => String(w.id) === String(id));

  if (index < 0) {
    return { ok: false, reason: "watch-not-found" };
  }

  const watch = watches[index];

  if (!watch.enabled && !manual) {
    return { ok: false, reason: "watch-disabled" };
  }

  const startedAt = Date.now();

  try {
    const page = await fetchPage(watch.url);

    let changed = false;
    let reason = "";
    let nextHash = watch.lastHash || null;
    let nextPhraseState = watch.lastPhraseState;

    if (watch.mode === "phrase") {
      const result = evaluatePhraseMode(watch, page.text);
      changed = result.changed;
      reason = result.reason;
      nextPhraseState = result.contains;
      nextHash = simpleHash(page.text);
    } else {
      nextHash = simpleHash(page.text);

      if (watch.lastHash && watch.lastHash !== nextHash) {
        changed = true;
        reason = "Page content changed.";
      }
    }

    const now = Date.now();

    watches[index] = {
      ...watch,
      lastHash: nextHash,
      lastPhraseState: nextPhraseState,
      lastCheckedAt: now,
      lastChangedAt: changed ? now : watch.lastChangedAt || null,
      lastError: null,
      lastCheckDurationMs: Date.now() - startedAt
    };

    await saveWatches(watches);

    if (changed) {
      await notify(
        `Page changed: ${watch.title || watch.url}`,
        reason || "The monitored webpage changed."
      );
    }

    return {
      ok: true,
      changed,
      reason,
      checkedAt: now,
      hash: nextHash
    };
  } catch (error) {
    watches[index] = {
      ...watch,
      lastCheckedAt: Date.now(),
      lastError: String(error?.message || error),
      lastCheckDurationMs: Date.now() - startedAt
    };

    await saveWatches(watches);

    return {
      ok: false,
      reason: "fetch-failed",
      error: String(error?.message || error)
    };
  }
}

chrome.runtime.onInstalled.addListener(() => {
  ensureAllAlarms().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  ensureAllAlarms().catch(() => {});
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (!alarm.name.startsWith("WPCM_")) return;
  const id = alarm.name.slice(5);
  checkWatchById(id, false).catch(() => {});
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.watches) {
    ensureAllAlarms().catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "WPCM_CHECK_NOW") {
    checkWatchById(message.id, true)
      .then(sendResponse)
      .catch(error => sendResponse({
        ok: false,
        reason: "unexpected-error",
        error: String(error)
      }));
    return true;
  }

  if (message?.type === "WPCM_SYNC_ALARMS") {
    ensureAllAlarms()
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
});

ensureAllAlarms().catch(() => {});
