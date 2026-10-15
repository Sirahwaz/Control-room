# MIDAD Crypto-Only Revenue & Autonomous Execution Policy

**Status:** Binding owner directive  
**Effective:** 2026-10-15  
**Scope:** Revenue discovery, opportunity qualification, platform onboarding, applications/submissions, delivery, checkout, payments, reconciliation, scheduled jobs, autonomous agents, and user-facing opportunity lists.

## 1. Crypto-only payout gate — mandatory, fail closed
MIDAD may only surface, qualify, enqueue, onboard for, or perform work on a platform/opportunity when a cryptocurrency payout path is proven by current official evidence. A platform being a crypto company, mentioning Web3, or displaying a USD price does not prove crypto payout.

Before any work or account action, verify all of:
- Official platform or task-level terms explicitly identify the crypto asset and payout mechanism.
- The receiving network/chain is explicit and supported, with a viable receiving address/wallet path.
- Current listing/task has a real payment amount or a verifiable funded reward; a general prize pool or headline amount is not payment evidence.
- Minimum payout, fees, action/claim fees, release conditions, and net receivable amount are understood.
- Official account, region, KYC/identity, legal terms, and automation eligibility are checked.
- The payout evidence and check time are stored with the candidate/job.

**Reject from the active revenue pipeline:** fiat-only payments (bank transfer, card, PayPal, etc.); unknown or ambiguous payout; a platform that pays fiat which the owner would have to convert later; a crypto token mentioned only in descriptive text; missing asset/network; stale/unsupported payout evidence; unfunded bounty; or any required fee/deposit when external spend is not authorized. Do not create a user task or present the opportunity as qualified to compensate for a failed gate. Keep any internal diagnostic only, clearly blocked.

## 2. Approved evidence model
A candidate passes only when platform registry payout policy is verified, payout mode is crypto_only or crypto_available, official HTTPS evidence exists, the listing itself specifies a recognized crypto asset and network, and current terms/eligibility are compatible. Recheck per listing before submission; platform-level crypto support alone does not prove that every listing pays crypto.

Recognized asset/network examples are not an automatic allowlist: USDC/Base, USDC/Polygon, USDT/TRON, BTC/Bitcoin, ETH/Ethereum, or other explicit supported combinations only after evidence and receiving-path validation. Never infer a chain merely from an asset symbol.

## 3. Autonomous execution first
Use the existing MIDAD architecture; do not rebuild. Run:
**DISCOVER → VERIFY CRYPTO PAYOUT → VERIFY POLICY/REGION/IDENTITY/AUTOMATION → SCORE NET REALIZABLE VALUE → PREPARE → SUBMIT ONLY WHEN AUTHORIZED → BUILD/QA → DELIVER → VERIFY CRYPTO RECEIPT → RECONCILE → LEARN → RETRY/RECOVER.**

Do not ask the owner to perform routine discovery, research, profile drafting, opportunity triage, normal QA, delivery, payment polling, reconciliation, or retry tasks. Automate these steps with bounded retries, timeouts, idempotency, audit logs, and a safe fallback. Keep failures in an internal blocked/retry queue rather than creating repetitive human tasks.

Human checkpoints are reserved for genuinely owner-only actions: KYC/government identity documents, identity or legal acceptance not covered by existing explicit consent, platform-mandated owner claim/checkpoint, wallet signatures, destination changes, deposits/fees/external spending, on-chain transactions, transfers, withdrawals, trading, or investments. Never bypass those checks, request seed phrases/private keys, or claim work/payment succeeded without evidence.

## 4. Zero-spend / receipt truth
No deposits or external spend under the current zero-spend revenue policy. Do not submit to workflows that incur action/claim/gas/platform fees unless already authorized by policy and net ROI guard is satisfied. Application, award, completed work, advertised bounty, or a payment quote is not realized revenue. Revenue counts only after a finalized/authoritatively confirmed inbound crypto receipt is matched to the correct wallet, asset, network, amount, transaction hash, and order/work item.

## 5. Mining pause
Mining, ViaBTC, miner health/scans, hashrate telemetry, mining history, and related cron/agent steps are **PAUSED until the owner explicitly resumes them**. Do not invoke or schedule them from the autonomy loop. This pause must not block or mark the crypto-revenue automation cycle as failed.

## 6. Change-control and test requirements
Preserve existing infrastructure and wallet addresses. Prefer small, reversible changes; inspect before modifying. Every policy/code change must be tested using safe read-only or no-spend probes, and the running version plus observed results must be recorded. Never use a human task as a substitute for finishing routine automation work.
