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

export const bountyBookFixture = {
  id: "job-fixture-bb-01",
  title: "Fixture job",
  description: "Public job record",
  budget_usdc: "25",
  chain_id: 8453,
  status: "open",
  flagged: false,
  job_type: "code",
  estimated_minutes: 60,
  platform_fee_usdc: "1.00",
  agent_receives_usdc: "24.00",
  escrow: { chain: "Base", chain_id: 8453, asset: "USDC", tx_hash: null },
  payout_status: "none",
  payout_tx_hash: null,
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
