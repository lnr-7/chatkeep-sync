// ChatGPT (chatgpt.com). Uses the page's own session token and the same
// conversation endpoints the page uses. A conversation is a tree in
// `mapping`; `current_node` is the leaf of the branch the person last saw.

(function (NS) {
  const PAGE = 50;
  let tokenCache = { value: "", at: 0 };

  async function headers() {
    if (!tokenCache.value || Date.now() - tokenCache.at > 10 * 60 * 1000) {
      const session = await NS.getJson("/api/auth/session");
      if (!session || !session.accessToken) throw new Error("Not signed in to ChatGPT");
      tokenCache = { value: session.accessToken, at: Date.now() };
    }
    const out = { Authorization: "Bearer " + tokenCache.value, "OAI-Language": navigator.language || "en-US" };
    const device = NS.cookie("oai-did");
    if (device) out["OAI-Device-Id"] = device;
    return out;
  }

  function partText(part) {
    if (typeof part === "string") return part;
    if (part && typeof part === "object") {
      if (typeof part.text === "string") return part.text;
      if (part.content_type === "image_asset_pointer") return "[image]";
    }
    return "";
  }

  function messageText(message) {
    const content = message && message.content;
    if (!content) return "";
    if (content.content_type === "code" && typeof content.text === "string") return "```\n" + content.text + "\n```";
    if (typeof content.text === "string") return content.text;
    if (typeof content.result === "string") return content.result;
    if (Array.isArray(content.parts)) return content.parts.map(partText).filter(Boolean).join("\n");
    return "";
  }

  function branch(conv) {
    const mapping = conv.mapping || {};
    let nodeId = conv.current_node;
    if (!nodeId || !mapping[nodeId]) {
      const ids = Object.keys(mapping);
      nodeId = ids.find((id) => !mapping[id].children || mapping[id].children.length === 0) || ids[ids.length - 1];
    }
    const chain = [];
    const seen = new Set();
    while (nodeId && mapping[nodeId] && !seen.has(nodeId)) {
      seen.add(nodeId);
      chain.push(mapping[nodeId]);
      nodeId = mapping[nodeId].parent;
    }
    return chain.reverse();
  }

  function summarize(item) {
    return {
      id: item.id || item.conversation_id,
      title: NS.tidy(item.title) || "Untitled chat",
      createdAt: NS.isoFromSeconds(item.create_time) || NS.isoFromString(item.create_time),
      updatedAt: NS.isoFromSeconds(item.update_time) || NS.isoFromString(item.update_time),
    };
  }

  function normalize(conv, id) {
    if (!conv || !conv.mapping) throw new Error("Unexpected conversation shape");
    const messages = [];
    for (const node of branch(conv)) {
      const message = node.message;
      if (!message || !message.author) continue;
      const role = message.author.role;
      if (role !== "user" && role !== "assistant") continue;
      if (message.metadata && message.metadata.is_visually_hidden_from_conversation) continue;
      const text = NS.tidy(messageText(message));
      if (!text) continue;
      messages.push({ role, text, at: NS.isoFromSeconds(message.create_time) });
    }
    const summary = summarize({ ...conv, id: conv.conversation_id || conv.id || id });
    return {
      id: summary.id,
      service: "chatgpt",
      title: NS.tidy(conv.title) || NS.firstLine(messages),
      url: "https://chatgpt.com/c/" + summary.id,
      createdAt: summary.createdAt || (messages[0] && messages[0].at) || "",
      updatedAt: summary.updatedAt || (messages.length ? messages[messages.length - 1].at : ""),
      messages,
    };
  }

  NS.adapters.chatgpt = {
    id: "chatgpt",
    name: "ChatGPT",
    hosts: ["chatgpt.com", "chat.openai.com"],
    home: "https://chatgpt.com/",
    summarize,
    normalize,

    async list() {
      const seen = new Map();
      for (let offset = 0; offset < 20000; offset += PAGE) {
        const page = await NS.getJson("/backend-api/conversations?offset=" + offset + "&limit=" + PAGE + "&order=updated", await headers());
        const items = page && Array.isArray(page.items) ? page.items : [];
        let added = 0;
        for (const item of items) {
          if (item && item.id && !seen.has(item.id)) {
            seen.set(item.id, summarize(item));
            added++;
          }
        }
        const total = typeof page.total === "number" ? page.total : Infinity;
        if (items.length < PAGE || added === 0 || offset + PAGE >= total) break;
      }
      return [...seen.values()];
    },

    async get(id) {
      const conv = await NS.getJson("/backend-api/conversation/" + id, await headers());
      return normalize(conv, id);
    },
  };
})(globalThis.ChatkeepSync);
