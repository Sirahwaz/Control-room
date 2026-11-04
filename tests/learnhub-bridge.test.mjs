import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildLearnHubUrl, openLearnHubWorkflow } from "../midad-learnhub-bridge.mjs";

test("builds an Arabic LearnHub global search link", () => {
  const url = new URL(buildLearnHubUrl({ workflow: "search", lang: "AR" }));
  assert.equal(url.origin, "https://alisol.ir");
  assert.equal(url.searchParams.get("ai"), "learnhub_search");
  assert.equal(url.searchParams.get("lang"), "AR");
});

test("builds a topic deep-dive link with encoded topic text", () => {
  const url = new URL(buildLearnHubUrl({ workflow: "topic", topic: "Supabase RLS & RAG", lang: "FA" }));
  assert.equal(url.searchParams.get("ai"), "Supabase RLS & RAG");
  assert.equal(url.searchParams.get("lang"), "FA");
});

test("rejects unknown workflows and unsupported languages", () => {
  assert.throws(() => buildLearnHubUrl({ workflow: "admin" }), /Unsupported workflow/);
  assert.throws(() => buildLearnHubUrl({ workflow: "search", lang: "XX" }), /Unsupported language/);
});

test("requires a non-empty bounded topic for topic links", () => {
  assert.throws(() => buildLearnHubUrl({ workflow: "topic", topic: "   " }), /Topic is required/);
  assert.throws(() => buildLearnHubUrl({ workflow: "topic", topic: "x".repeat(161) }), /160 characters/);
});

test("does not accept a caller-controlled destination", () => {
  const url = new URL(buildLearnHubUrl({ workflow: "starter", lang: "AR", baseUrl: "https://evil.example" }));
  assert.equal(url.origin, "https://alisol.ir");
});

test("reports popup blocking without claiming the workflow opened", () => {
  const result = openLearnHubWorkflow({ workflow: "starter" }, () => null);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "popup_blocked");
});

test("opens a workflow and clears the child window opener", () => {
  const child = { opener: "parent" };
  const result = openLearnHubWorkflow({ workflow: "search" }, () => child);
  assert.equal(result.ok, true);
  assert.equal(child.opener, null);
  assert.equal(result.reason, null);
});

test("reports unavailable window APIs safely", () => {
  const result = openLearnHubWorkflow({ workflow: "starter" }, undefined);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "window_unavailable");
});

test("AI Room exposes the LearnHub bridge controls", async () => {
  const html = await readFile(new URL("../ai-room.html", import.meta.url), "utf8");
  assert.match(html, /id="learnhubPanel"/);
  assert.match(html, /id="learnhubForm"/);
  assert.match(html, /data-learnhub-workflow="search"/);
  assert.match(html, /data-learnhub-workflow="starter"/);
  assert.match(html, /data-learnhub-workflow="topic"/);
});

test("AI Room imports and binds the LearnHub bridge without a MIDAD token", async () => {
  const html = await readFile(new URL("../ai-room.html", import.meta.url), "utf8");
  assert.match(html, /from "\.\/midad-learnhub-bridge\.mjs"/);
  assert.match(html, /openLearnHubWorkflow\(\{workflow,topic,lang\}\)/);
});
