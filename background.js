// Background worker. Decides when a sync is due, asks the page for the list
// of chats and for each changed chat, renders Markdown and saves it with the
// downloads API. State lives in chrome.storage.local so it survives the
// worker being put to sleep.

import { SERVICES, chatToMarkdown, chatFileName, cleanFolder } from "./markdown.js";

const DEFAULT_SETTINGS = {
  folder: "Chatkeep",
  autoSync: true,
  minGapMinutes: 10,
  saveJson: false,
  delayMs: 400,
};

const BADGE_BLUE = "#2f5d8a";
const BADGE_RED = "#a3312a";

// ---- storage ----

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

async function getRecord(service) {
  const key = "svc:" + service;
  const data = await chrome.storage.local.get(key);
  return data[key] || { lastSync: "", lastResult: null, chats: {} };
}

async function putRecord(service, record) {
  await chrome.storage.local.set({ ["svc:" + service]: record });
}

async function getProgress() {
  const { progress } = await chrome.storage.session.get("progress");
  return progress || {};
}

async function setProgress(service, value) {
  const progress = await getProgress();
  if (value) progress[service] = value;
  else delete progress[service];
  await chrome.storage.session.set({ progress });
  const remaining = Object.values(progress).reduce((sum, p) => sum + Math.max(0, p.total - p.done), 0);
  const running = Object.keys(progress).length > 0;
  await chrome.action.setBadgeBackgroundColor({ color: BADGE_BLUE });
  await chrome.action.setBadgeText({ text: running ? (remaining > 0 ? String(remaining) : "…") : "" });
}

async function flagError(on) {
  if (on) {
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_RED });
    await chrome.action.setBadgeText({ text: "!" });
  }
}

// ---- talking to the page ----

async function ask(tabId, message, serviceName) {
  let response;
  try {
    response = await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    throw new Error("Lost the " + serviceName + " tab. Keep it open while the copy is being made.");
  }
  if (!response) throw new Error("No answer from the " + serviceName + " page.");
  if (!response.ok) throw new Error(response.error);
  return response.result;
}

// ---- saving files ----

const pendingDownloads = new Map();

chrome.downloads.onChanged.addListener((delta) => {
  const pending = pendingDownloads.get(delta.id);
  if (!pending || !delta.state) return;
  if (delta.state.current === "complete") {
    pendingDownloads.delete(delta.id);
    pending.resolve();
    // The file stays on disk; drop the entry so hundreds of chats do not
    // fill the browser's download list.
    chrome.downloads.erase({ id: delta.id });
  } else if (delta.state.current === "interrupted") {
    pendingDownloads.delete(delta.id);
    pending.reject(new Error("Download interrupted: " + ((delta.error && delta.error.current) || "unknown")));
  }
});

function download(filename, text, mime) {
  const url = "data:" + mime + ";charset=utf-8," + encodeURIComponent(text);
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url, filename, conflictAction: "overwrite", saveAs: false }, (id) => {
      if (chrome.runtime.lastError || id === undefined) {
        reject(new Error((chrome.runtime.lastError && chrome.runtime.lastError.message) || "Download refused"));
        return;
      }
      pendingDownloads.set(id, { resolve, reject });
      // The download may already be done for a small file.
      chrome.downloads.search({ id }, (items) => {
        const item = items && items[0];
        if (item && item.state === "complete" && pendingDownloads.delete(id)) {
          chrome.downloads.erase({ id });
          resolve();
        }
        if (item && item.state === "interrupted" && pendingDownloads.delete(id)) reject(new Error("Download interrupted: " + (item.error || "unknown")));
      });
      setTimeout(() => {
        if (pendingDownloads.delete(id)) resolve();
      }, 30000);
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the sync itself ----

async function runSync(service, tabId, reason) {
  const meta = SERVICES[service];
  if (!meta) return;
  if ((await getProgress())[service]) return; // already running

  await setProgress(service, { total: 0, done: 0, startedAt: new Date().toISOString(), reason });
  const settings = await getSettings();
  const record = await getRecord(service);
  const result = { saved: 0, unchanged: 0, skipped: 0, failed: 0, error: "", at: "" };
  const folder = cleanFolder(settings.folder);

  try {
    const listed = await ask(tabId, { type: "list" }, meta.name);
    const todo = listed.filter((c) => {
      const known = record.chats[c.id];
      return !known || known.updatedAt !== c.updatedAt;
    });
    result.unchanged = listed.length - todo.length;
    await setProgress(service, { total: todo.length, done: 0, startedAt: new Date().toISOString(), reason });

    const taken = new Set(Object.values(record.chats).map((c) => c.file).filter(Boolean));
    let done = 0;
    for (const summary of todo) {
      try {
        const chat = await ask(tabId, { type: "get", id: summary.id }, meta.name);
        const known = record.chats[chat.id] || {};
        if (chat.messages.length === 0) {
          record.chats[chat.id] = { updatedAt: summary.updatedAt, title: chat.title, file: known.file || "" };
          result.skipped++;
        } else {
          const file = known.file || chatFileName(chat, taken);
          taken.add(file);
          await download(folder + "/" + file, chatToMarkdown(chat), "text/markdown");
          if (settings.saveJson) await download(folder + "/" + file.replace(/\.md$/, ".json"), JSON.stringify(chat, null, 2), "application/json");
          record.chats[chat.id] = { updatedAt: summary.updatedAt, title: chat.title, file };
          result.saved++;
        }
      } catch (error) {
        result.failed++;
        result.error = error.message;
        if (/signed in|slow down|Lost the|refused/.test(error.message)) throw error;
      }
      done++;
      await setProgress(service, { total: todo.length, done, startedAt: new Date().toISOString(), reason });
      await putRecord(service, record); // keep progress if the browser closes mid-way
      await sleep(settings.delayMs);
    }
  } catch (error) {
    result.error = error.message;
  }

  result.at = new Date().toISOString();
  record.lastSync = result.at;
  record.lastResult = result;
  await putRecord(service, record);
  await setProgress(service, null);
  if (result.error) await flagError(true);
}

async function syncIsDue(service) {
  const { manual } = await chrome.storage.session.get("manual");
  if (manual && manual[service]) {
    delete manual[service];
    await chrome.storage.session.set({ manual });
    return true;
  }
  const settings = await getSettings();
  if (!settings.autoSync) return false;
  const record = await getRecord(service);
  if (!record.lastSync) return true;
  return Date.now() - new Date(record.lastSync).getTime() > settings.minGapMinutes * 60 * 1000;
}

async function markManual(service) {
  const { manual } = await chrome.storage.session.get("manual");
  await chrome.storage.session.set({ manual: { ...(manual || {}), [service]: true } });
}

// "Sync now" from the popup: use an open tab of the site, or open one.
async function syncNow(service) {
  const meta = SERVICES[service];
  const tabs = await chrome.tabs.query({ url: meta.home + "*" });
  for (const tab of tabs) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: "ping" });
      if (response && response.ok) {
        runSync(service, tab.id, "manual");
        return { started: true };
      }
    } catch (_) {
      // Tab predates the install; no content script yet.
    }
  }
  await markManual(service);
  if (tabs.length > 0) {
    await chrome.tabs.reload(tabs[0].id);
    return { started: false, opened: false };
  }
  await chrome.tabs.create({ url: meta.home, active: true });
  return { started: false, opened: true };
}

async function status() {
  const settings = await getSettings();
  const progress = await getProgress();
  const services = {};
  for (const id of Object.keys(SERVICES)) {
    const record = await getRecord(id);
    services[id] = {
      name: SERVICES[id].name,
      home: SERVICES[id].home,
      lastSync: record.lastSync,
      lastResult: record.lastResult,
      count: Object.values(record.chats).filter((c) => c.file).length,
    };
  }
  return { settings, services, progress };
}

// ---- messages ----

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  if (message.type === "page-ready" && sender.tab && SERVICES[message.service]) {
    syncIsDue(message.service).then((due) => {
      if (due) runSync(message.service, sender.tab.id, "auto");
    });
    return false;
  }
  if (message.type === "status") {
    status().then(sendResponse);
    return true;
  }
  if (message.type === "sync-now" && SERVICES[message.service]) {
    syncNow(message.service).then(sendResponse);
    return true;
  }
  if (message.type === "save-settings") {
    const clean = { ...DEFAULT_SETTINGS, ...(message.settings || {}) };
    clean.folder = cleanFolder(clean.folder);
    clean.minGapMinutes = Math.max(0, Number(clean.minGapMinutes) || 0);
    clean.autoSync = Boolean(clean.autoSync);
    clean.saveJson = Boolean(clean.saveJson);
    clean.delayMs = DEFAULT_SETTINGS.delayMs;
    chrome.storage.local.set({ settings: clean }).then(() => sendResponse({ ok: true, settings: clean }));
    return true;
  }
  if (message.type === "open-folder") {
    chrome.downloads.showDefaultFolder();
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === "forget" && SERVICES[message.service]) {
    putRecord(message.service, { lastSync: "", lastResult: null, chats: {} }).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === "install") {
    const { settings } = await chrome.storage.local.get("settings");
    if (!settings) await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  }
});
