// Shared helpers for the service adapters. Plain script (no modules) because
// it runs as a content script; it also loads under Node for the tests.

globalThis.ChatkeepSync = globalThis.ChatkeepSync || { adapters: {} };

(function (NS) {
  // Fetch JSON from the page's own origin with the page's own session. The
  // request is the same one the site makes for itself; no cookies are read.
  NS.getJson = async function getJson(url, headers = {}) {
    const response = await fetch(url, { credentials: "same-origin", headers: { Accept: "application/json", ...headers } });
    if (response.status === 401 || response.status === 403) throw new Error("Not signed in (" + response.status + ")");
    if (response.status === 429) throw new Error("The site asked us to slow down (429). Try again later.");
    if (!response.ok) throw new Error("Request failed: " + response.status + " " + url);
    return response.json();
  };

  NS.tidy = function tidy(text) {
    return String(text ?? "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  };

  NS.isoFromString = function isoFromString(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  };

  NS.isoFromSeconds = function isoFromSeconds(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "";
    return new Date(value * 1000).toISOString();
  };

  NS.firstLine = function firstLine(messages) {
    const first = messages.find((m) => m.role === "user") || messages[0];
    return first ? first.text.split("\n")[0].slice(0, 80) : "Untitled chat";
  };

  NS.cookie = function cookie(name) {
    const match = document.cookie.split("; ").find((part) => part.startsWith(name + "="));
    return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
  };

  NS.pick = function pick(hostname) {
    return Object.values(NS.adapters).find((adapter) => adapter.hosts.includes(hostname)) || null;
  };
})(globalThis.ChatkeepSync);
