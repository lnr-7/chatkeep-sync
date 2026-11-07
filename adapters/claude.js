// Claude (claude.ai). Uses the same conversation endpoints the page uses.
// The detail response has the same shape as Claude's official export
// (`chat_messages` with `sender` and `content` blocks), so the normalizer
// matches Chatkeep's importer.

(function (NS) {
  const PAGE = 100;
  let orgCache = "";

  async function orgId() {
    if (orgCache) return orgCache;
    const fromCookie = NS.cookie("lastActiveOrg");
    if (fromCookie) return (orgCache = fromCookie);
    const orgs = await NS.getJson("/api/organizations");
    if (!Array.isArray(orgs) || orgs.length === 0) throw new Error("No Claude account found; are you signed in?");
    const chatOrg = orgs.find((o) => Array.isArray(o.capabilities) && o.capabilities.includes("chat")) || orgs[0];
    return (orgCache = chatOrg.uuid);
  }

  function blockText(block) {
    if (!block || typeof block !== "object") return "";
    if (block.type === "text" && typeof block.text === "string") return block.text;
    return "";
  }

  function messageText(message) {
    const parts = [];
    if (Array.isArray(message.content) && message.content.length > 0) {
      for (const block of message.content) {
        const text = blockText(block);
        if (text) parts.push(text);
      }
    }
    if (parts.length === 0 && typeof message.text === "string") parts.push(message.text);
    for (const attachment of message.attachments || []) {
      if (attachment && attachment.file_name) parts.push("[attached: " + attachment.file_name + "]");
    }
    for (const file of message.files || []) {
      if (file && file.file_name) parts.push("[file: " + file.file_name + "]");
    }
    return parts.join("\n\n");
  }

  // One conversation object (list entry or detail) to the summary the
  // background uses to decide what changed.
  function summarize(conv) {
    return {
      id: conv.uuid,
      title: NS.tidy(conv.name) || "Untitled chat",
      createdAt: NS.isoFromString(conv.created_at),
      updatedAt: NS.isoFromString(conv.updated_at),
    };
  }

  function normalize(conv) {
    if (!conv || !Array.isArray(conv.chat_messages)) throw new Error("Unexpected conversation shape");
    const messages = [];
    for (const message of conv.chat_messages) {
      if (!message || typeof message !== "object") continue;
      const role = message.sender === "human" ? "user" : message.sender === "assistant" ? "assistant" : null;
      if (!role) continue;
      const text = NS.tidy(messageText(message));
      if (!text) continue;
      messages.push({ role, text, at: NS.isoFromString(message.created_at) });
    }
    const summary = summarize(conv);
    return {
      id: summary.id,
      service: "claude",
      title: NS.tidy(conv.name) || NS.firstLine(messages),
      url: "https://claude.ai/chat/" + conv.uuid,
      createdAt: summary.createdAt || (messages[0] && messages[0].at) || "",
      updatedAt: summary.updatedAt || (messages.length ? messages[messages.length - 1].at : ""),
      messages,
    };
  }

  NS.adapters.claude = {
    id: "claude",
    name: "Claude",
    hosts: ["claude.ai"],
    home: "https://claude.ai/",
    summarize,
    normalize,

    async list() {
      const org = await orgId();
      const seen = new Map();
      for (let offset = 0; offset < 20000; offset += PAGE) {
        const page = await NS.getJson("/api/organizations/" + org + "/chat_conversations?limit=" + PAGE + "&offset=" + offset);
        if (!Array.isArray(page)) break;
        let added = 0;
        for (const conv of page) {
          if (conv && conv.uuid && !seen.has(conv.uuid)) {
            seen.set(conv.uuid, summarize(conv));
            added++;
          }
        }
        // Stop on a short page, or when the server ignores paging and
        // keeps returning the same set.
        if (page.length < PAGE || added === 0) break;
      }
      return [...seen.values()];
    },

    async get(id) {
      const org = await orgId();
      const conv = await NS.getJson("/api/organizations/" + org + "/chat_conversations/" + id + "?rendering_mode=messages&render_all_tools=true");
      return normalize(conv);
    },
  };
})(globalThis.ChatkeepSync);
