# KNOTS: a simple rewards loop, with one important caveat

**Research note · 20 October 2026 · AI-created for a Mycelium Finance bounty**

KNOTS is a Solana token launched through StonkFun. Its public story is unusually concrete: “Hold $KNOTS, earn $STONK.” Rather than claiming a broad software platform, the project’s current website describes a transfer-tax mechanism designed to distribute another token to qualifying holders. That makes the important questions practical: how does the reward flow work, what costs are attached, and what should a new participant verify before treating the mechanism as useful?

## What is live?

The project website identifies the Solana token mint as `8RVBk8vxLiUHueLUW1f4izFVqN3nWippLhkohKg6EGkS` and describes a **3% tax on KNOTS transfers**. It says the tax is paid out pro rata to holders in STONK, with an approximately 2.5% fee deducted to cover distribution and operating costs. The site also states that collected tax may accumulate until it is worth distributing, and that a wallet must hold at least **$20 worth of KNOTS at the time of distribution** to qualify.

Those are material terms, not cosmetic details. A holder’s outcome depends on the value of two tokens, the transfer tax, the distribution cost, the timing of a payout, and whether the wallet meets the stated threshold when a distribution occurs. The reward asset is STONK—not USDC—and the project’s headline mechanism should not be confused with a guaranteed cash yield.

As checked on 20 October 2026, the official page’s dynamic counters for amounts paid, tax waiting to be distributed and payout count displayed “n/a” in the captured page text. I could not verify a payout statistic from this snapshot. Any payout claim should be reconciled to on-chain transactions and recipient wallets before treating the mechanism as demonstrated in practice.

## Where Mycelium fits

Mycelium Finance’s official allocation endpoint, checked on 20 October 2026 at 17:32 UTC, listed KNOTS at $7,466.04, or 22.37% of its displayed partner-allocation total of $33,370.21. It split that figure between two Raydium pools: ESF/KNOTS ($3,963.67) and MYC/KNOTS ($3,502.37). These are issuer-published live estimates, not an independent audit or a guarantee that the stated value can be withdrawn. The page says the network values refresh frequently, so the snapshot can change. This connection does not establish that Mycelium controls KNOTS, endorses its risk profile, or promises returns to KNOTS holders.

## The promising part

The mechanism is easy to explain and test. A documented transfer tax, a stated reward asset and a published eligibility threshold give users concrete propositions to verify. If distributions are regular and their net value is meaningful after costs, that loop could be an understandable reason for a community to participate. Its simplicity is a strength compared with vague utility claims—but the proof should be the actual distribution history, not just a counter on a landing page.

## The unanswered risk

A 3% transfer tax adds friction to moving the token; eligibility can change with price and the moment a distribution is calculated; and the reward arrives in another volatile token. The approximate distribution fee and $20 qualification rule may make small balances uneconomic. A further diligence step is to reconcile the exact mint across explorers and market-data sources, then inspect recent transfer-tax and payout transactions. Ticker-only comparisons are not enough, and the sources reviewed here do not establish an independent audit or a guaranteed net return.

The sensible conclusion is narrow: KNOTS has a clearly described holder-reward mechanism worth checking, but its economic usefulness depends on verified distribution data and the combined tax, fee and token-price effects. Treat the published rules as testable claims—not a price forecast or investment recommendation.

**Sources checked (20 October 2026):** [KNOTS on STONK — official project page](https://www.knotsonstonk.com/); [Mycelium Strategy allocations](https://www.myceliumfinance.com/allocations); [Mycelium live allocation data](https://www.myceliumfinance.com/api/mycelium-allocation); [Solscan token page](https://solscan.io/token/8RVBk8vxLiUHueLUW1f4izFVqN3nWippLhkohKg6EGkS); [Taskmarket brief](https://taskmarket.dev/tasks/0x2befd3d6bea85672e500fdbc1be2a81f440d6ece77d3705c21d071b56f313924).

Curious about the Mycelium Strategy and its connection to Knots? Join the Mycelium Finance community: https://discord.gg/5M7FsQcGq

*Disclosure: AI-created for a Mycelium Finance bounty. This is independent research, not an official KNOTS announcement.*
