import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  isSafeJobbiJsonSource,
  normalizeJobbiJsonFeed,
  resolveRevenueParser,
} from "./provider_registry.ts";

const source = {
  slug: "jobbi_gigs_usdc",
  url: "https://jobbi.org/gigs.json?lane=agent&currency=USDC&limit=50",
  official_domain: "jobbi.org",
  parser_key: "jobbi_json_feed",
  max_items: 50,
};

Deno.test("Jobbi parser is explicitly registered and its source allowlist is host/path/query constrained", () => {
  assertEquals(resolveRevenueParser("jobbi_json_feed"), "jobbi_json_feed");
  assertEquals(resolveRevenueParser("unknown_parser"), null);
  assertEquals(isSafeJobbiJsonSource(source), true);
  assertEquals(isSafeJobbiJsonSource({ ...source, url: "http://jobbi.org/gigs.json?lane=agent&currency=USDC&limit=50" }), false);
  assertEquals(isSafeJobbiJsonSource({ ...source, url: "https://jobbi.org.attacker.test/gigs.json?lane=agent&currency=USDC&limit=50" }), false);
  assertEquals(isSafeJobbiJsonSource({ ...source, url: "https://jobbi.org/other.json?lane=agent&currency=USDC&limit=50" }), false);
  assertEquals(isSafeJobbiJsonSource({ ...source, url: "https://jobbi.org/gigs.json?lane=other&currency=USDC&limit=50" }), false);
  assertEquals(isSafeJobbiJsonSource({ ...source, url: "https://jobbi.org/gigs.json?lane=agent&currency=ETH&limit=50" }), false);
  assertEquals(isSafeJobbiJsonSource({ ...source, url: "https://jobbi.org/gigs.json?lane=agent&currency=USDC&limit=51" }), false);
});

Deno.test("Jobbi index claims and payout grades never become funded payout evidence", () => {
  const rows = normalizeJobbiJsonFeed({
    items: [{
      id: "bountybook:job-1",
      title: "Build a small CSV utility",
      url: "https://api.bountybook.ai/jobs/job-1",
      content_text: "Build a CSV utility with deterministic tests.",
      tags: ["python", "csv"],
      _jobbi: {
        lane: "agent",
        source: "bountybook",
        claims_open: true,
        payout_grade: "A",
        payment_state: "paid",
        reward: { amount: 3.5, currency: "USDC", rail: "x402" },
      },
    }],
  }, source, new Date("2026-11-08T04:00:00.000Z"));

  assertEquals(rows.length, 1);
  assertEquals(rows[0].externalId, "bountybook:job-1");
  assertEquals(rows[0].amount, 3.5);
  assertEquals(rows[0].asset, "USDC");
  assertEquals(rows[0].network, "x402");
  assertEquals(rows[0].payoutProofStatus, "unverified");
  assertEquals(rows[0].paymentProof, false);
  assertEquals(rows[0].escrowFunded, null);
  assertEquals(rows[0].payoutConfidence, 0);
  assertEquals(rows[0].evidenceMeta.index_payout_grade, "A");
  assertEquals(rows[0].evidenceMeta.index_payment_state, "paid");
  assertEquals(rows[0].evidenceMeta.independent_payment_proof, false);
});

Deno.test("Jobbi normalization rejects closed claims, expired items and non-HTTPS listing URLs", () => {
  const rows = normalizeJobbiJsonFeed({
    items: [
      {
        id: "closed", title: "Closed claim", url: "https://board.example/closed",
        _jobbi: { claims_open: false, reward: { amount: 1, currency: "USDC", rail: "x402" } },
      },
      {
        id: "expired", title: "Expired claim", url: "https://board.example/expired",
        _jobbi: { claims_open: true, expires: "2026-11-07T23:59:59.000Z", reward: { amount: 1, currency: "USDC", rail: "x402" } },
      },
      {
        id: "bad-url", title: "Unsafe URL", url: "javascript:alert(1)",
        _jobbi: { claims_open: true, reward: { amount: 1, currency: "USDC", rail: "x402" } },
      },
      {
        id: "valid", title: "Open listing", url: "https://board.example/valid",
        _jobbi: { claims_open: true, expires: "2026-11-09T00:00:00.000Z", reward: { amount: 2, currency: "USDC", rail: "x402" } },
      },
    ],
  }, source, new Date("2026-11-08T04:00:00.000Z"));

  assertEquals(rows.map((row) => row.externalId), ["valid"]);
  assertEquals(rows[0].payoutProofStatus, "unverified");
});

Deno.test("Jobbi source trust validation occurs before any feed fetch", async () => {
  const engine = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const workerStart = engine.indexOf('const parser=String(f.parser_key||"");');
  const guardStart = engine.indexOf('isSafeJobbiJsonSource({slug:f.slug,url:f.url,parser_key:parser})', workerStart);
  const fetchStart = engine.indexOf("const r=await fetchJson(f.url,authHeaders);", workerStart);
  assert(workerStart >= 0 && guardStart > workerStart && fetchStart > guardStart);
});
