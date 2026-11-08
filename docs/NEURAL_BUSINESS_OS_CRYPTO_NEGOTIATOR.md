# MIDAD Neural++ Business OS — Crypto-First Negotiation

Status: PARTIALLY DEPLOYED / CONDITIONAL CRYPTO ROUTES ENABLED FOR OWNER-APPROVED NEGOTIATION
Branch: `feat/neural-business-os-crypto-negotiator`

## Objective

Connect existing MIDAD client communication, opportunity intelligence, account factory, browser gateway, payment intent, and payment verification components into one deal lifecycle. Preserve existing systems; do not duplicate tables, agents, or payment rails.

## Explicit separation

The Simafri Linux VPS/runtime provisioning work is a separate infrastructure track. It is not part of this business-agent scope.

## Existing components to reuse

- `midad_client_gateway`: client intake, intent classification, multilingual drafting, negotiation and payment policy gates.
- `midad_omni_agent_gateway`: multilingual communication and orchestration.
- `midad_account_factory`: platform registry, eligibility checks, onboarding preparation, account/run evidence.
- `midad_browser_agent_gateway`: authorized browser jobs and human checkpoints.
- `midad_revenue_intelligence_mesh`: opportunity qualification, payout evidence, cost/net gates.
- `midad_payment_verifier`: payment-intent event recording and independent reconciliation.
- `midad_wallet_receipt_monitor` / existing wallet receipt infrastructure: receipt observation.
- Existing policies: `communication.negotiation_gate`, `payment.verification_gate`, `finance.explicit_action_approval_gate`, `browser.platform_compliance`, `growth.anti_spam`.

## Deal lifecycle

`DISCOVERED → QUALIFIED → CLIENT_CONTACT → NEGOTIATION → OFFER_SENT → AGREEMENT_PENDING → AGREED → EXECUTION → QA → DELIVERED → PAYMENT_PENDING → PAYMENT_DETECTED → PAYMENT_VERIFIED → CLOSED`

Terminal/exception states: `REJECTED`, `BLOCKED`, `EXPIRED`, `DISPUTED`, `CANCELLED`.

Every transition must retain actor, timestamp, source evidence, policy decision, and idempotency key. A listing, invoice, payment intent, or unconfirmed transaction is never equivalent to collected revenue.

## Crypto-first payment negotiator

### Operating stance

Be commercially assertive, direct, persistent within reasonable follow-up limits, and confident about the value and payment terms. Never be rude, deceptive, coercive, spammy, or falsely claim that a buyer has agreed.

1. Default to proposing an approved cryptocurrency rail first when the platform and client permit it.
2. Ask whether the client can pay in crypto if their preference is unknown; do not assume.
3. Offer the exact supported asset and network from verified MIDAD payment routes only (for example, USDC on Base where the route is active and verified).
4. Explain the advantages accurately: fast settlement where applicable, transparent transaction reference, and clear milestone/payment reconciliation. Do not promise zero fees or instant finality.
5. If the client objects, identify the real blocker (wallet access, network, accounting, platform policy, fees, or trust) and address it with concise factual options.
6. Offer structured alternatives when permitted by the approved deal policy: full upfront payment, funded escrow, or milestone payments. Never change the total price, scope, delivery date, refund terms, or payment split outside the approved bounds.
7. If crypto is unavailable or prohibited by the marketplace, do not evade the rule. Escalate or use an explicitly approved alternative rail.
8. Never repeatedly pressure a client after a clear refusal. Record the reason and move to the approved alternative or close the deal.

### Negotiation sequence

- **Anchor:** restate deliverables, acceptance criteria, timeline, and price.
- **Preferred rail:** propose the approved crypto asset/network and explain how the invoice/receipt works.
- **Objection handling:** answer the actual objection; do not invent platform support or tax/accounting assurances.
- **Options:** give no more than two approved payment structures.
- **Close:** ask for explicit confirmation of the selected option before creating/issuing the payment request.
- **Verify:** rely on `midad_payment_verifier` and matched on-chain receipt evidence; never mark paid from a screenshot or client assertion alone.

### Example language (adapt to the buyer's language)

“Based on the agreed scope, the project total is [approved amount]. Our preferred settlement method is [verified asset] on [verified network]. I can issue a payment request with the exact amount and destination through our checkout. Would you prefer full payment or the approved milestone schedule?”

If declined:

“No problem. Is the blocker wallet access, network compatibility, or your internal payment policy? If crypto is not workable, I can check the alternative payment route permitted for this engagement.”

## Autonomy and approval boundaries

### Autonomous within pre-approved policy
- Discover and score public opportunities.
- Verify listing-specific payout, fees, eligibility, region and deadlines.
- Draft and send low-risk factual messages where current policy explicitly allows.
- Ask payment-method preference and explain approved crypto routes.
- Negotiate wording and propose options inside stored price/scope/time floors and ceilings.
- Prepare proposals, invoices/payment intents, work plans, QA evidence and delivery drafts.

### Human approval required
- Any new price floor, discount, scope expansion, refund, penalty, exclusivity, legal commitment, or non-standard contract term.
- Accepting a deal outside the stored approval envelope.
- Creating or changing wallet destinations, signing transactions, transfers, withdrawals, refunds, or any movement of funds.
- KYC/identity attestations, platform terms acceptance where legally binding, or human-only verification.
- Publishing or sending any claim that cannot be substantiated by MIDAD evidence.

### Hard stops
- No impersonation, fake identities, fake portfolio/results, fabricated references, CAPTCHA/MFA/KYC bypass, platform-rule evasion, harassment, or deceptive urgency.
- Never request or store seed phrases, private keys, OTPs, passwords, or recovery codes in agent context.
- Never treat an observed transaction, invoice, payment intent, or unconfirmed transfer as paid revenue.
- No live financial action without explicit approval and the relevant capability policy.

## Required integration work

1. Inspect and document current client gateway decision logic and the actual policy JSON values before changing behavior.
2. Verify the payment routes, supported assets/networks, active status, canonical destination, fees, and receipt monitors.
3. Add crypto preference and objection-handling to the existing negotiation prompt/profile contract, not a duplicate agent or table.
4. Ensure negotiation/payment messages are gated by `communication.negotiation_gate` and `payment.verification_gate`.
5. Add deterministic tests for price-floor enforcement, unsupported networks, client refusal, platform fiat-only policy, unverified receipt, duplicate event, and human-approval escalation.
6. Exercise the flow in dry-run/paper mode; verify logs and evidence before enabling any external send or account action.
7. Deploy only after tests pass and runtime/database write health is verified.

## Acceptance criteria

- A customer message in a supported language is understood and answered in that language, with an Arabic internal summary.
- The agent proposes crypto first only when an approved, verified route exists.
- Exact amount, asset, network, fee disclosure, and destination are sourced from the active payment route, never invented.
- Objections produce a relevant, bounded response and at most two approved alternatives.
- Price/scope/contract deviations create an approval request and cannot silently commit.
- Payment is marked verified only after independent receipt reconciliation against the exact payment intent.
- Every action has audit evidence; retries are idempotent; no duplicate customer messages or payment intents are created.
- The existing Simafri VPS/runtime work remains untouched and separate.

## Current evidence and blockers

- Supabase project `midad-ai` is currently reported ACTIVE_HEALTHY by project listing.
- Existing schema includes client profiles, conversations, messages, payment intents/events, wallet receipts, agent identities, platform registry/accounts, account factory runs, capability policies, and audit logs.
- Current observed counts include 0 client profiles, 0 conversations, 0 messages, 6 payment intents (all observed as expired/cancelled in the inspected status breakdown), 0 payment events, and 0 wallet receipts. Existing opportunity/lead and account-factory records are present.
- The `midad_client_gateway` already reads negotiation/payment policies and voice-profile negotiation/pricing rules; payment/discount/scope/legal intents are classified for elevated handling.
- The `midad_account_factory` already blocks unverified crypto payout routes, unknown identity requirements, mandatory KYC, unsupported regions, and unapproved registration automation.
- The `midad_payment_verifier` already records observations separately from final verification and reconciles against payment intent, route, wallet, token, network, amount and chain-time evidence.
- n8n workflow search returned an internal connector error in this audit; do not assume n8n workflows were inspected. MIDAD native Edge Functions are the current verified execution surface.
- No production code, database rows, external accounts, or customer communications were changed by this design commit.

## Immediate next implementation slice

Implement and test the crypto-first negotiation profile/prompt integration in `midad_client_gateway`, preserving its existing approval and policy gates. Do not create a new database table until a full schema/usage review proves one is necessary.


## Implementation update — 2026-11-07

Status: **PARTIALLY DEPLOYED / LIVE CUSTOMER SEND NOT ENABLED BY THIS CHANGE**

### Crypto-first negotiator
- `midad_client_gateway` is active at version **40**; `verify_jwt=false` preserved from the existing deployed configuration.
- The gateway loads active MIDAD receive routes and monitor state at message time.
- Negotiation helper requires a fresh monitor (10-minute window), exact canonical token match, verifier-supported rail, and network-specific readiness.
- Wallet addresses, token contracts, QR/payment URIs and signing material are not passed to the language model.
- English and Arabic crypto/payment wording is classified as `payment_question` with medium risk and remains approval-gated.
- Prompt is commercially assertive but non-coercive; it prohibits invented routes, invoice issuance, payment claims, wallet changes, signing and transfers.

### Conditional Solana readiness integration
- Live Solana USDC and USDT monitors report `READY_AWAITING_FIRST_TOKEN_ACCOUNT`, `payment_reconciliation_ready=true`, `sender_ata_creation_supported=true`, and zero token accounts.
- The previous negotiator incorrectly excluded these routes because it required monitor status `VERIFIED` and an existing token account.
- Version 40 now admits this narrowly defined conditional state only when the monitor is fresh, the exact mint matches, verifier readiness is true, sender token-account setup support is true, and the route is not explicitly marked non-canonical.
- The route is returned with `requires_approval=true`, `requires_customer_token_account_setup=true`, and `readiness=sender_ata_setup_required`.
- The customer-facing prompt must disclose that the sending wallet may need to create the recipient token account, verify that the payer wallet supports this, and confirm any network/rent fee. Owner confirmation is required before checkout details. This is not a ready checkout or an issued invoice.
- Solana EURC is excluded because its current route metadata explicitly marks it `canonical=false`; it must not be offered until that metadata is verified and corrected.
- Base USDC retains the strict requirement `scan_caught_up=true` and `payment_reconciliation_ready=true`; this change does not relax Base readiness.

### Tests and deployment evidence
- Local Node test suite: **17 passed, 0 failed**, including route freshness, exact mint/token match, Base catch-up gate, conditional Solana setup, missing readiness flags, non-canonical EURC exclusion, manual approval and English/Arabic payment intent.
- TDD confirmed the new conditional Solana test failed against the old helper before implementation and passed after the change.
- Gateway deployment: version **40**, status **ACTIVE**, deployment SHA-256 `4e050c2ec2dde41fd5e481ef95474db772a81509addb7494fe44ce42227c4f3b`.
- Source and tests are committed to branch `feat/neural-business-os-crypto-negotiator`.
- No customer message was sent, no payment intent or invoice was created, no wallet was changed, and no funds were moved.

### Base USDC scanner acceleration
- `midad_base_usdc_monitor` is active at version **20**.
- Maximum scan window increased from 2,000 to 4,000 finalized blocks per route per invocation. Individual RPC requests remain 500 blocks and sequential; cron remains every five minutes.
- Live invocation returned HTTP 200. Both active Base USDC receive routes advanced 4,000 blocks in the observed run and remained `VERIFIED` with zero recorded errors.
- At the latest snapshot, cursors were 53,493,826 and 53,493,625 against finalized block 54,116,048; `scan_caught_up=false` and `payment_reconciliation_ready=false` remain correctly enforced.
- Approximate catch-up time is around 13 hours at the observed cadence and throughput; this is an estimate, not a guarantee.
- No cursor skipping, unbounded concurrency, finality relaxation, or manual readiness override was introduced.

### Current blockers and next implementation
1. Base USDC must finish contiguous finalized-block catch-up and pass independent reconciliation readiness.
2. Solana USDC/USDT remain conditional: the first payer-created recipient token account must appear before normal `VERIFIED` route status. No customer invoice/payment intent is issued by this negotiation integration.
3. Solana EURC remains excluded until canonical route metadata is verified.
4. Exercise the client gateway in dry-run with synthetic customer messages, then verify the exact conditional wording and approval behavior. Do not send a live customer message without explicit approval.
5. Complete Payment Intent → On-chain Receipt → Independent Verification with a controlled test and no real-funds movement unless separately approved.

### GitHub references
- [Negotiation helper](https://github.com/Sirahwaz/midad-intelligence/blob/feat/neural-business-os-crypto-negotiator/supabase/functions/midad_client_gateway/negotiation.js)
- [Gateway](https://github.com/Sirahwaz/midad-intelligence/blob/feat/neural-business-os-crypto-negotiator/supabase/functions/midad_client_gateway/index.ts)
- [Negotiation tests](https://github.com/Sirahwaz/midad-intelligence/blob/feat/neural-business-os-crypto-negotiator/tests/negotiation.test.js)
- [Base scanner](https://github.com/Sirahwaz/midad-intelligence/blob/feat/neural-business-os-crypto-negotiator/supabase/functions/midad_base_usdc_monitor/index.ts)
- [Base scanner acceleration report](https://github.com/Sirahwaz/midad-intelligence/blob/feat/neural-business-os-crypto-negotiator/docs/BASE_USDC_SCAN_ACCELERATION.md)


### Payment-intent creation security gate — newly identified blocker
- Audit of live `midad_client_gateway` version 40 found that its internal `payment_intent_create` action currently accepts caller-supplied amount, asset, network and wallet address and inserts an intent without checking a matching owner-approved approval record or resolving the recipient from a currently verified receive route.
- The endpoint is protected server-to-server by the existing service-role and ingest-key checks, but that authentication boundary is not a substitute for per-payment owner approval and route validation.
- Current database snapshot: 6 historical intents, 0 active intents. No new intent was created during this audit.
- **Do not call `payment_intent_create` in production** until a dedicated flow is implemented: create a pending payment-intent approval bound to exact customer agreement, amount/currency, asset/network, route ID and expiry; owner approves; server revalidates the exact receive route and monitor readiness; recipient address is loaded from the route wallet (never accepted from the caller); approval is consumed idempotently; then create the intent.
- This remains an explicit P0 blocker before live checkout or invoice issuance. Crypto negotiation drafts may proceed only within the existing message approval gates.


## P0 security containment — payment-intent creation disabled (2026-11-07)

- Gateway v42 was deployed ACTIVE (historical containment release; superseded by v45) with the existing server-to-server authentication boundary preserved (verify_jwt=false remains intentional for this authenticated internal gateway).
- At v42, `payment_intent_create` was fail-closed with HTTP 403. This temporary gate was superseded by the owner-approved flow deployed in v45; creation still fails closed unless a valid approval UUID is supplied and the database RPC validates it.
- This prevents caller-supplied amounts, quote values, networks, or wallet addresses from creating payment intents before owner-bound approval and route validation exist.
- Negotiation and client-message handling remain unchanged. No invoices, customer messages, wallet changes, signatures, or transactions were created by this change.
- A regression test covers arbitrary caller fields, caller-supplied approval IDs, and caller-supplied wallet/route fields. The focused local Node guard test passed 1/1; the complete repository suite has not yet been rerun.
- **Remaining P0 at that time:** implement owner approval and atomic route validation. This was implemented in the subsequent v45 release.
- Historical status: containment deployed. Current status is documented below; checkout remains unavailable until a live route is fully verified.


## Live receive-route readiness snapshot (2026-11-07)

Read-only production query of active receive routes and monitor state:
- Base USDC: both active routes report monitor status VERIFIED, but scan_caught_up=false and payment_reconciliation_ready=false. Not eligible for checkout yet.
- Solana USDC and USDT: READY_AWAITING_FIRST_TOKEN_ACCOUNT, payment_reconciliation_ready=true, sender_ata_creation_supported=true, token_accounts=0. Conditional negotiation only; no ready checkout.
- Solana EURC: same pending account state, but route metadata is non-canonical and the negotiator excludes it.
- Avalanche USDT: DEGRADED; excluded.
- Ethereum USDT: monitor VERIFIED but not a supported verifier rail in the current negotiator; excluded.
- Route rows have wallet_id values that currently match midad_wallets rows, but the database has no foreign-key constraint enforcing that relationship. Any secure checkout implementation must verify the join and active wallet properties on every request.
- RLS policies observed: midad_approvals and midad_payment_intents are owner-scoped for authenticated users; client access to revenue routes, wallet monitor state, and wallets is denied. Service-role gateway access remains privileged and must enforce its own validation.


## P0 secure payment approval flow — deployed v45 (2026-11-07)

### Gateway and API flow
- `midad_client_gateway` v45 is ACTIVE; SHA-256 `a47f986ab9aa434c80321c7777becc0c126c77800eb227ed6a0f3a2ec82445bd`. Existing server-to-server service-role + ingest-key authentication remains in place; `verify_jwt=false` is unchanged by design.
- `payment_intent_request`: creates a pending `midad_approvals` row only, and only after a strict live-route preflight. It requires a supported fully VERIFIED route, client ID, conversation ID, exact inbound customer-message ID, and an explicit crypto quote (fiat amount/currency, crypto amount, FX rate, quote source, network, asset, expiry). The exact inbound customer message is copied into approval evidence for owner review. Base must be caught up and reconcilable; Solana must have a verified token account.
- `approval_decide`: owner approval changes only the approval record. It does not send a customer message, create an invoice, or create a payment intent. Rejection/cancellation are supported.
- `payment_intent_create`: accepts only an approval UUID; all caller-supplied amounts, wallet addresses, token/network fields, and quote overrides are ignored. The database RPC is the source of truth.


### Internal action contract
```json
{
  "action": "payment_intent_request",
  "route_id": "<active receive route UUID>",
  "client_id": "<client UUID>",
  "conversation_id": "<conversation UUID>",
  "agreement_message_id": "<inbound client message UUID>",
  "amount_fiat": 125.50,
  "fiat_currency": "USD",
  "settlement_asset": "USDC",
  "network": "base",
  "quoted_crypto_amount": 125.50,
  "fx_rate": 1,
  "quote_source": "owner-approved-quote",
  "expires_in_minutes": 30
}
```
Then owner decision uses `approval_decide` with `{approval_id, decision: "approved"}` or `rejected`. Only after that may the internal caller invoke `payment_intent_create` with `{approval_id}`; no terms or wallet address are accepted at that stage.

### Atomic database issuance
- Additive migration adds `approval_id` and `route_id` to payment intents, a unique partial index (one intent per approval), and `consumed` approval status. Existing payment intents are preserved.
- `midad_create_payment_intent_from_approval` is `SECURITY DEFINER`, fixed `search_path`, and executable only by `service_role` (verified: authenticated=false, anon=false, service_role=true).
- The RPC locks the approval row, requires owner decision metadata and unexpired exact evidence, verifies the exact inbound client message belongs to the same user/client/conversation and is no older than seven days, verifies the approved quote, then locks and revalidates the route, watch-only receive wallet and monitor.
- Supported rails are Base USDC, Solana USDC and Solana USDT only. It checks canonical token contract/mint (case-sensitive for Solana), wallet-address consistency, fresh VERIFIED monitor state, Base scan catch-up + reconciliation, or Solana reconciliation + at least one token account.
- Recipient address is resolved only from `midad_wallets.address`; it is never accepted from the request. Approval consumption and intent insertion occur in one database transaction. Unique approval binding and existing-intent lookup provide replay-safe idempotent retry.

### Verification and current blocker
- Live Edge Function v46 is ACTIVE and source checks confirm the request action, customer-message binding and atomic RPC path are deployed; the old direct `midad_payment_intents` insert path is absent.
- Database checks confirm the two new columns, unique approval index, `consumed` status, customer-message/quote validation, exact Solana mint comparison, service-role-only RPC grants, and rejection of a non-service-role SQL invocation.
- Active payment intents remain **0**; historical total remains **6**. No invoice, payment intent, customer message, wallet change, signature, or transaction was created by this implementation.
- Latest monitor snapshot: Base USDC routes remain VERIFIED but `scan_caught_up=false` and `payment_reconciliation_ready=false`; Solana USDC/USDT remain `READY_AWAITING_FIRST_TOKEN_ACCOUNT` with zero token accounts; Avalanche USDT is DEGRADED; EURC remains non-canonical. Therefore **no route currently qualifies for checkout**, and the RPC correctly blocks issuance until one becomes fully VERIFIED and reconciliable.
- Focused isolated Node validation of approval evidence and strict route preflight: 6/6 passed. The full repository test suite was not run. Draft PR #11 currently reports no CI status checks or workflow runs; do not claim CI passed.

### Migrations
- `202611070001_secure_payment_intent_approval.sql`
- `202611070002_case_sensitive_solana_route_validation.sql`
- `202611070003_payment_approval_evidence_hardening.sql`
- `202611070004_customer_agreement_evidence.sql`
- `202611070005_require_explicit_crypto_quote.sql`

### Review
- Draft PR: https://github.com/Sirahwaz/midad-intelligence/pull/11


## Base USDC catch-up acceleration — scanner v21 (2026-11-07)
- Deployed `midad_base_usdc_monitor` v21 ACTIVE, SHA-256 `bfb32966ccff93c02d2ef051d9900ae72fe4f1e3386637d98e50ab1c3752e35a`.
- Increased bounded sequential scan from 4,000 to 6,000 finalized blocks per active route per invocation; each RPC log query remains capped at 500 blocks (12 chunks per route). Cron job 37 remains every five minutes; no concurrency, finality, or cursor-skip changes.
- One authenticated manual scan after deployment advanced both active Base USDC routes exactly 6,000 blocks, both remained VERIFIED with zero recorded errors. The latest observed lag after the 01:50 UTC scheduled run was about 600k–602k finalized blocks; estimated catch-up about 8.5 hours at current cadence, not guaranteed.
- Focused local Node range tests: 8/8 passed. Full repository suite and CI remain unverified; PR #11 has no reported status checks/workflow runs.
- Checkout remains blocked until Base reports both `scan_caught_up=true` and `payment_reconciliation_ready=true`, or a supported Solana route becomes fully VERIFIED with at least one token account.


## Canonical source synchronization — 2026-11-08

- The deployed `midad_client_gateway` **ACTIVE v48** source and `negotiation.js` were retrieved from Supabase and synchronized into the canonical `Control-room` repository.
- The deployed `midad_base_usdc_monitor` **ACTIVE v23** source and `scan-range.js` were retrieved from Supabase and synchronized into the canonical `Control-room` repository.
- Both deployed entrypoint files were byte-compared with the payment-negotiator branch before synchronization; each matched the live deployed source exactly.
- The secure payment-intent RPC exists in production as SECURITY DEFINER with fixed `search_path=public, pg_temp`; EXECUTE is denied to `anon` and `authenticated`, and granted to `service_role` only.
- Current production state: two Base USDC routes are caught up and reconciliation-ready; no receipts or payment-verifier calls are recorded. All six existing payment intents are expired/cancelled and all four store orders are cancelled. No paid revenue is verified.
- This synchronization records already-deployed source; it does not deploy functions, apply migrations, create payment intents, send customer messages, or move funds.
