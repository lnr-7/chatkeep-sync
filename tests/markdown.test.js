import test from "node:test";
import assert from "node:assert/strict";
import { chatToMarkdown, chatFileName, fileSafeName, cleanFolder } from "../markdown.js";

const chat = {
  id: "c-1",
  service: "claude",
  title: "Fix my resume",
  url: "https://claude.ai/chat/c-1",
  createdAt: "2026-10-30T10:00:00.000Z",
  updatedAt: "2026-10-30T10:20:00.000Z",
  messages: [
    { role: "user", text: "Can you tighten this?", at: "2026-10-30T10:00:00.000Z" },
    { role: "assistant", text: "Here you go.", at: "2026-10-30T10:01:00.000Z" },
  ],
};

test("Markdown has a title, metadata and one heading per message", () => {
  const md = chatToMarkdown(chat);
  assert.equal(
    md,
    [
      "# Fix my resume",
      "",
      "Source: Claude  ",
      "Link: https://claude.ai/chat/c-1  ",
      "Started: 2026-10-30T10:00:00.000Z  ",
      "Last message: 2026-10-30T10:20:00.000Z",
      "",
      "## You (2026-10-30T10:00:00.000Z)",
      "",
      "Can you tighten this?",
      "",
      "## Claude (2026-10-30T10:01:00.000Z)",
      "",
      "Here you go.",
      "",
    ].join("\n"),
  );
});

test("file names are dated, slugged, grouped by service and unique", () => {
  assert.equal(chatFileName(chat), "claude/2026-10-30-fix-my-resume.md");
  const taken = new Set(["claude/2026-10-30-fix-my-resume.md"]);
  assert.equal(chatFileName(chat, taken), "claude/2026-10-30-fix-my-resume-2.md");
  assert.equal(chatFileName({ ...chat, createdAt: "", title: "日本語" }), "claude/undated-chat.md");
});

test("fileSafeName strips what Windows and URLs dislike", () => {
  assert.equal(fileSafeName('What: is <this>? / "quoted" | yes*'), "what-is-this-quoted-yes");
  assert.equal(fileSafeName("x".repeat(100)).length, 60);
});

test("cleanFolder keeps a sane relative folder", () => {
  assert.equal(cleanFolder("Chatkeep"), "Chatkeep");
  assert.equal(cleanFolder(" AI chats/ archive. "), "AI chats/archive");
  assert.equal(cleanFolder("../../etc"), "etc");
  assert.equal(cleanFolder('<>:"|?*'), "Chatkeep");
  assert.equal(cleanFolder(""), "Chatkeep");
});
