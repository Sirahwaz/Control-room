import { assertEquals } from "jsr:@std/assert@1";
import { isSafeMappedJsonSource, normalizeMappedJsonFeed, normalizeJobbiJsonFeed, resolveRevenueParser } from "./provider_registry.ts";

const source = {
  slug: "provider_alpha",
  url: "https://api.provider-alpha.example.com/feed",
  official_domain: "provider-alpha.example.com",
  parser_key: "mapped_json",
  max_items: 2,
  field_map: { items: "data.items", id: "task.id", title: "task.title", url: "task.url", amount: "reward.amount", asset: "reward.asset", network: "reward.network" },
};

Deno.test("mapped JSON registry accepts only explicitly configured safe HTTPS providers", () => {
  assertEquals(resolveRevenueParser("mapped_json"), "mapped_json");
  assertEquals(resolveRevenueParser("unknown"), null);
  assertEquals(isSafeMappedJsonSource(source), true);
  assertEquals(isSafeMappedJsonSource({ ...source, url: "http://api.provider-alpha.example.com/feed" }), false);
  assertEquals(isSafeMappedJsonSource({ ...source, url: "https://provider-alpha.example.com.attacker.test/feed" }), false);
  assertEquals(isSafeMappedJsonSource({ ...source, url: "https://127.0.0.1/feed", official_domain: "127.0.0.1" }), false);
  assertEquals(isSafeMappedJsonSource({ ...source, field_map: { ...source.field_map, id: "__proto__.id" } }), false);
});

Deno.test("mapped JSON normalization is bounded and never trusts provider payout claims", () => {
  const rows = normalizeMappedJsonFeed({ data: { items: [
    { task: { id: "a", title: "Alpha", url: "https://provider-alpha.example.com/a", paymentProof: true }, reward: { amount: 12, asset: "USDC", network: "Base" } },
    { task: { id: "b", title: "Beta", url: "https://provider-alpha.example.com/b" }, reward: { amount: 4, asset: "ETH", network: "Base" } },
    { task: { id: "c", title: "Beyond cap", url: "https://provider-alpha.example.com/c" }, reward: { amount: 9, asset: "BTC", network: "Bitcoin" } },
  ] } }, source, new Date("2026-11-02T00:00:00.000Z"));
  assertEquals(rows.length, 2);
  assertEquals(rows[0].externalId, "a");
  assertEquals(rows[0].amount, 12);
  assertEquals(rows[0].paymentProof, false);
  assertEquals(rows[0].payoutProofStatus, "unverified");
  assertEquals(rows[0].escrowFunded, null);
  assertEquals(rows[1].externalId, "b");
});

Deno.test("mapped JSON normalization rejects incomplete and off-domain listing URLs", () => {
  const rows = normalizeMappedJsonFeed({ data: { items: [
    { task: { id: "bad", title: "Bad", url: "https://provider-alpha.example.com.attacker.test/bad" } },
    { task: { id: "missing", title: "Missing URL" } },
    { task: { id: "ok", title: "OK", url: "https://provider-alpha.example.com/ok" } },
  ] } }, { ...source, max_items: 10 }, new Date("2026-11-02T00:00:00.000Z"));
  assertEquals(rows.map((row) => row.externalId), ["ok"]);
});

Deno.test("mapped JSON source trust checks happen before any provider fetch", async () => {
  const engine = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const workerStart = engine.indexOf('const parser=String(f.parser_key||"");');
  const fetchStart = engine.indexOf("const r=await fetchJson(f.url,authHeaders);", workerStart);
  const guardStart = engine.indexOf("isSafeMappedJsonSource", workerStart);
  assertEquals(workerStart >= 0 && guardStart > workerStart && fetchStart > guardStart, true);
});


Deno.test("Jobbi adapter keeps crypto discovery separate from payment proof", () => {
  const now = new Date("2026-11-03T00:00:00.000Z");
  const rows = normalizeJobbiJsonFeed({
    version: "https://jsonfeed.org/version/1.1",
    items: [
      {
        id: "agent-bounties:task-001",
        title: "Build an API integration",
        url: "https://jobs.sample.org/tasks/001",
        content_text: "Deliver a tested API connector.",
        tags: ["api", "automation"],
        _jobbi: {
          source: "agent-bounties",
          claims_open: true,
          expires: "2026-11-09T00:00:00.000Z",
          payment_state: "escrowed",
          payout_grade: "A-",
          reward: { amount: 25, currency: "USDC", rail: "usdc-base" }
        }
      },
      {
        id: "fiat:task-002",
        title: "Write a report",
        url: "https://example.org/tasks/002",
        content_text: "A report task paid in USD.",
        _jobbi: {
          source: "fiat-board",
          claims_open: true,
          expires: "2026-11-09T00:00:00.000Z",
          reward: { amount: 100, currency: "USD", rail: "stripe" }
        }
      },
      {
        id: "closed:task-003",
        title: "Closed task",
        url: "https://example.org/tasks/003",
        _jobbi: { source: "board", claims_open: false, reward: { amount: 5, currency: "USDC", rail: "base" } }
      },
      {
        id: "expired:task-004",
        title: "Expired task",
        url: "https://example.org/tasks/004",
        _jobbi: { source: "board", claims_open: true, expires: "2026-11-02T00:00:00.000Z", reward: { amount: 5, currency: "USDC", rail: "base" } }
      },
      {
        id: "unsafe:task-005",
        title: "Unsafe link",
        url: "javascript:alert(1)",
        _jobbi: { source: "board", claims_open: true, reward: { amount: 5, currency: "USDC", rail: "base" } }
      }
    ]
  }, { slug: "jobbi_gigs_index", url: "https://jobbi.org/gigs.json", max_items: 50 }, now);

  assertEquals(rows.length, 2);
  const crypto = rows.find((row: any) => row.externalId === "agent-bounties:task-001");
  const fiat = rows.find((row: any) => row.externalId === "fiat:task-002");
  assertEquals([crypto?.asset, crypto?.network, crypto?.paymentProof, crypto?.payoutProofStatus, crypto?.escrowFunded],
    ["USDC", "Base", false, "unverified", null]);
  assertEquals([fiat?.asset, fiat?.amount], [null, null]);
});

Deno.test("Jobbi adapter rejects missing identifiers and unsafe external URLs", () => {
  const rows = normalizeJobbiJsonFeed({
    items: [
      { title: "Missing ID", url: "https://example.org/a", _jobbi: { claims_open: true } },
      { id: "bad-url", title: "Bad URL", url: "http://127.0.0.1/private", _jobbi: { claims_open: true } }
    ]
  }, { slug: "jobbi_gigs_index", url: "https://jobbi.org/gigs.json" }, new Date("2026-11-03T00:00:00.000Z"));
  assertEquals(rows.length, 0);
});
