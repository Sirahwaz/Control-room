# MIDAD Neural++ Business OS — Negotiation and Payment Architecture

## Purpose

Connect opportunity qualification, client communication, scoped offers, delivery evidence, and independently verified payment into one auditable deal lifecycle. Reuse existing components; do not duplicate agents, tables, wallets, or payment rails.

## Deal lifecycle

DISCOVERED → QUALIFIED → CLIENT_CONTACT → NEGOTIATION → OFFER_SENT → AGREEMENT_PENDING → AGREED → EXECUTION → QA → DELIVERED → PAYMENT_PENDING → PAYMENT_DETECTED → PAYMENT_VERIFIED → CLOSED

Exception states include REJECTED, BLOCKED, EXPIRED, DISPUTED, and CANCELLED.

Every transition must preserve actor, timestamp, source evidence, policy decision, and an idempotency key. A listing, proposal, invoice, payment intent, or unconfirmed transaction is not collected revenue.

## Component responsibilities

- Client gateway: intake, intent classification, multilingual drafting, negotiation state, and policy gates.
- Agent gateway: bounded orchestration and communication routing.
- Account factory: platform registry, eligibility checks, onboarding preparation, and account/run evidence.
- Browser gateway: authorized browser jobs with human checkpoints.
- Revenue intelligence: opportunity qualification, payout evidence, cost, and net-value gates.
- Payment verifier: independent payment-intent event recording and reconciliation.
- Wallet receipt monitor: observation of inbound receipts; it does not sign or transfer funds.

## Communication policy

- Respect each platform's terms, account state, anti-spam rules, and rate limits.
- Do not create duplicate listings, bypass account restrictions, impersonate users, or evade identity checks.
- Never claim that a buyer agreed, a service was delivered, or a payment was received without evidence.
- Customer messages, offers, and submissions require the configured approval gate.
- Keep customer contact data private and minimize retention.

## Offer and payment policy

- Scope deliverables, acceptance criteria, delivery window, price, network, and refund/dispute conditions before requesting agreement.
- Prefer non-custodial payment rails only when the client and platform permit them and payout evidence is independently verified.
- Require explicit customer agreement and the required owner approval before creating a payment intent.
- A payment intent is not a payment. Count revenue only after an inbound receipt is matched to the correct order and independently verified.
- Do not sign wallets, transfer funds, withdraw, or settle automatically.

## Evidence and failure handling

- Record source provenance, policy decisions, approval identity, idempotency keys, delivery evidence, and reconciliation results.
- Fail closed when platform payout terms, customer agreement, account eligibility, or payment evidence are missing.
- Retry only bounded transient failures; preserve failure reasons and escalate ambiguous or high-impact decisions to a human.
- Keep production versions, account flags, wallet identifiers, live route state, payment metrics, and customer records in private operational systems—not in public documentation.

## Documentation boundary

This file documents architecture and policy only. It does not publish account state, deployment versions, project identifiers, live opportunity lists, payment-intent counts, receipt status, provider credentials, or runtime health.
