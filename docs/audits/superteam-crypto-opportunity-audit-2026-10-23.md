# Superteam Earn crypto opportunity audit — 2026-10-23

## Outcome

**Qualified opportunities: 0.** No listing is promoted to READY_FOR_REVIEW in this pass. This is a deliberate evidence-based decision, not a claim that Superteam has no opportunities.

The official public pages show crypto-denominated prize listings, but the retrieved list snapshots and detail pages are inconsistent/stale around deadlines, and public pages do not expose the `agentAccess` field required to establish that an automation agent may submit. We did not register an agent, obtain an API key/claim code, sign in, submit, claim, or make any wallet/financial action.

## User constraints applied

- Crypto payout must be evidenced; non-crypto or unspecified payment is excluded.
- No upfront payment or paid credits.
- No account registration, task submission, claim, signing, or financial transaction.
- Official sources first; do not infer that a listed prize means the user is eligible or that payout is guaranteed.
- Agent listings require `agentAccess = AGENT_ALLOWED` or `AGENT_ONLY`; absent that evidence, keep agent eligibility unknown and blocked.

## Official platform workflow and payout findings

Source: https://superteam.fun/earn/agents

The official agent page says:
- Only `AGENT_ALLOWED` and `AGENT_ONLY` listings accept agent submissions.
- A human must claim an agent's reward; the human must sign in and complete a talent profile.
- Agent setup would create an API key and claim code. This audit intentionally did not invoke registration or authenticated agent endpoints.

Source: https://docs.superteam.fun/the-superteam-handbook/community/faqs/superteam-earn-faq

The official FAQ distinguishes payout routes:
- Superteam/Solana-sponsored listings require a payment form and winner KYC; it says payment is expected within seven days after the form.
- External sponsors generally pay the wallet linked to the winner's Superteam Earn account, but some may require invoices, KYC, or other sponsor-specific processes.

This establishes that crypto-wallet payout is a possible route for some external sponsors, **not** that any specific listing is guaranteed to pay on-chain, that KYC will be unnecessary, or that a payment has been independently verified. No on-chain payout transaction or explicit listing-level payout proof was captured in this audit. Under the user's crypto-proof rule, this is not enough to qualify a listing.

## Public listings reviewed

### 1. Agentic Engineering Grants — Superteam

Official page: https://superteam.fun/earn/grants/agentic-engineering/

- Advertised amount: 200 USDG grant.
- Payment terms shown: 50% upfront after KYC; 50% after shipping a working Solana product and submitting the required subscription receipts.
- Page status: **Applications Paused**.
- Decision: **EXCLUDED**. Applications are paused; KYC is required; the grant is a reimbursement/subscription-grant workflow, not a proven no-prepayment crypto bounty with independently evidenced settlement.

### 2. Develop Solana Ecosystem Auto-Updating Report & Interactive Dashboard — Superteam Canada

Official page: https://superteam.fun/earn/listing/develop-solana-ecosystem-auto-updating-report-and-interactive-dashboard

- Advertised prize pool: 1,000 USDG (500 / 300 / 200).
- Eligibility: listing explicitly says **only open to people in Canada**.
- Detail page shows a winner-announcement date of 15 September 2026 and the captured page includes comments questioning completion/announcement.
- Decision: **EXCLUDED**. Region restriction excludes a France-based candidate, and the detail page's deadline/announcement data is stale relative to the audit date. No agent eligibility or on-chain payout proof established.

### 3. Why Digital Credit Matters — Apyx

Official page: https://superteam.fun/earn/listing/why-digital-credit-matters/

- Advertised prize pool: 2,000 USDC; five prize places.
- Detail page shows winner announcement scheduled for 1 September 2026, 459 submissions, and a completed/winners section.
- Decision: **EXCLUDED**. The page is past its stated announcement date and shows winners; it is not treated as an open opportunity.

### 4. Compose X Thread Explaining Segmento & On-Chain User Intelligence — Segmento

Official page: https://superteam.fun/earn/listing/compose-x-thread-explaining-segmento-and-on-chain-user-intelligence

- Advertised prize pool: 300 USDC.
- Detail page shows winner announcement scheduled for 14 September 2026 and winners/submissions.
- Requirements include an original English X thread, following the sponsor on X, joining Telegram, and registering as a KOL on Segmento.
- Decision: **EXCLUDED**. Past stated announcement date and winner section; also requires additional platform registration. No agent eligibility or independent crypto settlement proof.

### 5. FairScale QRT Campaign for Custom $ANSEM Score — FairScale

Official page: https://superteam.fun/earn/listing/fairscale-ansem

- Advertised prize: 100 USDC.
- Detail page shows winner announcement scheduled for 10 September 2026 and 70 submissions.
- Requires following FairScale on X, quote-reposting a specified post, and submitting the public QRT link.
- Decision: **EXCLUDED**. Past stated announcement date. No agent eligibility or independent crypto settlement proof.

### 6. Other listings shown in Superteam's public feed

Public feed: https://superteam.fun/earn/regions/france/

The feed snapshot displayed several USDC/USDG listings with relative deadlines, including a Manual QA task and content tasks. However, the corresponding detail pages and feed captures did not provide a consistent, independently verified live status for this audit date. Feed presence and a relative “due in” label alone are not sufficient to certify that a task is still open. No task was promoted from these snapshots.

## Fees and net reward

- No official source reviewed here specifies a platform fee or deduction applicable to every candidate listing.
- Therefore net reward after platform/wallet/network fees is **unknown**, not assumed to equal the advertised prize.
- No listing passes the requested proof threshold until its live details establish an active deadline, exact crypto asset/network, payout route, any KYC/invoice requirement, any participant cost, and agent eligibility (if the intended submitter is an agent).
- For any future listing, expected net must be calculated only from confirmed fees and the exact reward tier; competitive prize pools are not guaranteed income.

## External caution (not used as proof of payment)

A third-party review reported that public routes did not expose verifiable payout evidence for sampled agent wins. This is not an official Superteam statement and is not treated as proof of non-payment; it reinforces the conservative rule that announced rewards must not be treated as verified receipts without transaction-level evidence.

## Re-entry criteria

A Superteam opportunity may be reconsidered only when all of the following are evidenced without registering or submitting during discovery:
1. Official listing detail confirms the listing is currently open and the deadline is future.
2. Region and task-specific eligibility are compatible with the intended participant.
3. If automation submission is intended, official listing data confirms `agentAccess` is `AGENT_ALLOWED` or `AGENT_ONLY`; do not register just to discover this without separate approval.
4. The exact asset/network and a credible wallet payout route are specified; no upfront payment is required.
5. Applicable KYC/invoice requirements and all platform, network, and withdrawal costs are disclosed.
6. A credible payout proof standard is available; advertised prize text alone is not proof of receipt.

## Safety and state

- No agent registration or account creation.
- No API key or claim code requested or generated.
- No listing submitted/applied to, no external messages posted, and no task claimed.
- No wallet signing, payment, or financial transaction.
- No deployment or production mutation.
- Current disposition: **0 READY_FOR_REVIEW; all reviewed candidates excluded or blocked on evidence.**
