const $ = id => document.getElementById(id);

let currentTab = null;

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function formatWhen(ts) {
  if (!ts) return "Never";
  const d = new Date(ts);
  return d.toLocaleString();
}

async function getWatches() {
  const stored = await chrome.storage.local.get({ watches: [] });
  return Array.isArray(stored.watches) ? stored.watches : [];
}

async function saveWatches(watches) {
  await chrome.storage.local.set({ watches });
  await chrome.runtime.sendMessage({ type: "WPCM_SYNC_ALARMS" }).catch(() => {});
}

async function loadCurrentTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  currentTab = tab || null;

  if (!tab?.url || !/^https?:\/\//i.test(tab.url)) {
    $("currentTitle").textContent = "Open a normal webpage first";
    $("currentUrl").textContent = "";
    $("addWatch").disabled = true;
    return;
  }

  $("currentTitle").textContent = tab.title || "Untitled page";
  $("currentUrl").textContent = tab.url;
  $("addWatch").disabled = false;
}

function watchRow(watch) {
  const row = document.createElement("div");
  row.className = "watch-row";

  const top = document.createElement("div");
  top.className = "watch-top";

  const text = document.createElement("div");
  text.className = "watch-text";

  const title = document.createElement("strong");
  title.textContent = watch.title || watch.url;

  const url = document.createElement("small");
  url.textContent = watch.url;

  text.appendChild(title);
  text.appendChild(url);

  const enabled = document.createElement("input");
  enabled.type = "checkbox";
  enabled.checked = watch.enabled !== false;
  enabled.title = "Enable monitoring";

  enabled.addEventListener("change", async () => {
    const watches = await getWatches();
    const found = watches.find(w => w.id === watch.id);
    if (!found) return;
    found.enabled = enabled.checked;
    await saveWatches(watches);
    await render();
  });

  top.appendChild(text);
  top.appendChild(enabled);

  const meta = document.createElement("div");
  meta.className = "watch-meta";

  const modeText = watch.mode === "phrase"
    ? `Text: "${watch.phrase}"`
    : "Any content change";

  meta.textContent =
    `${modeText} • every ${watch.intervalMinutes} min • ` +
    `last check: ${formatWhen(watch.lastCheckedAt)}`;

  const state = document.createElement("div");
  state.className = "watch-state";

  if (watch.lastError) {
    state.textContent = `Error: ${watch.lastError}`;
    state.classList.add("error");
  } else if (watch.lastChangedAt) {
    state.textContent = `Last change: ${formatWhen(watch.lastChangedAt)}`;
  } else {
    state.textContent = "No change detected yet.";
  }

  const actions = document.createElement("div");
  actions.className = "watch-actions";

  const check = document.createElement("button");
  check.textContent = "Check now";
  check.addEventListener("click", async () => {
    check.disabled = true;
    $("status").textContent = `Checking ${watch.title || watch.url}…`;

    const result = await chrome.runtime.sendMessage({
      type: "WPCM_CHECK_NOW",
      id: watch.id
    }).catch(error => ({
      ok: false,
      error: String(error)
    }));

    check.disabled = false;

    if (result?.ok) {
      $("status").textContent = result.changed
        ? `Change detected: ${result.reason || "page changed"}`
        : "Checked: no new change detected.";
    } else {
      $("status").textContent =
        `Check failed: ${result?.error || result?.reason || "unknown error"}`;
    }

    await render();
  });

  const open = document.createElement("button");
  open.textContent = "Open";
  open.addEventListener("click", () => {
    chrome.tabs.create({ url: watch.url });
  });

  const remove = document.createElement("button");
  remove.className = "danger";
  remove.textContent = "Remove";
  remove.addEventListener("click", async () => {
    const watches = (await getWatches()).filter(w => w.id !== watch.id);
    await saveWatches(watches);
    await render();
    $("status").textContent = "Monitor removed.";
  });

  actions.appendChild(check);
  actions.appendChild(open);
  actions.appendChild(remove);

  row.appendChild(top);
  row.appendChild(meta);
  row.appendChild(state);
  row.appendChild(actions);

  return row;
}

async function render() {
  const watches = await getWatches();

  $("watchCount").textContent = String(watches.length);
  $("watchList").replaceChildren();

  if (!watches.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No monitored pages yet.";
    $("watchList").appendChild(empty);
    return;
  }

  const sorted = [...watches].sort(
    (a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)
  );

  for (const watch of sorted) {
    $("watchList").appendChild(watchRow(watch));
  }
}

$("mode").addEventListener("change", () => {
  $("phraseWrap").classList.toggle("hidden", $("mode").value !== "phrase");
});

$("addWatch").addEventListener("click", async () => {
  if (!currentTab?.url || !/^https?:\/\//i.test(currentTab.url)) {
    $("status").textContent = "Open a normal webpage first.";
    return;
  }

  const mode = $("mode").value;
  const phrase = $("phrase").value.trim();
  const intervalMinutes = Math.max(
    5,
    Number($("interval").value || 15)
  );

  if (mode === "phrase" && !phrase) {
    $("status").textContent = "Enter the text you want to watch.";
    $("phrase").focus();
    return;
  }

  const watches = await getWatches();

  const watch = {
    id: makeId(),
    url: currentTab.url.split("#")[0],
    title: currentTab.title || new URL(currentTab.url).hostname,
    mode,
    phrase: mode === "phrase" ? phrase : "",
    intervalMinutes,
    enabled: true,
    createdAt: Date.now(),
    lastHash: null,
    lastPhraseState: null,
    lastCheckedAt: null,
    lastChangedAt: null,
    lastError: null
  };

  watches.push(watch);
  await saveWatches(watches);

  $("status").textContent = "Creating baseline…";

  const result = await chrome.runtime.sendMessage({
    type: "WPCM_CHECK_NOW",
    id: watch.id
  }).catch(error => ({
    ok: false,
    error: String(error)
  }));

  if (result?.ok) {
    $("status").textContent =
      `Monitoring started. Checking every ${intervalMinutes} minutes.`;
  } else {
    $("status").textContent =
      `Monitor saved, but baseline failed: ${result?.error || result?.reason || "unknown error"}`;
  }

  await render();
});

(async () => {
  await loadCurrentTab();
  await render();
})();
