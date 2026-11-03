import test from "node:test";
import assert from "node:assert/strict";
import { buildLearnHubUrl } from "../midad-learnhub-bridge.mjs";

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
