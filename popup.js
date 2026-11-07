// Popup: shows each service's last copy, starts one by hand, edits settings.

const servicesEl = document.getElementById("services");
const notesEl = document.getElementById("notes");
const form = document.getElementById("settings-form");
const folderPath = document.getElementById("folder-path");
const savedEl = document.getElementById("saved");

const send = (message) => chrome.runtime.sendMessage(message);

function ago(iso) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return min + " min ago";
  const h = Math.round(min / 60);
  if (h < 24) return h + (h === 1 ? " hour ago" : " hours ago");
  const d = Math.round(h / 24);
  return d + (d === 1 ? " day ago" : " days ago");
}

function stateText(service, progress) {
  if (progress) {
    if (progress.total === 0) return { text: "Looking for changes…", cls: "is-busy" };
    return { text: "Saving " + (progress.done + 1 > progress.total ? progress.total : progress.done + 1) + " of " + progress.total + "…", cls: "is-busy" };
  }
  const r = service.lastResult;
  if (!r) return { text: "Not copied yet. Open " + service.name + " or press Copy now.", cls: "" };
  if (r.error) return { text: r.error, cls: "is-error" };
  let text = r.saved === 0 ? "Nothing new " + ago(r.at) : r.saved + (r.saved === 1 ? " chat saved " : " chats saved ") + ago(r.at);
  if (r.failed) text += ", " + r.failed + " failed";
  return { text: text + ". " + service.count + " on disk.", cls: "" };
}

let busy = new Set();

function render(status) {
  servicesEl.textContent = "";
  const errors = [];
  for (const [id, service] of Object.entries(status.services)) {
    const progress = status.progress[id];
    const row = document.createElement("div");
    row.className = "service";
    const name = document.createElement("div");
    name.className = "service-name";
    name.textContent = service.name;
    const state = document.createElement("div");
    const s = stateText(service, progress);
    state.className = "service-state " + s.cls;
    state.textContent = s.text;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn";
    button.textContent = progress ? "Saving…" : "Copy now";
    button.disabled = Boolean(progress) || busy.has(id);
    button.addEventListener("click", async () => {
      busy.add(id);
      button.disabled = true;
      const answer = await send({ type: "sync-now", service: id });
      if (answer && answer.opened) window.close();
      busy.delete(id);
      refresh();
    });
    row.append(name, button, state);
    if (progress && progress.total > 0) {
      const bar = document.createElement("div");
      bar.className = "progress";
      const fill = document.createElement("i");
      fill.style.width = Math.round((progress.done / progress.total) * 100) + "%";
      bar.append(fill);
      row.append(bar);
    }
    servicesEl.append(row);
    if (service.lastResult && service.lastResult.error && /signed in/i.test(service.lastResult.error)) {
      errors.push("Sign in to " + service.name + " in this browser, then open the site again.");
    }
  }
  notesEl.hidden = errors.length === 0;
  notesEl.textContent = errors.join(" ");
  folderPath.textContent = "Downloads/" + status.settings.folder;
}

function fillSettings(settings) {
  form.folder.value = settings.folder;
  form.autoSync.checked = settings.autoSync;
  form.minGapMinutes.value = settings.minGapMinutes;
  form.saveJson.checked = settings.saveJson;
}

async function refresh() {
  const status = await send({ type: "status" });
  if (!status) return;
  render(status);
  if (!form.dataset.filled) {
    fillSettings(status.settings);
    form.dataset.filled = "1";
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const answer = await send({
    type: "save-settings",
    settings: {
      folder: form.folder.value,
      autoSync: form.autoSync.checked,
      minGapMinutes: form.minGapMinutes.value,
      saveJson: form.saveJson.checked,
    },
  });
  if (answer && answer.settings) fillSettings(answer.settings);
  savedEl.hidden = false;
  setTimeout(() => (savedEl.hidden = true), 1500);
  refresh();
});

document.getElementById("open-folder").addEventListener("click", () => send({ type: "open-folder" }));

chrome.storage.onChanged.addListener(() => refresh());
refresh();
