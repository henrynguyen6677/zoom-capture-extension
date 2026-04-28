const STATE_KEY = "game4_state_v1";
const NATIVE_HOST_NAME = "com.henry.zoomcurl";

const state = {
  linksByTab: {}, // { [tabId]: CaptureItem[] }
  selectedUrl: "",
  selectedFromTab: null,
  selectedMeta: null,
  history: [],
  download: {
    id: null,
    status: "idle",
    filename: "",
    openPath: "",
    progressPct: 0,
    totalBytes: 0,
    receivedBytes: 0,
    error: "",
    startedAt: 0,
    endedAt: 0
  }
};

function now() {
  return Date.now();
}

function normalizeUrl(url) {
  if (!url || typeof url !== "string") return "";
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    const u = new URL(trimmed);
    u.hash = "";
    return u.toString();
  } catch {
    return trimmed;
  }
}

function isMediaUrl(url) {
  const u = normalizeUrl(url).toLowerCase();
  if (!u) return false;
  return (
    u.includes(".mp4") ||
    u.includes(".m3u8") ||
    u.includes(".m4s") ||
    u.includes(".ts") ||
    u.includes("videoplayback") ||
    u.includes("/cmr/replay/") ||
    u.includes("response-content-type=video")
  );
}

function scoreMediaUrl(url) {
  const u = url.toLowerCase();
  let score = 0;

  if (u.includes("/cmr/replay/")) score += 250;
  if (u.includes(".mp4")) score += 180;
  if (u.includes("response-content-type=video")) score += 120;
  if (u.includes("policy=") && u.includes("signature=")) score += 120;
  if (u.includes("key-pair-id=")) score += 60;
  if (u.includes("fid=") || u.includes("cid=")) score += 30;

  if (u.includes(".m3u8")) score -= 120;
  if (u.includes(".m4s") || u.includes(".ts")) score -= 180;
  if (u.includes("thumb") || u.includes("thumbnail") || u.includes("sprite") || u.includes("preview")) {
    score -= 120;
  }

  score += Math.min(50, Math.floor(url.length / 30));
  return score;
}

function safeHostname(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isItemRelatedToHost(item, host) {
  if (!host) return true;
  const urlHost = safeHostname(item.url);
  const docHost = safeHostname(item.documentUrl || "");
  const initiatorHost = safeHostname(item.initiator || "");
  return [urlHost, docHost, initiatorHost].some((h) => h === host);
}

function makeCaptureItem(input) {
  const url = normalizeUrl(input.url || "");
  if (!url) return null;
  return {
    url,
    initiator: input.initiator || "",
    documentUrl: input.documentUrl || "",
    type: input.type || "",
    source: input.source || "network",
    requestHeaders: input.requestHeaders || [],
    seenAt: now()
  };
}

async function persistState() {
  await chrome.storage.local.set({ [STATE_KEY]: state });
}

async function hydrateState() {
  const raw = await chrome.storage.local.get(STATE_KEY);
  if (!raw || !raw[STATE_KEY]) return;

  const saved = raw[STATE_KEY];

  if (saved.linksByTab && typeof saved.linksByTab === "object") {
    for (const [tabId, arr] of Object.entries(saved.linksByTab)) {
      if (!Array.isArray(arr)) continue;

      state.linksByTab[tabId] = arr
        .map((item) => {
          if (typeof item === "string") {
            return makeCaptureItem({ url: item, source: "legacy" });
          }
          if (item && typeof item === "object") {
            return makeCaptureItem(item);
          }
          return null;
        })
        .filter(Boolean)
        .slice(0, 60);
    }
  }

  if (typeof saved.selectedUrl === "string") state.selectedUrl = saved.selectedUrl;
  if (typeof saved.selectedFromTab === "number" || saved.selectedFromTab === null) {
    state.selectedFromTab = saved.selectedFromTab;
  }
  if (saved.selectedMeta && typeof saved.selectedMeta === "object") {
    state.selectedMeta = saved.selectedMeta;
  }
  if (Array.isArray(saved.history)) {
    state.history = saved.history.filter((x) => x && x.kind === "download").slice(0, 40);
  }
  if (saved.download) state.download = { ...state.download, ...saved.download };
}

function pushHistory(item) {
  const entry = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    at: now(),
    kind: item.kind || "event",
    status: item.status || "",
    url: item.url || "",
    file: item.file || "",
    filePath: item.filePath || "",
    downloadId: typeof item.downloadId === "number" ? item.downloadId : null
  };
  state.history.unshift(entry);
  state.history = state.history.slice(0, 40);
}

function resolveHistoryPath(item) {
  const p1 = String(item?.filePath || "").trim();
  if (p1) return p1;
  const p2 = String(item?.file || "").trim();
  if (p2.startsWith("/")) return p2;
  return "";
}

function ensureTabBucket(tabId) {
  if (!state.linksByTab[tabId]) {
    state.linksByTab[tabId] = [];
  }
  return state.linksByTab[tabId];
}

async function addCapturedLink(tabId, input) {
  const item = makeCaptureItem(input);
  if (!item || !isMediaUrl(item.url)) return;

  const bucket = ensureTabBucket(tabId);
  const idx = bucket.findIndex((x) => x.url === item.url);
  if (idx >= 0) {
    // Preserve existing requestHeaders if new item has none
    const existingHeaders = bucket[idx].requestHeaders;
    bucket[idx] = { ...bucket[idx], ...item, seenAt: now() };
    if (existingHeaders && existingHeaders.length > 0 && (!bucket[idx].requestHeaders || bucket[idx].requestHeaders.length === 0)) {
      bucket[idx].requestHeaders = existingHeaders;
    }
  } else {
    bucket.unshift(item);
  }

  bucket.sort((a, b) => b.seenAt - a.seenAt);
  state.linksByTab[tabId] = bucket.slice(0, 60);
  await persistState();
}

function getBestCaptureForTab(tabId, preferredHost = "") {
  const bucket = state.linksByTab[tabId] || [];
  if (!bucket.length) return null;

  const freshCutoff = now() - 3 * 60 * 1000;
  const sameHost = bucket.filter((item) => isItemRelatedToHost(item, preferredHost));
  const freshSameHost = sameHost.filter((item) => (item.seenAt || 0) >= freshCutoff);
  const freshAnyHost = bucket.filter((item) => (item.seenAt || 0) >= freshCutoff);

  const base = freshSameHost.length
    ? freshSameHost
    : (sameHost.length ? sameHost : (freshAnyHost.length ? freshAnyHost : bucket));

  const ranked = [...base].sort((a, b) => {
    const sa = scoreMediaUrl(a.url);
    const sb = scoreMediaUrl(b.url);
    if (sb !== sa) return sb - sa;
    return (b.seenAt || 0) - (a.seenAt || 0);
  });

  return ranked[0] || null;
}

function sanitizeFilenameFromUrl(url) {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname || "";
    const last = pathname.split("/").filter(Boolean).pop() || "video.mp4";
    const decoded = decodeURIComponent(last);
    if (decoded.includes(".")) return decoded;
    return `${decoded}.mp4`;
  } catch {
    return `video_${Date.now()}.mp4`;
  }
}

function sq(value) {
  return `'${String(value || "").replace(/'/g, `'\"'\"'`)}'`;
}

async function getCookiesForUrl(url) {
  try {
    const cookies = await chrome.cookies.getAll({ url });
    return (cookies || []).map((c) => `${c.name}=${c.value}`);
  } catch {
    return [];
  }
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

async function buildCurlPayload() {
  if (!state.selectedUrl) {
    throw new Error("No link available to export cURL.");
  }

  const referer = state.selectedMeta?.referer || "";
  let tabUrl = "";
  if (typeof state.selectedFromTab === "number") {
    try {
      const tab = await chrome.tabs.get(state.selectedFromTab);
      tabUrl = tab?.url || "";
    } catch {
      tabUrl = "";
    }
  }

  const cookiePairs = uniq([
    ...(await getCookiesForUrl(state.selectedUrl)),
    ...(referer ? await getCookiesForUrl(referer) : []),
    ...(tabUrl ? await getCookiesForUrl(tabUrl) : [])
  ]);

  const cookieHeader = cookiePairs.join("; ");
  const output = sanitizeFilenameFromUrl(state.selectedUrl).replace(/\.mp4$/i, ".full.mp4");
  const effectiveReferer = referer || tabUrl || "https://us06web.zoom.us/";
  const headers = [
    "Accept: */*",
    "Accept-Language: en,vi;q=0.9",
    "Cache-Control: no-cache",
    "Pragma: no-cache",
    `Referer: ${effectiveReferer}`,
    "Sec-Fetch-Dest: video",
    "Sec-Fetch-Mode: no-cors",
    "Sec-Fetch-Site: same-site",
    "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
    'sec-ch-ua: "Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
    "sec-ch-ua-mobile: ?0",
    'sec-ch-ua-platform: "macOS"'
  ];

  return {
    url: state.selectedUrl,
    output,
    cookieHeader,
    headers,
    referer: effectiveReferer
  };
}

async function buildCurlCommand() {
  const payload = await buildCurlPayload();

  const parts = [
    `curl ${sq(payload.url)} \\`
  ];

  for (const h of payload.headers) {
    parts.push(`  -H ${sq(h)} \\`);
  }

  if (payload.cookieHeader) {
    parts.push(`  -b ${sq(payload.cookieHeader)} \\`);
  }
  parts.push(`  -o ${sq(payload.output)}`);

  return parts.join("\n");
}

async function collectPageVideoUrls(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const out = [];

        const toAbs = (value) => {
          try {
            return new URL(value, window.location.href).toString();
          } catch {
            return "";
          }
        };

        const pushUrl = (u) => {
          const normalized = toAbs(u);
          if (!normalized) return;
          if (!out.includes(normalized)) out.push(normalized);
        };

        for (const v of document.querySelectorAll("video")) {
          if (v.currentSrc) pushUrl(v.currentSrc);
          if (v.src) pushUrl(v.src);
        }

        for (const s of document.querySelectorAll("video source")) {
          if (s.src) pushUrl(s.src);
        }

        return out;
      }
    });

    const all = [];
    for (const r of results || []) {
      if (Array.isArray(r.result)) all.push(...r.result);
    }
    return [...new Set(all)].filter(Boolean);
  } catch {
    return [];
  }
}

async function openUrlFromTabContext(tabId, url) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      args: [url],
      func: (u) => {
        const a = document.createElement("a");
        a.href = u;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    });
    return true;
  } catch {
    return false;
  }
}

async function broadcastState() {
  const snapshot = await getPopupState();
  try {
    await chrome.runtime.sendMessage({ type: "STATE_UPDATE", payload: snapshot });
  } catch {
    // Popup may be closed.
  }
}

async function getPopupState() {
  return {
    selectedUrl: state.selectedUrl,
    selectedFromTab: state.selectedFromTab,
    selectedMeta: state.selectedMeta,
    history: state.history,
    download: state.download,
    linksByTab: state.linksByTab
  };
}

async function configureSidePanel() {
  try {
    if (chrome.sidePanel?.setPanelBehavior) {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }
  } catch {
    // ignore
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await hydrateState();
  await configureSidePanel();
  await persistState();
});

chrome.runtime.onStartup.addListener(async () => {
  await hydrateState();
  await configureSidePanel();
});

hydrateState();
configureSidePanel();

chrome.webRequest.onBeforeRequest.addListener(
  async (details) => {
    const tabId = details.tabId;
    if (tabId < 0) return;
    await addCapturedLink(tabId, {
      url: details.url,
      initiator: details.initiator || "",
      documentUrl: details.documentUrl || "",
      type: details.type || "",
      source: "network"
    });
    await broadcastState();
  },
  { urls: ["<all_urls>"] }
);

// Capture request headers from media requests for replay
chrome.webRequest.onSendHeaders.addListener(
  (details) => {
    const tabId = details.tabId;
    if (tabId < 0) return;
    if (!isMediaUrl(details.url)) return;

    // Store headers for this URL so we can replay exact request
    const bucket = ensureTabBucket(tabId);
    const idx = bucket.findIndex((x) => x.url === normalizeUrl(details.url));
    if (idx >= 0) {
      bucket[idx].requestHeaders = details.requestHeaders || [];
      console.log("[HEADERS] Captured", details.requestHeaders?.length, "headers for:", details.url?.slice(0, 80));
    }
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders"]
);

chrome.downloads.onCreated.addListener(async (item) => {
  if (state.download.id !== item.id) return;
  state.download.filename = item.filename || state.download.filename;
  state.download.totalBytes = item.totalBytes > 0 ? item.totalBytes : state.download.totalBytes;
  await persistState();
  await broadcastState();
});

chrome.downloads.onChanged.addListener(async (delta) => {
  if (state.download.id !== delta.id) return;

  if (delta.totalBytes && typeof delta.totalBytes.current === "number") {
    state.download.totalBytes = delta.totalBytes.current;
  }

  if (delta.bytesReceived && typeof delta.bytesReceived.current === "number") {
    state.download.receivedBytes = delta.bytesReceived.current;
  }

  if (delta.state) {
    if (delta.state.current === "in_progress") state.download.status = "downloading";
    if (delta.state.current === "complete") {
      state.download.status = "complete";
      state.download.endedAt = now();
    }
    if (delta.state.current === "interrupted") {
      state.download.status = "error";
      state.download.endedAt = now();
    }
  }

  if (delta.error && delta.error.current) {
    state.download.error = delta.error.current;
    state.download.status = "error";
    state.download.endedAt = now();
  }

  await persistState();
  await broadcastState();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (!msg || !msg.type) {
      sendResponse({ ok: false, error: "Invalid message" });
      return;
    }

    if (msg.type === "GET_STATE") {
      const snapshot = await getPopupState();
      sendResponse({ ok: true, state: snapshot });
      return;
    }

    if (msg.type === "CHECK_NATIVE_HOST") {
      try {
        const probe = await chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, { action: "ping" });
        sendResponse({ ok: true, installed: true, probe: probe || null });
      } catch (err) {
        const raw = String(err?.message || err || "Native host unavailable");
        const missing =
          raw.includes("Specified native messaging host not found") ||
          raw.includes("Native host has exited") ||
          raw.includes("Native host disconnected") ||
          raw.includes("Could not establish connection");
        sendResponse({ ok: true, installed: false, missing, error: raw });
      }
      return;
    }

    if (msg.type === "CAPTURE_FROM_ACTIVE_TAB") {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || typeof tab.id !== "number") {
        sendResponse({ ok: false, error: "No active tab" });
        return;
      }

      const domUrls = await collectPageVideoUrls(tab.id);
      for (const u of domUrls) {
        await addCapturedLink(tab.id, {
          url: u,
          initiator: tab.url || "",
          documentUrl: tab.url || "",
          type: "media",
          source: "dom"
        });
      }

      const host = safeHostname(tab.url || "");
      const best = getBestCaptureForTab(tab.id, host);
      if (!best) {
        sendResponse({
          ok: false,
          error: "No valid video URL detected yet. Play the video for 2-3 seconds and capture again."
        });
        return;
      }

      state.selectedUrl = best.url;
      state.selectedFromTab = tab.id;
      state.selectedMeta = {
        referer: best.documentUrl || best.initiator || tab.url || "",
        source: best.source || "network",
        type: best.type || "",
        score: scoreMediaUrl(best.url)
      };

      await persistState();
      await broadcastState();

      sendResponse({
        ok: true,
        url: state.selectedUrl,
        pickedFrom: state.selectedMeta.source,
        score: state.selectedMeta.score
      });
      return;
    }

    if (msg.type === "SMART_DOWNLOAD") {
      if (!state.selectedUrl) {
        sendResponse({ ok: false, error: "No link available to download." });
        return;
      }
      if (!/^https?:\/\//i.test(state.selectedUrl)) {
        sendResponse({ ok: false, error: "Invalid download URL." });
        return;
      }

      const filename = sanitizeFilenameFromUrl(state.selectedUrl);

      state.download = {
        id: null,
        status: "starting",
        filename,
        openPath: "",
        progressPct: 0,
        totalBytes: 0,
        receivedBytes: 0,
        error: "",
        startedAt: now(),
        endedAt: 0
      };
      await persistState();
      await broadcastState();

      // --- Strategy 1: Native host (Go binary — reliable, full download) ---
      console.log("[SMART_DOWNLOAD] Strategy 1: native host");
      try {
        const payload = await buildCurlPayload();
        state.download.filename = payload.output;
        await persistState();
        await broadcastState();

        const nativeRes = await new Promise((resolve, reject) => {
          const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
          let settled = false;

          const finish = (err, data) => {
            if (settled) return;
            settled = true;
            try { port.disconnect(); } catch {}
            if (err) reject(err);
            else resolve(data);
          };

          const timeout = setTimeout(() => {
            finish(new Error("Native download timeout"));
          }, 1000 * 60 * 60);

          port.onMessage.addListener(async (msg) => {
            if (!msg || typeof msg !== "object") return;
            if (msg.type === "progress") {
              const pct = Number(msg.percent);
              if (Number.isFinite(pct)) {
                state.download.status = "downloading";
                state.download.progressPct = Math.max(0, Math.min(100, Math.floor(pct)));
                await persistState();
                await broadcastState();
              }
              return;
            }
            if (msg.type === "result") {
              clearTimeout(timeout);
              finish(null, msg);
            }
          });

          port.onDisconnect.addListener(() => {
            const err = chrome.runtime.lastError;
            if (err) {
              clearTimeout(timeout);
              finish(new Error(err.message || "Native host disconnected"));
            }
          });

          try {
            port.postMessage({ action: "download_with_curl_stream", payload });
          } catch (e) {
            clearTimeout(timeout);
            finish(new Error(String(e?.message || e)));
          }
        });

        if (nativeRes?.ok) {
          state.download.status = "complete";
          state.download.filename = nativeRes.output || payload.output;
          state.download.openPath = nativeRes.absOutput || "";
          state.download.progressPct = 100;
          state.download.endedAt = now();
          pushHistory({
            kind: "download",
            status: "complete",
            url: state.selectedUrl,
            file: state.download.openPath || state.download.filename,
            filePath: state.download.openPath || ""
          });
          await persistState();
          await broadcastState();
          sendResponse({ ok: true, method: "native_host", output: state.download.filename });
          return;
        }
        throw new Error(nativeRes?.error || "Native host failed");
      } catch (nativeErr) {
        const nativeErrMsg = String(nativeErr?.message || nativeErr || "");
        console.log("[SMART_DOWNLOAD] Strategy 1 failed:", nativeErrMsg);

        const missingNative =
          nativeErrMsg.includes("Specified native messaging host not found") ||
          nativeErrMsg.includes("Native host has exited") ||
          nativeErrMsg.includes("Native host disconnected") ||
          nativeErrMsg.includes("Could not establish connection");

        if (missingNative) {
          // Native host not installed → show setup instructions and fallback
          state.download.status = "error";
          state.download.error = "Helper not installed. One-time setup required.";
          state.download.endedAt = now();
          await persistState();
          await broadcastState();
          sendResponse({
            ok: false,
            error: "Helper not installed. One-time setup required (30 seconds).",
            needsSetup: true
          });
          return;
        }
        // Other native error → cascade to fallback
      }

      // --- Strategy 2: Open URL in tab context (fallback) ---
      console.log("[SMART_DOWNLOAD] Strategy 2: open in tab");
      if (typeof state.selectedFromTab === "number") {
        const opened = await openUrlFromTabContext(state.selectedFromTab, state.selectedUrl);
        if (opened) {
          state.download.status = "open_in_tab";
          state.download.endedAt = now();
          await persistState();
          await broadcastState();
          sendResponse({
            ok: true,
            method: "open_tab",
            note: "Opened direct link in browser. File may be incomplete — install Native Host for reliable downloads."
          });
          return;
        }
      }

      state.download.status = "error";
      state.download.error = "Download failed. Install Helper for reliable downloads.";
      state.download.endedAt = now();
      await persistState();
      await broadcastState();
      sendResponse({ ok: false, error: state.download.error, needsSetup: true });
      return;
    }

    if (msg.type === "DOWNLOAD_SELECTED") {
      if (!state.selectedUrl) {
        sendResponse({ ok: false, error: "No link available to download." });
        return;
      }

      if (!/^https?:\/\//i.test(state.selectedUrl)) {
        sendResponse({ ok: false, error: "Invalid download URL." });
        return;
      }

      const filename = sanitizeFilenameFromUrl(state.selectedUrl);

      state.download = {
        id: null,
        status: "starting",
        filename,
        openPath: "",
        progressPct: 0,
        totalBytes: 0,
        receivedBytes: 0,
        error: "",
        startedAt: now(),
        endedAt: 0
      };
      await persistState();
      await broadcastState();

      try {
        const options = {
          url: state.selectedUrl,
          filename,
          saveAs: false,
          conflictAction: "uniquify"
        };

        const id = await chrome.downloads.download(options);

        state.download.id = id;
        state.download.status = "downloading";
        await persistState();
        await broadcastState();

        sendResponse({ ok: true, id });
      } catch (err) {
        const rawErr = String(err?.message || err || "Download failed");

        if (rawErr.includes("SERVER_FORBIDDEN") && typeof state.selectedFromTab === "number") {
          const opened = await openUrlFromTabContext(state.selectedFromTab, state.selectedUrl);
          if (opened) {
            state.download.status = "open_in_tab";
            state.download.error = "SERVER_FORBIDDEN";
            state.download.endedAt = now();
            await persistState();
            await broadcastState();
            sendResponse({
              ok: true,
              fallback: "open_tab",
              note: "Server blocked extension download, opened direct link in tab context."
            });
            return;
          }
        }

        state.download.status = "error";
        state.download.error = rawErr;
        state.download.endedAt = now();
        await persistState();
        await broadcastState();
        sendResponse({ ok: false, error: state.download.error });
      }
      return;
    }

    if (msg.type === "CHECK_FILE_EXISTS") {
      if (!state.selectedUrl) {
        sendResponse({ ok: true, exists: false });
        return;
      }
      const filename = sanitizeFilenameFromUrl(state.selectedUrl).replace(/\.mp4$/i, ".full.mp4");
      try {
        const nativeRes = await chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, {
          action: "file_exists",
          path: filename
        });
        sendResponse({ ok: true, exists: !!nativeRes?.exists, filename, absPath: nativeRes?.absPath || "" });
      } catch {
        // Native host not available — can't check, proceed with download
        sendResponse({ ok: true, exists: false, filename });
      }
      return;
    }

    if (msg.type === "DOWNLOAD_WITH_NATIVE_CURL") {
      if (!state.selectedUrl) {
        sendResponse({ ok: false, error: "No link available to download." });
        return;
      }
      if (!/^https?:\/\//i.test(state.selectedUrl)) {
        sendResponse({ ok: false, error: "Invalid download URL." });
        return;
      }

      let sawProgress = false;
      try {
        const payload = await buildCurlPayload();
        state.download = {
          id: null,
          status: "starting",
          filename: payload.output,
          openPath: "",
          progressPct: 0,
          totalBytes: 0,
          receivedBytes: 0,
          error: "",
          startedAt: now(),
          endedAt: 0
        };
        await persistState();
        await broadcastState();

        const nativeRes = await new Promise((resolve, reject) => {
          const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
          let settled = false;

          const finish = (err, data) => {
            if (settled) return;
            settled = true;
            try {
              port.disconnect();
            } catch {
              // ignore
            }
            if (err) reject(err);
            else resolve(data);
          };

          const timeout = setTimeout(() => {
            finish(new Error("Native cURL timeout"));
          }, 1000 * 60 * 60);

          port.onMessage.addListener(async (msg) => {
            if (!msg || typeof msg !== "object") return;

            if (msg.type === "progress") {
              const pct = Number(msg.percent);
              if (Number.isFinite(pct)) {
                sawProgress = true;
                state.download.status = "downloading";
                state.download.progressPct = Math.max(0, Math.min(100, Math.floor(pct)));
                await persistState();
                await broadcastState();
              }
              return;
            }

            if (msg.type === "result") {
              clearTimeout(timeout);
              finish(null, msg);
            }
          });

          port.onDisconnect.addListener(() => {
            const err = chrome.runtime.lastError;
            if (err) {
              clearTimeout(timeout);
              finish(new Error(err.message || "Native host disconnected"));
            }
          });

          try {
            port.postMessage({ action: "download_with_curl_stream", payload });
          } catch (e) {
            clearTimeout(timeout);
            finish(new Error(String(e?.message || e)));
          }
        });

        if (!nativeRes || !nativeRes.ok) {
          throw new Error(nativeRes?.error || "Native host failed");
        }

        state.download.status = "complete";
        state.download.filename = nativeRes.output || payload.output;
        state.download.openPath = nativeRes.absOutput || "";
        state.download.progressPct = 100;
        state.download.endedAt = now();
        pushHistory({
          kind: "download",
          status: "complete",
          url: state.selectedUrl,
          file: state.download.openPath || state.download.filename,
          filePath: state.download.openPath || ""
        });
        await persistState();
        await broadcastState();

        sendResponse({
          ok: true,
          output: state.download.filename,
          stdout: nativeRes.stdout || "",
          stderr: nativeRes.stderr || ""
        });
      } catch (err) {
        state.download.status = "error";
        state.download.error = String(err?.message || err || "Native cURL failed");
        state.download.endedAt = now();
        if (sawProgress) {
          pushHistory({ kind: "download", status: "error", url: state.selectedUrl, file: state.download.filename });
        }
        await persistState();
        await broadcastState();
        sendResponse({ ok: false, error: state.download.error });
      }
      return;
    }

    if (msg.type === "EXPORT_CURL") {
      try {
        const command = await buildCurlCommand();
        sendResponse({ ok: true, command });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err || "Export failed") });
      }
      return;
    }

    if (msg.type === "SHOW_DOWNLOADED_FILE") {
      try {
        if (state.download.id) {
          await chrome.downloads.show(state.download.id);
          sendResponse({ ok: true });
          return;
        }

        if (state.download.openPath) {
          const nativeRes = await chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, {
            action: "reveal_file",
            path: state.download.openPath
          });
          if (nativeRes?.ok) {
            sendResponse({ ok: true });
          } else {
            sendResponse({ ok: false, error: nativeRes?.error || "Failed to open file via native host." });
          }
          return;
        }

        sendResponse({ ok: false, error: "No downloaded file available yet." });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err || "Cannot open file") });
      }
      return;
    }

    if (msg.type === "OPEN_HISTORY_ITEM") {
      const id = String(msg.id || "");
      const item = state.history.find((x) => x.id === id);
      if (!item) {
        sendResponse({ ok: false, error: "History item not found." });
        return;
      }

      try {
        if (typeof item.downloadId === "number") {
          await chrome.downloads.show(item.downloadId);
          sendResponse({ ok: true });
          return;
        }

        const historyPath = resolveHistoryPath(item);
        if (historyPath) {
          const nativeRes = await chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, {
            action: "reveal_file",
            path: historyPath
          });
          if (nativeRes?.ok) sendResponse({ ok: true });
          else sendResponse({ ok: false, error: nativeRes?.error || "Failed to open file." });
          return;
        }
        sendResponse({ ok: false, error: "This history item has no file path to open." });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err || "Cannot open item") });
      }
      return;
    }

    if (msg.type === "CHECK_HISTORY_EXISTS") {
      const ids = Array.isArray(msg.ids) ? msg.ids.map(String) : [];
      const out = {};

      for (const id of ids) {
        const item = state.history.find((x) => x.id === id);
        if (!item) {
          out[id] = false;
          continue;
        }

        try {
          if (typeof item.downloadId === "number") {
            const rows = await chrome.downloads.search({ id: item.downloadId });
            const one = Array.isArray(rows) ? rows[0] : null;
            out[id] = !!(one && one.exists !== false);
            continue;
          }

          const historyPath = resolveHistoryPath(item);
          if (historyPath) {
            const nativeRes = await chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, {
              action: "file_exists",
              path: historyPath
            });
            out[id] = !!nativeRes?.exists;
            continue;
          }

          out[id] = false;
        } catch {
          out[id] = false;
        }
      }

      sendResponse({ ok: true, existsById: out });
      return;
    }

    if (msg.type === "RESET_STATE") {
      state.linksByTab = {};
      state.selectedUrl = "";
      state.selectedFromTab = null;
      state.selectedMeta = null;
        state.download = {
          id: null,
          status: "idle",
          filename: "",
          openPath: "",
          progressPct: 0,
          totalBytes: 0,
          receivedBytes: 0,
        error: "",
        startedAt: 0,
        endedAt: 0
      };
      await persistState();
      await broadcastState();
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false, error: "Unknown action" });
  })();

  return true;
});
