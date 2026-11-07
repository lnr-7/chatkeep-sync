// Markdown rendering and file naming. Same layout as Chatkeep's export, so
// files from both tools read alike.

export const SERVICES = {
  claude: { name: "Claude", home: "https://claude.ai/" },
  chatgpt: { name: "ChatGPT", home: "https://chatgpt.com/" },
};

export function chatToMarkdown(chat) {
  const service = SERVICES[chat.service] ? SERVICES[chat.service].name : chat.service;
  const lines = [`# ${chat.title}`, ""];
  const meta = [`Source: ${service}`];
  if (chat.url) meta.push(`Link: ${chat.url}`);
  if (chat.createdAt) meta.push(`Started: ${chat.createdAt}`);
  if (chat.updatedAt && chat.updatedAt !== chat.createdAt) meta.push(`Last message: ${chat.updatedAt}`);
  lines.push(meta.join("  \n"), "");
  for (const message of chat.messages) {
    const who = message.role === "user" ? "You" : service;
    const when = message.at ? ` (${message.at})` : "";
    lines.push(`## ${who}${when}`, "", message.text, "");
  }
  return lines.join("\n");
}

export function fileSafeName(name, fallback = "chat") {
  const safe = String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return safe || fallback;
}

// `<service>/<yyyy-mm-dd>-<title>.md`, unique among `taken`.
export function chatFileName(chat, taken = new Set()) {
  const day = chat.createdAt ? chat.createdAt.slice(0, 10) : "undated";
  const base = `${chat.service}/${day}-${fileSafeName(chat.title)}`;
  let name = `${base}.md`;
  let n = 2;
  while (taken.has(name)) name = `${base}-${n++}.md`;
  return name;
}

// A folder name the downloads API accepts on every platform.
export function cleanFolder(name) {
  const safe = String(name ?? "")
    .replace(/[<>:"|?*\\]/g, "")
    .split("/")
    .map((part) => part.trim().replace(/\.+$/, ""))
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
  return safe || "Chatkeep";
}
