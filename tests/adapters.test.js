import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The adapters are plain scripts that attach to globalThis; importing them
// as modules runs them once.
await import("../adapters/shared.js");
await import("../adapters/claude.js");
await import("../adapters/chatgpt.js");

const NS = globalThis.ChatkeepSync;
const claudeApi = JSON.parse(readFileSync(new URL("./fixtures/claude-api.json", import.meta.url), "utf8"));
const chatgptApi = JSON.parse(readFileSync(new URL("./fixtures/chatgpt-api.json", import.meta.url), "utf8"));

test("pick finds the adapter for a hostname", () => {
  assert.equal(NS.pick("claude.ai").id, "claude");
  assert.equal(NS.pick("chatgpt.com").id, "chatgpt");
  assert.equal(NS.pick("chat.openai.com").id, "chatgpt");
  assert.equal(NS.pick("example.com"), null);
});

test("Claude: normalizes a conversation and keeps text blocks only", () => {
  const chat = NS.adapters.claude.normalize(claudeApi.details["c-111"]);
  assert.equal(chat.service, "claude");
  assert.equal(chat.id, "c-111");
  assert.equal(chat.title, "Fix my resume");
  assert.equal(chat.url, "https://claude.ai/chat/c-111");
  assert.equal(chat.createdAt, "2026-10-30T10:00:00.000Z");
  assert.equal(chat.updatedAt, "2026-10-30T10:20:00.000Z");
  assert.deepEqual(
    chat.messages.map((m) => [m.role, m.text]),
    [
      ["user", "Can you tighten this summary?"],
      ["assistant", "Here is a tighter version:\n\nEngineer with 5 years in payments."],
    ],
  );
});

test("Claude: untitled chat takes its first line, attachments are noted", () => {
  const chat = NS.adapters.claude.normalize(claudeApi.details["c-222"]);
  assert.equal(chat.messages.length, 1);
  assert.match(chat.messages[0].text, /\[attached: notes\.txt\]/);
  assert.match(chat.messages[0].text, /\[file: photo\.png\]/);
  assert.ok(chat.title.length > 0 && chat.title !== "Untitled chat");
});

test("Claude: a chat with no messages normalizes to an empty list", () => {
  const chat = NS.adapters.claude.normalize(claudeApi.details["c-333"]);
  assert.equal(chat.messages.length, 0);
});

test("Claude: list summaries carry the fields used to detect changes", () => {
  const summary = NS.adapters.claude.summarize(claudeApi.list[0]);
  assert.deepEqual(summary, {
    id: "c-111",
    title: "Fix my resume",
    createdAt: "2026-10-30T10:00:00.000Z",
    updatedAt: "2026-10-30T10:20:00.000Z",
  });
});

test("ChatGPT: follows the current branch and renders code blocks", () => {
  const chat = NS.adapters.chatgpt.normalize(chatgptApi.details["conv-aaa"], "conv-aaa");
  assert.equal(chat.service, "chatgpt");
  assert.equal(chat.id, "conv-aaa");
  assert.equal(chat.url, "https://chatgpt.com/c/conv-aaa");
  assert.equal(chat.title, "Plan a Goa trip");
  const texts = chat.messages.map((m) => m.text);
  assert.ok(!texts.some((t) => /regenerated answer/.test(t)), "hidden branch must not appear");
  assert.equal(texts[texts.length - 1], "```\nprint('hi')\n```");
  assert.equal(chat.messages[0].role, "user");
  assert.equal(chat.createdAt, "2026-10-29T08:00:00.500Z");
});

test("ChatGPT: list summaries convert epoch seconds", () => {
  const summary = NS.adapters.chatgpt.summarize(chatgptApi.list.items[1]);
  assert.equal(summary.id, "conv-bbb");
  assert.equal(summary.title, "Untitled chat");
  assert.equal(summary.updatedAt, "2026-10-30T22:41:40.000Z");
});

test("ChatGPT: an empty conversation normalizes to no messages", () => {
  const chat = NS.adapters.chatgpt.normalize(chatgptApi.details["conv-ccc"], "conv-ccc");
  assert.equal(chat.messages.length, 0);
});

test("tidy collapses blank lines and trailing spaces", () => {
  assert.equal(NS.tidy("a  \r\n\r\n\r\n\r\nb \n"), "a\n\nb");
});
