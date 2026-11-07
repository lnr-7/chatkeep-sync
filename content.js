// Runs on the chat site. Answers the background's requests (list chats,
// fetch one chat) through the site's own session, and tells the background
// when the page has loaded so it can decide whether a sync is due.

(function () {
  const NS = globalThis.ChatkeepSync;
  const adapter = NS && NS.pick(location.hostname);
  if (!adapter) return;

  function reply(sendResponse, promise) {
    promise
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: String((error && error.message) || error) }));
    return true; // keep the channel open for the async answer
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== "object") return false;
    if (message.type === "ping") {
      sendResponse({ ok: true, result: adapter.id });
      return false;
    }
    if (message.type === "list") return reply(sendResponse, adapter.list());
    if (message.type === "get") return reply(sendResponse, adapter.get(message.id));
    return false;
  });

  chrome.runtime.sendMessage({ type: "page-ready", service: adapter.id }).catch(() => {});
})();
