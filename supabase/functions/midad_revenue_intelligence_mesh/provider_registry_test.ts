import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  evaluateAffiliateDiscovery,
  isSafeMappedJsonSource,
  normalizeMappedJsonFeed,
  resolveRevenueParser,
  runBounded,
} from "./provider_registry.ts";

Deno.test("provider registry supports existing adapters and extensible mapped-json sources", () => {
  assertEquals(resolveRevenueParser("taskmarket"), "taskmarket");
  assertEquals(resolveRevenueParser("superteam"), "superteam");
  assertEquals(resolveRevenueParser("mapped_json"), "mapped_json");
  assertEquals(resolveRevenueParser("new_adapter_not_registered"), null);
});

Deno.test("mapped-json parser reads nested configured fields without trusting payout claims", () => {
  const source = {
    slug: "vendor_alpha",
    api_url: "https://api.vendor-alpha.example/v1/opportunities",
    official_domain: "vendor-alpha.example",
    parser_key: "mapped_json",
    max_items: 20,
    field_map: {
      items: "data.items",
      id: "task.id",
      title: "task.title",
      description: "task.summary",
      url: "task.url",
      status: "task.status",
      amount: "reward.amount",
      asset: "reward.asset",
      network: "reward.network",
      deadline: "task.deadline",
      upfront_cost_usd: "fees.upfront_usd",
      claim_bond_usd: "fees.bond_usd",
      estimated_effort_hours: "effort_hours",
      tags: "skills",
    },
  };
  const body = {
    data: {
      items: [
        {
          task: {
            id: "alpha-1",
            title: "Build a verified parser",
            summary: "Small API task",
            url: "https://vendor-alpha.example/tasks/alpha-1",
            status: "open",
            deadline: "2030-01-01T00:00:00.000Z",
            paymentProof: true,
            payoutVerified: true,
          },
          reward: { amount: "25", asset: "USDC", network: "Base" },
          fees: { upfront_usd: 0, bond_usd: 0 },
          effort_hours: 2,
          skills: ["typescript", "api"],
        },
      ],
    },
  };

  const rows = normalizeMappedJsonFeed(body, source, new Date("2026-10-25T00:00:00.000Z"));
  assertEquals(rows.length, 1);
  assertEquals(rows[0].sourceSlug, "vendor_alpha");
  assertEquals(rows[0].externalId, "alpha-1");
  assertEquals(rows[0].title, "Build a verified parser");
  assertEquals(rows[0].amount, 25);
  assertEquals(rows[0].asset, "USDC");
  assertEquals(rows[0].network, "Base");
  assertEquals(rows[0].cost, 0);
  assertEquals(rows[0].bond, 0);
  assertEquals(rows[0].paymentProof, false);
  assertEquals(rows[0].escrowFunded, null);
  assertEquals(rows[0].payoutProofStatus, "unverified");
  assertEquals(rows[0].payoutConfidence, 0);
  assertEquals(rows[0].region, "unknown");
  assertEquals(rows[0].kyc, "unknown");
  assertEquals(rows[0].identity, "unknown");
  assertEquals(rows[0].raw.task.payoutVerified, true);
  assert(rows[0].notes.some((note: string) => note.includes("not independently verified")));
});

Deno.test("mapped-json parser rejects unsafe or mismatched official feed URLs", () => {
  const base = {
    slug: "vendor_alpha",
    parser_key: "mapped_json",
    field_map: { items: "data.items", id: "id", title: "title" },
    max_items: 20,
  };

  assertEquals(isSafeMappedJsonSource({
    ...base,
    api_url: "http://api.vendor-alpha.example/feed",
    official_domain: "vendor-alpha.example",
  }), false);
  assertEquals(isSafeMappedJsonSource({
    ...base,
    api_url: "https://api.vendor-alpha.example/feed",
    official_domain: "vendor-alpha.example.attacker.test",
  }), false);
  assertEquals(isSafeMappedJsonSource({
    ...base,
    api_url: "https://127.0.0.1/feed",
    official_domain: "127.0.0.1",
  }), false);
  assertEquals(isSafeMappedJsonSource({
    ...base,
    api_url: "https://api.vendor-alpha.example/feed",
    official_domain: "vendor-alpha.example",
  }), true);
});

Deno.test("mapped-json parser drops incomplete and non-HTTPS candidate URLs", () => {
  const source = {
    slug: "vendor_beta",
    api_url: "https://api.vendor-beta.example/jobs",
    official_domain: "vendor-beta.example",
    parser_key: "mapped_json",
    max_items: 20,
    field_map: { items: "jobs", id: "id", title: "title", url: "url" },
  };
  const rows = normalizeMappedJsonFeed({
    jobs: [
      { id: "no-title", url: "https://vendor-beta.example/jobs/no-title" },
      { id: "bad-url", title: "Javascript URL", url: "javascript:alert(1)" },
      { id: "good", title: "Good listing", url: "https://vendor-beta.example/jobs/good" },
    ],
  }, source, new Date("2026-10-25T00:00:00.000Z"));
  assertEquals(rows.map((r: any) => r.externalId), ["good"]);
});

Deno.test("mapped-json parser bounds item count and rejects unsafe field paths", () => {
  const source = {
    slug: "vendor_gamma",
    api_url: "https://api.vendor-gamma.example/jobs",
    official_domain: "vendor-gamma.example",
    parser_key: "mapped_json",
    max_items: 2,
    field_map: { items: "items", id: "__proto__.id", title: "constructor.prototype.title", url: "url" },
  };
  const rows = normalizeMappedJsonFeed({
    items: [
      { id: "one", title: "One", url: "https://vendor-gamma.example/one" },
      { id: "two", title: "Two", url: "https://vendor-gamma.example/two" },
      { id: "three", title: "Three", url: "https://vendor-gamma.example/three" },
    ],
  }, source, new Date("2026-10-25T00:00:00.000Z"));
  assertEquals(rows.length, 0);
});

Deno.test("unknown mapped payout evidence remains discovery-only even with provider self-asserted payment flags", () => {
  const source = {
    slug: "vendor_delta",
    api_url: "https://api.vendor-delta.example/jobs",
    official_domain: "vendor-delta.example",
    parser_key: "mapped_json",
    max_items: 10,
    field_map: { items: "jobs", id: "id", title: "title", url: "url", payment_proof: "paymentProof" },
  };
  const rows = normalizeMappedJsonFeed({
    jobs: [{ id: "delta-1", title: "Listing", url: "https://vendor-delta.example/jobs/delta-1", paymentProof: true }],
  }, source, new Date("2026-10-25T00:00:00.000Z"));
  assertEquals(rows.length, 1);
  assertEquals(rows[0].paymentProof, false);
  assertEquals(rows[0].payoutProofStatus, "unverified");
});

Deno.test("provider feed processing is parallel but bounded and ordered", async () => {
  let active = 0;
  let peak = 0;
  const results = await runBounded([1, 2, 3, 4, 5, 6], 3, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return value * 10;
  });
  assertEquals(peak, 3);
  assertEquals(results, [10, 20, 30, 40, 50, 60]);
});

Deno.test("provider processing rejects invalid concurrency limits", async () => {
  let failed = false;
  try {
    await runBounded([1], 0, async (value) => value);
  } catch (error) {
    failed = error instanceof RangeError;
  }
  assertEquals(failed, true);
});

Deno.test("affiliate terms qualify only for pre-application discovery, never for bounty escrow or realized revenue", () => {
  const affiliate = {
    revenueLane: "affiliate",
    asset: "BTC",
    network: "Bitcoin",
    cost: 0,
    bond: 0,
    paymentProof: false,
    evidenceMeta: {
      revenue_lane: "affiliate",
      official_domain: "trezor.io",
      affiliate: {
        official_program_url: "https://trezor.io/affiliate",
        official_terms_url: "https://trezor.io/affiliate",
        official_terms_verified: true,
        crypto_payout_confirmed: true,
        payout_asset: "BTC",
        payout_network: "bitcoin",
        commission_model: "commission per qualified sale",
        commission_rate_percent: 15,
        payout_schedule: "monthly",
        upfront_cost_verified: true,
        claim_bond_verified: true,
      },
    },
  };
  const result = evaluateAffiliateDiscovery(affiliate);
  assertEquals(result.decision, "DISCOVERY_ONLY");
  assertEquals(result.status, "DISCOVERED");
  assertEquals(result.payoutState, "official_program_terms");
  assertEquals(result.next, "affiliate_preapplication_review");
  assertEquals(result.reasons.includes("acceptance_tracking_payable_commission_and_receipt_not_proven"), true);
});

Deno.test("affiliate lane blocks missing terms or payout evidence without requiring task escrow transaction proof", () => {
  const candidate = {
    revenueLane: "affiliate",
    asset: "USDC",
    network: "Base",
    paymentProof: false,
    cost: 0,
    bond: 0,
    evidenceMeta: {
      revenue_lane: "affiliate",
      official_domain: "vendor.example",
      affiliate: {
        official_program_url: "https://vendor.example/partners",
        official_terms_url: "https://vendor.example/terms",
        official_terms_verified: false,
        crypto_payout_confirmed: false,
        payout_asset: "USDC",
        payout_network: "base",
        upfront_cost_verified: true,
        claim_bond_verified: true,
        commission_model: "share",
        payout_schedule: "monthly",
      },
    },
  };
  const result = evaluateAffiliateDiscovery(candidate);
  assertEquals(result.decision, "BLOCKED_PAYOUT");
  assertEquals(result.reasons.includes("affiliate_official_terms_not_verified"), true);
});

Deno.test("affiliate lane blocks positive upfront cost and claim bonds before review", () => {
  const candidate = {
    revenueLane: "affiliate",
    asset: "BTC",
    network: "bitcoin",
    cost: 5,
    bond: 0,
    evidenceMeta: {
      revenue_lane: "affiliate",
      official_domain: "trezor.io",
      affiliate: {
        official_program_url: "https://trezor.io/affiliate",
        official_terms_url: "https://trezor.io/affiliate",
        official_terms_verified: true,
        crypto_payout_confirmed: true,
        payout_asset: "BTC",
        payout_network: "bitcoin",
        commission_model: "sale",
        payout_schedule: "monthly",
        upfront_cost_verified: true,
        claim_bond_verified: true,
      },
    },
  };
  const result = evaluateAffiliateDiscovery(candidate);
  assertEquals(result.decision, "BLOCKED_UPFRONT_COST");
  assertEquals(result.next, "no_spend_policy_block");
});

Deno.test("affiliate discovery rejects official terms URLs outside the recorded provider domain", () => {
  const candidate = {
    revenueLane: "affiliate",
    asset: "BTC",
    network: "bitcoin",
    cost: 0,
    bond: 0,
    evidenceMeta: {
      official_domain: "trezor.io",
      affiliate: {
        official_program_url: "https://trezor.io/affiliate",
        official_terms_url: "https://trezor.io.attacker.example/terms",
        official_terms_verified: true,
        crypto_payout_confirmed: true,
        payout_asset: "BTC",
        payout_network: "bitcoin",
        commission_model: "sale",
        payout_schedule: "monthly",
        upfront_cost_verified: true,
        claim_bond_verified: true,
      },
    },
  };
  const result = evaluateAffiliateDiscovery(candidate);
  assertEquals(result.decision, "BLOCKED_PAYOUT");
  assertEquals(result.reasons.includes("affiliate_official_terms_not_verified"), true);
});

Deno.test("a new affiliate source can be added through registry metadata without a provider-specific parser", () => {
  const source = {
    slug: "trezor_affiliate",
    api_url: "https://api.trezor.io/public-affiliate-feed",
    official_domain: "trezor.io",
    parser_key: "mapped_json",
    revenue_lane: "affiliate",
    official_program_url: "https://trezor.io/affiliate",
    official_terms_url: "https://trezor.io/affiliate",
    official_terms_verified: "true",
    crypto_payout_confirmed: "true",
    payout_asset: "BTC",
    payout_network: "bitcoin",
    commission_model: "commission per qualified sale",
    commission_rate_percent: "15",
    payout_schedule: "monthly",
    upfront_cost_verified: "true",
    claim_bond_verified: "true",
    verified_at: "2026-10-25T12:00:00.000Z",
    max_items: 10,
    field_map: {
      items: "programs",
      id: "id",
      title: "name",
      url: "url",
      description: "description",
    },
  };
  const rows = normalizeMappedJsonFeed({
    programs: [{
      id: "trezor-program",
      name: "Hardware wallet affiliate program",
      url: "https://trezor.io/affiliate",
      description: "Official affiliate program listing",
    }],
  }, source, new Date("2026-10-25T13:00:00.000Z"));
  assertEquals(rows.length, 1);
  assertEquals(rows[0].revenueLane, "affiliate");
  assertEquals(rows[0].asset, "BTC");
  assertEquals(rows[0].network, "bitcoin");
  assertEquals(rows[0].paymentProof, false);
  assertEquals(rows[0].evidenceMeta.affiliate.official_terms_verified, true);
  assertEquals(rows[0].evidenceMeta.affiliate.crypto_payout_confirmed, true);
  const qualification = evaluateAffiliateDiscovery(rows[0]);
  assertEquals(qualification.decision, "DISCOVERY_ONLY");
  assertEquals(qualification.status, "DISCOVERED");
});
