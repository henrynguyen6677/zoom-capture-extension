const capturedLinkEl = document.getElementById("capturedLink");
const captureMetaEl = document.getElementById("captureMeta");
const progressCardEl = document.getElementById("progressCard");
const progressTextEl = document.getElementById("progressText");
const progressBarEl = document.getElementById("progressBar");
const downloadStateEl = document.getElementById("downloadState");
const toastEl = document.getElementById("toast");
const toastMsgEl = document.getElementById("toastMsg");
const btnCloseToast = document.getElementById("btnCloseToast");
const setupDownloadBtnEl = document.getElementById("setupDownloadBtn");
const setupCardEl = document.getElementById("setupCard");
const setupDetailsEl = document.getElementById("setupDetails");
const setupStatusPillEl = document.getElementById("setupStatusPill");
const historyListEl = document.getElementById("historyList");

const btnCapture = document.getElementById("btnCapture");
const btnDownload = document.getElementById("btnDownload");
const btnReset = document.getElementById("btnReset");
const btnCopyLink = document.getElementById("btnCopyLink");
const btnOpenInline = document.getElementById("btnOpenInline");
const btnRefreshNative = document.getElementById("btnRefreshNative");

let latestState = null;
let latestNativeInstalled = null;
const RELEASE_BASE = "https://github.com/henrynguyen6677/zoom-capture-extension/releases/download/v2.0.0";
let historyCheckToken = 0;
let historyRenderKey = "";

let toastTimer = null;
let toastCooldown = false;

function hideToast() {
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = null;
  toastEl.classList.add("hidden");
  toastMsgEl.textContent = "";
}

function showToast(message, isError = false) {
  if (!message) { hideToast(); return; }
  if (toastCooldown) return;
  if (toastTimer) clearTimeout(toastTimer);
  toastMsgEl.textContent = message;
  toastEl.style.color = isError ? "#ffb4b4" : "#dbe8ff";
  toastEl.classList.remove("hidden");
  toastTimer = setTimeout(() => {
    hideToast();
    // 1s cooldown after auto-hide
    toastCooldown = true;
    setTimeout(() => { toastCooldown = false; }, 1000);
  }, 6000);
}

btnCloseToast.addEventListener("click", () => {
  hideToast();
  toastCooldown = true;
  setTimeout(() => { toastCooldown = false; }, 1000);
});

function formatBytes(value) {
  if (!value || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let idx = 0;
  let size = value;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  return `${size.toFixed(size >= 100 ? 0 : 1)} ${units[idx]}`;
}

function computePercent(download) {
  if (typeof download?.progressPct === "number" && download.progressPct >= 0) {
    return Math.min(100, Math.floor(download.progressPct));
  }
  if (!download || !download.totalBytes || download.totalBytes <= 0) return 0;
  return Math.min(100, Math.floor((download.receivedBytes / download.totalBytes) * 100));
}

function statusText(download) {
  if (!download) return "Ready";

  if (download.status === "idle") return "Ready";
  if (download.status === "starting") return "Initializing download...";
  if (download.status === "downloading") {
    if (typeof download.progressPct === "number" && download.progressPct > 0) {
      return `Downloading: ${Math.floor(download.progressPct)}%`;
    }
    return `Downloading: ${formatBytes(download.receivedBytes)} / ${formatBytes(download.totalBytes)}`;
  }
  if (download.status === "complete") {
    if (download.openPath) {
      return `Completed: ${download.openPath}`;
    }
    return `Completed: ${download.filename || "(unknown file name)"}`;
  }
  if (download.status === "open_in_tab") {
    return "Server blocked downloads API; opened the direct link in a new tab.";
  }
  if (download.status === "error") {
    return `Error: ${download.error || "Unknown error"}`;
  }
  return "Ready";
}

function shortenUrl(url, maxLen = 90) {
  const raw = String(url || "");
  if (!raw || raw.length <= maxLen) return raw;
  const head = raw.slice(0, 48);
  const tail = raw.slice(-30);
  return `${head}...${tail}`;
}

function formatTime(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleTimeString("en-US", { hour12: false });
  } catch {
    return "";
  }
}

function fileBaseName(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const normalized = raw.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : raw;
}

function renderHistory(list) {
  const items = (Array.isArray(list) ? list : []).filter((it) => it?.kind === "download");
  if (!items.length) {
    historyListEl.innerHTML = '<div class="history-empty">No downloads yet</div>';
    return;
  }

  const statusLabel = (s) => {
    if (s === "complete") return "Done";
    if (s === "error") return "Failed";
    if (s === "open_tab") return "Opened in tab";
    if (s === "ok") return "Captured";
    return s || "Info";
  };
  const sourceText = (it) => shortenUrl(it.url || "", 52) || "";
  const fileText = (it) => fileBaseName(it.file || it.filePath || "");

  historyListEl.innerHTML = items.slice(0, 12).map((it) => {
    const time = formatTime(it.at);
    const status = statusLabel(it.status);
    const file = fileText(it) || "Downloaded file";
    const link = sourceText(it);
    const canOpen = (it.downloadId !== null && it.downloadId !== undefined) || !!it.filePath || String(it.file || "").startsWith("/");
    const statusCls = it.status === "complete" ? "st-done" : (it.status === "error" ? "st-fail" : "");
    return `
      <div class="history-chip" data-history-row-id="${it.id}">
        <div class="chip-top">
          <span class="chip-icon">📄</span>
          <span class="chip-file" data-history-file-id="${it.id}" title="${it.filePath || it.file || ""}">${file}</span>
          <button class="chip-open-btn" data-open-history-id="${it.id}" ${canOpen ? "" : "disabled"}>Open</button>
        </div>
        <div class="chip-meta">${time} · <span class="${statusCls}">${status}</span></div>
        ${link ? `<div class="chip-link" title="${it.url || ""}">${link}</div>` : ""}
      </div>`;
  }).join("");
}

function blinkSetupCard() {
  if (!setupCardEl) return;
  if (latestNativeInstalled === true) return;
  setupCardEl.classList.remove("blink-alert");
  // Force reflow to restart animation on repeated failures.
  void setupCardEl.offsetWidth;
  setupCardEl.classList.add("blink-alert");
  setTimeout(() => setupCardEl.classList.remove("blink-alert"), 1600);
}

function getUninstallCmd() {
  const os = getOS();
  if (os === "windows") {
    return 'Remove-Item -Recurse -Force "$env:LOCALAPPDATA\\zoom-native-host"\nreg delete "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.henry.zoomcurl" /f';
  }
  return 'rm -rf ~/.config/zoom-native-host\nrm -f ~/Library/Application\\ Support/Google/Chrome/NativeMessagingHosts/com.henry.zoomcurl.json';
}

function applyNativeStatus(nativeStatus) {
  const installed = !!nativeStatus?.installed;
  latestNativeInstalled = installed;
  setupCardEl.classList.toggle("ready", installed);
  setupDetailsEl.classList.toggle("hidden", installed);

  const installedEl = document.getElementById("setupInstalled");
  if (installedEl) {
    installedEl.classList.toggle("hidden", !installed);
    if (installed) {
      const cmdEl = document.getElementById("uninstallCmd");
      if (cmdEl) cmdEl.textContent = getUninstallCmd();
    }
  }

  if (installed) {
    setupStatusPillEl.textContent = "Installed ✓";
    setupStatusPillEl.className = "setup-pill installed";
    return;
  }

  setupStatusPillEl.textContent = "Not installed";
  setupStatusPillEl.className = "setup-pill missing";
}

async function updateHistoryExistence(list) {
  const items = (Array.isArray(list) ? list : []).filter((it) => it?.kind === "download").slice(0, 12);
  const ids = items.map((x) => String(x.id || "")).filter(Boolean);
  if (!ids.length) return;

  const token = ++historyCheckToken;
  const res = await send("CHECK_HISTORY_EXISTS", { ids });
  if (token !== historyCheckToken) return;
  if (!res.ok || !res.existsById) return;

  for (const id of ids) {
    const exists = !!res.existsById[id];
    const row = historyListEl.querySelector(`[data-history-row-id="${id}"]`);
    const btn = historyListEl.querySelector(`[data-open-history-id="${id}"]`);
    if (!row || !btn) continue;

    row.classList.toggle("missing", !exists);
    if (!exists) {
      btn.setAttribute("disabled", "disabled");
      btn.title = "File not found";
    }
  }
}

async function getActiveTabId() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      resolve(tab && typeof tab.id === "number" ? tab.id : null);
    });
  });
}

async function applyState(state) {
  latestState = state || null;
  const selected = state?.selectedUrl || "";
  const hasValidSelected = !!selected && /^https?:\/\//i.test(selected);
  capturedLinkEl.textContent = selected ? shortenUrl(selected) : "No link captured";
  capturedLinkEl.classList.toggle("empty-state", !selected);
  capturedLinkEl.title = selected || "";
  if (selected) {
    const source = state?.selectedMeta?.source || "n/a";
    const score = typeof state?.selectedMeta?.score === "number" ? state.selectedMeta.score : "-";
    captureMetaEl.textContent = `source: ${source} | score: ${score}`;
    captureMetaEl.classList.remove("hidden");
  } else {
    captureMetaEl.textContent = "";
    captureMetaEl.classList.add("hidden");
  }

  const d = state?.download || {};
  const isBusy = d.status === "starting" || d.status === "downloading";
  btnDownload.disabled = !hasValidSelected || isBusy;
  const pct = d.status === "complete" ? 100 : computePercent(d);
  progressTextEl.textContent = `${pct}%`;
  progressBarEl.style.width = `${pct}%`;
  downloadStateEl.textContent = statusText(d);
  const showProgress = d.status && d.status !== "idle";
  progressCardEl.classList.toggle("hidden", !showProgress);
  btnOpenInline.classList.toggle("hidden", !(d?.status === "complete" && (d?.id || d?.openPath)));
  const history = state?.history || [];
  const historyDownloads = (Array.isArray(history) ? history : [])
    .filter((it) => it?.kind === "download")
    .slice(0, 12);
  const nextHistoryKey = JSON.stringify(
    historyDownloads.map((it) => [it.id, it.status, it.at, it.filePath || it.file || "", it.downloadId || null])
  );
  if (nextHistoryKey !== historyRenderKey) {
    historyRenderKey = nextHistoryKey;
    renderHistory(history);
    updateHistoryExistence(history);
  }
}

function send(type, extra = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...extra }, (res) => {
      const err = chrome.runtime.lastError;
      if (err) {
        resolve({ ok: false, error: err.message || "Unknown runtime error" });
        return;
      }
      resolve(res || { ok: false, error: "No response" });
    });
  });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function flashIcon(button, ok) {
  if (!button) return;
  const original = button.dataset.originalIcon || button.textContent;
  button.dataset.originalIcon = original;
  button.textContent = ok ? "✓" : "✕";
  button.classList.toggle("success-state", !!ok);
  button.classList.toggle("error-state", !ok);
  setTimeout(() => {
    button.textContent = button.dataset.originalIcon || original;
    button.classList.remove("success-state");
    button.classList.remove("error-state");
  }, 900);
}

async function refreshState() {
  const [resState, resNative] = await Promise.all([send("GET_STATE"), send("CHECK_NATIVE_HOST")]);
  if (resState.ok) await applyState(resState.state);
  else showToast(resState.error || "Failed to read state", true);
  if (resNative.ok) applyNativeStatus(resNative);
}

function getOS() {
  const ua = navigator.userAgent;
  if (ua.includes("Windows")) return "windows";
  if (ua.includes("Mac")) return "mac";
  return "other";
}

const INSTALL_SH_URL = "https://raw.githubusercontent.com/henrynguyen6677/zoom-capture-extension/master/install.sh";

function getSetupInfo() {
  const os = getOS();
  const id = chrome.runtime.id;
  if (os === "windows") {
    return {
      mode: "download",
      downloadUrl: `${RELEASE_BASE}/install.bat`,
      buttonText: "⬇ Download Installer (.bat)",
      instructions: "After download, double-click install.bat. Done!"
    };
  }
  return {
    mode: "command",
    command: `curl -fsSL ${INSTALL_SH_URL} | bash -s -- ${id}`,
    instructions: "Open Terminal, paste this command, press Enter:"
  };
}

function toFriendlyDownloadError(raw) {
  const msg = String(raw || "").toLowerCase();
  if (!msg) return "Download failed. Please refresh and recapture the Zoom link, then try again.";
  if (
    msg.includes("curl") ||
    msg.includes("forbidden") ||
    msg.includes("signature") ||
    msg.includes("expired") ||
    msg.includes("403") ||
    msg.includes("timeout")
  ) {
    return "Download failed. Please refresh and recapture the Zoom link, then try again.";
  }
  return "Download failed. Please refresh and recapture the Zoom link, then try again.";
}

btnCapture.addEventListener("click", async () => {
  const res = await send("CAPTURE_FROM_ACTIVE_TAB");
  if (res.ok) {
    const src = res.pickedFrom || "network";
    const score = typeof res.score === "number" ? res.score : "-";
    showToast(`Link captured (${src}, score ${score}).`);
  } else {
    showToast(res.error || "Capture failed", true);
  }
  await refreshState();
});

let pendingOverwrite = false;
let overwriteTimer = null;

function clearOverwriteState() {
  pendingOverwrite = false;
  if (overwriteTimer) clearTimeout(overwriteTimer);
  overwriteTimer = null;
  btnDownload.textContent = "2. Download";
  btnDownload.classList.remove("danger-state");
}

async function doDownload() {
  const res = await send("SMART_DOWNLOAD");
  if (res.ok) {
    const method = res.method || "unknown";
    const methodLabel = {
      native_host: "Helper",
      open_tab: "Opened in browser"
    }[method] || method;

    if (method === "open_tab") {
      showToast(`${methodLabel} — file may be incomplete. Install Helper for reliable downloads.`, true);
    } else {
      showToast(`Download started (${methodLabel})`);
    }
  } else {
    if (res.needsSetup) {
      showToast("Install Helper below ↓ then click ↻ to verify", true);
      blinkSetupCard();
    } else {
      showToast(toFriendlyDownloadError(res.error), true);
    }
  }
  await refreshState();
}

btnDownload.addEventListener("click", async () => {
  // Second click = confirmed overwrite
  if (pendingOverwrite) {
    clearOverwriteState();
    await doDownload();
    return;
  }

  // Try file check (works only with native host — gracefully skip if unavailable)
  try {
    const checkRes = await send("CHECK_FILE_EXISTS");
    if (checkRes.ok && checkRes.exists) {
      pendingOverwrite = true;
      btnDownload.textContent = "File exists — tap to overwrite";
      btnDownload.classList.add("danger-state");
      showToast(`⚠ ${checkRes.filename} already exists. Tap again to overwrite.`, true);
      overwriteTimer = setTimeout(() => {
        clearOverwriteState();
        showToast("");
      }, 5000);
      return;
    }
  } catch {
    // Native host not available — skip file check, proceed with download
  }

  await doDownload();
});

btnOpenInline.addEventListener("click", async () => {
  const res = await send("SHOW_DOWNLOADED_FILE");
  if (res.ok) {
    showToast("Opened download location.");
    flashIcon(btnOpenInline, true);
  } else {
    showToast(res.error || "Failed to open file", true);
    flashIcon(btnOpenInline, false);
  }
});

btnReset.addEventListener("click", async () => {
  const res = await send("RESET_STATE");
  if (res.ok) {
    showToast("State reset.");
  } else {
    showToast(res.error || "Reset failed", true);
  }
  await refreshState();
});

btnRefreshNative.addEventListener("click", async () => {
  setupStatusPillEl.textContent = "Checking...";
  setupStatusPillEl.className = "setup-pill checking";
  btnRefreshNative.disabled = true;
  btnRefreshNative.classList.add("spinning");
  try {
    const resNative = await send("CHECK_NATIVE_HOST");
    if (resNative.ok) {
      applyNativeStatus(resNative);
      if (resNative.installed) {
        showToast("Helper detected ✓");
      } else {
        showToast("Helper not found. Install below.", true);
      }
    } else {
      showToast(resNative.error || "Failed to check helper", true);
    }
  } finally {
    btnRefreshNative.disabled = false;
    btnRefreshNative.classList.remove("spinning");
  }
});

btnCopyLink.addEventListener("click", async () => {
  const url = latestState?.selectedUrl || "";
  if (!url) {
    showToast("No captured link to copy.", true);
    flashIcon(btnCopyLink, false);
    return;
  }
  const copied = await copyText(url);
  if (copied) {
    showToast("Link copied.");
    flashIcon(btnCopyLink, true);
  } else {
    showToast("Failed to copy link.", true);
    flashIcon(btnCopyLink, false);
  }
});

historyListEl.addEventListener("click", async (ev) => {
  const target = ev.target;
  if (!(target instanceof HTMLElement)) return;
  const id = target.dataset.openHistoryId;
  if (!id) return;

  const res = await send("OPEN_HISTORY_ITEM", { id });
  if (res.ok) {
    showToast("Opened history item.");
  } else {
    showToast(res.error || "Failed to open history item.", true);
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "STATE_UPDATE" && msg.payload) {
    applyState(msg.payload);
  }
});

const setupInfo = getSetupInfo();
const setupModeDownload = document.getElementById("setupModeDownload");
const setupModeCommand = document.getElementById("setupModeCommand");
const setupCommandEl = document.getElementById("setupCommand");
const btnCopySetup = document.getElementById("btnCopySetup");

if (setupInfo.mode === "download") {
  setupModeDownload.classList.remove("hidden");
  setupDownloadBtnEl.href = setupInfo.downloadUrl;
  setupDownloadBtnEl.textContent = setupInfo.buttonText;
  const instrEl = document.getElementById("setupInstructions");
  if (instrEl) instrEl.textContent = setupInfo.instructions;
} else {
  setupModeCommand.classList.remove("hidden");
  setupCommandEl.textContent = setupInfo.command;
  const instrEl = document.getElementById("setupInstructions2");
  if (instrEl) instrEl.textContent = setupInfo.instructions;
}

if (btnCopySetup) {
  btnCopySetup.addEventListener("click", async () => {
    const copied = await copyText(setupInfo.command || "");
    if (copied) {
      showToast("Command copied ✓");
      flashIcon(btnCopySetup, true);
    } else {
      showToast("Failed to copy", true);
      flashIcon(btnCopySetup, false);
    }
  });
}
setupStatusPillEl.textContent = "Checking...";
setupStatusPillEl.className = "setup-pill checking";
refreshState();

// Auto re-check when panel gets focus (e.g. user switches back after installing)
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshState();
});
window.addEventListener("focus", () => refreshState());
