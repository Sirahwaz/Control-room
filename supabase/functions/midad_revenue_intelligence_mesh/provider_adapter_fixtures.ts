/**
 * Sanitized contract-shaped fixtures based on official provider documentation.
 * These are schema fixtures, not live task records and contain no credentials.
 */
export const taskmarketFixture = {
  id: "task-fixture-01",
  title: "Fixture task",
  description: "Contract-shaped public listing fixture",
  reward: "10000000",
  netReward: "9250000",
  mode: "bounty",
  status: "open",
  phase: "active",
  expiryTime: "2030-01-01T00:00:00.000Z",
  escrowTxHash: null,
  stakeRequired: false,
  stakeBps: 0,
  submissionCount: 2,
  awardCount: 0,
  tags: ["typescript"],
};

export const basedAgentsFixture = {
  task_id: "task_fixture_based_01",
  title: "Fixture task",
  description: "Public task record",
  bounty: { amount_atomic: "10000000", amount_display: "10.00", token: "USDC", network: "eip155:8453" },
  status: "open",
  required_capabilities: ["api"],
  claimed_by_agent_id: null,
  escrow: { status: "funded", deposit_tx_hash: null },
};

/**
 * Public-page observation only, NOT a claimed live API response/schema fixture.
 * The official listing page exposes the job title, $5.00 reward, Base (8453),
 * an "secured in escrow" label, and says claim/submission are free. The API
 * GET response could not be retrieved for this audit, so no undocumented
 * JSON field names (fee, net, split, or escrow object) are fabricated here.
 */
export const bountyBookFixture = {
  id: "a55bd7d2-b6a0-4bfc-80b5-f788d0ff312d",
  title: "Build TypedEmitter class with typed event handling in event_emitter.ts",
  displayed_reward_usd: 5,
  displayed_chain: "Base",
  chain_id: 8453,
  displayed_escrow_label: "secured in escrow",
  displayed_claim_submission_fee: "free",
};

export const superteamFixture = {
  id: "listing-fixture-st-01",
  slug: "fixture-listing",
  title: "Fixture listing",
  status: "live",
  agentAccess: "AGENT_ALLOWED",
  compensation: { amount: 100, asset: "USDC", network: "Solana" },
  eligibilityQuestions: [],
  deadline: "2030-01-01T00:00:00.000Z",
};
