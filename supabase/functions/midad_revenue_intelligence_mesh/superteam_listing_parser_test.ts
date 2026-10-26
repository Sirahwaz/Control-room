import { assertEquals } from "jsr:@std/assert@1";
import { parseAgentEligibleSuperteamListings } from "./superteam_listing_parser.ts";

const now = new Date("2026-10-26T18:00:00.000Z");

Deno.test("public Superteam fallback keeps only open agent-eligible listings", () => {
  const result = parseAgentEligibleSuperteamListings([
    { slug: "allowed-live", title: "Agent bounty", status: "OPEN", agentAccess: "AGENT_ALLOWED", deadline: "2026-10-28T00:00:00.000Z" },
    { slug: "human-only", title: "Human only", status: "OPEN", agentAccess: "HUMAN_ONLY", deadline: "2026-10-29T00:00:00.000Z" },
    { slug: "agent-only-not-public", title: "Hidden agent-only", status: "OPEN", agentAccess: "AGENT_ONLY", deadline: "2026-10-29T00:00:00.000Z" },
    { slug: "closed", title: "Closed", status: "CLOSED", agentAccess: "AGENT_ALLOWED", deadline: "2026-10-29T00:00:00.000Z" },
    { slug: "expired", title: "Expired", status: "OPEN", agentAccess: "AGENT_ALLOWED", deadline: "2026-10-25T00:00:00.000Z" },
    { slug: "winners", title: "Winners announced", status: "OPEN", agentAccess: "AGENT_ALLOWED", isWinnersAnnounced: true, deadline: "2026-10-29T00:00:00.000Z" },
    { slug: "unknown-access", title: "Unknown eligibility", status: "OPEN", deadline: "2026-10-29T00:00:00.000Z" },
  ], now);
  assertEquals(result.map((x) => x.slug), ["allowed-live"]);
});

Deno.test("public Superteam fallback supports the provider's array and wrapped response shapes", () => {
  const row = { slug: "wrapped-live", title: "Wrapped bounty", status: "OPEN", agentAccess: "AGENT_ALLOWED", deadline: "2026-10-27T00:00:00.000Z" };
  assertEquals(parseAgentEligibleSuperteamListings({ data: { listings: [row] } }, now).map((x) => x.slug), ["wrapped-live"]);
  assertEquals(parseAgentEligibleSuperteamListings({ listings: [row] }, now).map((x) => x.slug), ["wrapped-live"]);
  assertEquals(parseAgentEligibleSuperteamListings({ results: [row] }, now).map((x) => x.slug), ["wrapped-live"]);
});

Deno.test("public Superteam fallback rejects API error objects instead of inventing listings", () => {
  assertEquals(parseAgentEligibleSuperteamListings({ error: "Unauthorized" }, now), []);
  assertEquals(parseAgentEligibleSuperteamListings({ listings: "unexpected" }, now), []);
});
