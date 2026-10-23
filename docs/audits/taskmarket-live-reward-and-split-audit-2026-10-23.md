# Taskmarket live opportunity and split-reward audit — 2026-10-23

## Summary

The latest read-only MIDAD discovery run completed at 2026-10-23 03:45 UTC: 8 of 8 configured source feeds returned successfully; 90 candidate records were observed and upserted. Three candidates were flagged by the deployed run as passing the payout gate, but that label alone is not sufficient qualification. Current records still show unknown region, KYC and identity eligibility for tasks marked `READY_FOR_REVIEW`.

This report records the strongest public evidence from the current Taskmarket feed and the reward-splitting bug fixed in the open PR branch. No production database update, deployment, registration, wallet connection, submission, or claim was performed.

## Important code defect found

Official Taskmarket fee docs say:
- Default platform fee is 7.5%, deducted before worker payment.
- A fixed-price task's `netReward` is the full post-fee payout.
- For a **split acceptance**, `netReward` is the **total pool being split**, not one worker's share.
- Submitting work is free; connecting a wallet is needed for browser upload. A claim-mode task can require a configured deposit.

Source: https://docs.taskmarket.dev/concepts/fees-payments

The live Taskmarket Q41 listing explicitly states “$1 USDC split across 2 answers” and “up to 2 answers accepted, sharing the $1 USDC escrow equally.” The feed reports `reward=1,000,000` atomic USDC and `netReward=925,000` atomic USDC. That 0.925 USDC is the net pool after the 7.5% fee; it is **not a proven per-recipient net amount**. The previous parser treated it as one entrant's reward and the existing DB row showed `estimated_net_usd = 0.925`, which could overstate the individual payout.

### Branch fix applied

In this branch:
- Added `explicitSharedRewardEvidence(title, description)` to detect explicit split-pool statements without inventing per-recipient amounts.
- Applied the evidence in the Taskmarket adapter, so Q41 gets `rewardIsSharedPool = true` and `payoutSplitCount = 2`.
- Existing qualification gate blocks shared pools with no verified individual share.
- An unresolved shared pool now persists `estimated_net_usd = NULL` rather than showing the pool-level net as a single worker's net.
- Added regression tests for explicit split language and for ordinary fixed-prize text, plus the existing gate test for blocking unknown per-recipient shares.

The fix is in source on branch `fix/revenue-mesh-source-and-qualification-gates`, not deployed. After the code commit and this audit report were added, GitHub Actions verified the latest branch head: revenue qualification regression workflow run [#91](https://github.com/Sirahwaz/Control-room/actions/runs/39897317699) passed **44 tests with 0 failures**; `deno check` passed in the same workflow; [MIDAD Control Room Verify #891](https://github.com/Sirahwaz/Control-room/actions/runs/39897317892) and [MIDAD FIX Contract #479](https://github.com/Sirahwaz/Control-room/actions/runs/39897317696) also passed. These results validate the current branch revision, not a production deployment.

## Current Taskmarket candidates reviewed

### A. Generative Art Card — 10 USDC on Base

Official listing: https://taskmarket.dev/tasks/0x0c29fb776df01aee0c0e36b0af1afeea786c3805e451171e0d7a658e876fa27a

- The live detail page showed **Open**, **201 submissions from 149 submitters**, and “still open and taking more.” Its task deadline in the live feed is 2026-10-24 20:37:37 UTC.
- Reward: 10 USDC on Base, one winner. Taskmarket's 7.5% fee yields **9.25 USDC to the winner** if selected.
- Escrow transaction reported by the official feed: https://basescan.org/tx/0x7e12129c4150d15708b47e97212bdfdc0d3784e498414a6dcd92009cd113a9fc. The MIDAD live verifier reported a successful Base receipt, exact USDC escrow transfer and matching task event with over 12 confirmations during the recorded run. This proves the task escrow was funded; **it does not prove the user's eventual payout**.
- No deposit/stake is required and task submission is free under the official Taskmarket policy. Browser upload requires connecting a wallet or following the agent task flow.
- Deliverable: one original 600x800 portrait GIF, 2–6 seconds, seamless loop, under 5 MB, title and artist plate only, plus process note/source code if generative.
- **Decision: HOLD, not READY_FOR_REVIEW.** Region eligibility, KYC and identity status remain unknown. Competition is high (201 submissions for one winner), so the potential 9.25 USDC reward is not expected income; win probability cannot be inferred reliably from counts alone. No wallet was connected and no submission was made.

### B. FlapJax Receipt Relay Q41 — shared USDC pool

Official listing: https://taskmarket.dev/tasks/0x642b0b54e35e416dacd8a6b27e6e40c63a8d0bc204218649cc229b02bdb2f074

- Public task details state up to two accepted answers share a $1 USDC escrow equally. The live feed showed 20 submissions and a deadline of 2026-10-26 00:14:24 UTC.
- The escrow transfer has been independently verified by the current MIDAD Base-RPC check: https://basescan.org/tx/0xab45fe1cf73e5ab0f1e26753c1d7318692884281baa3608bdaa53a56d7a6c7dd
- The project also advertises 250,000 FLAPJAX per accepted answer, paid separately off-platform. No verified settlement evidence for that separate token bonus was captured; it is excluded from net value.
- The task asks for a detailed on-chain BSC buyback audit and a public audit page. No purchase is required.
- **Decision: BLOCKED pending per-recipient net and eligibility proof.** The source previously reported 0.925 USDC as an individual net; this is the exact split-reward bug addressed above. The public Taskmarket escrow proof does not prove that one submitter receives the full pool.

### C. FlapJax public repost bonus

Official listing: https://taskmarket.dev/tasks/0x484cc084adc37bf0239db0bcc7dbadd3ceccdc55968d7936b21ec220e627182a

- Deadline in the live feed: 2026-10-25 03:09:04 UTC; 40 submissions.
- The task requires a prior Receipt Relay submission to Q31, Q33 or Q35 and a new top-level public post that includes the earlier Taskmarket task ID and the submitter's BSC wallet.
- It advertises an off-platform 100,000 FLAPJAX bonus, but the public task description says **$0.10 USDC per accepted slot** while the feed fields and escrow indicate a **$1 / 0.925 USDC pool**. The human-level reward is not reconciled.
- **Decision: EXCLUDE.** It has a prior-task prerequisite, requires a public posting/wallet details, contains a material reward discrepancy, and the off-platform token bonus is not verified. Do not count the token bonus as net income.

### D. Generative Art Contest — 10 OUSD on Tempo

Official listing: https://taskmarket.dev/tasks/0xc62f600bbdafd826a87255a9ef1ce7dca0c9a4637f8565642e680e7c0b217328

- 55 submissions, deadline in the current feed: 2026-10-25 22:39:15 UTC.
- Although the feed reports an OUSD prize on Tempo, no task-specific escrow transaction proof was captured in this pass; the listing is blocked by the payout gate.
- **Decision: BLOCKED pending independent funding evidence.** No OUSD payout or network fee is assumed.

### E. Taskmarket Tempo launch campaign

Official listing: https://taskmarket.dev/tasks/0xcadd940f93b871ae2e65d4fac238164f277ab7d343f238c1e5f71c91c08b8f00

- The feed advertises 3 USDC, but no task-specific escrow transaction was verified and 55 submissions are shown.
- **Decision: BLOCKED pending payout evidence and full terms.**

## Execution decision

No candidate was advanced as fully eligible. The art card is the clearest funded single-winner task, but 201 existing submissions and unknown user eligibility make it a low-confidence opportunity, not a reliable income plan. The Q41 split pool is low value and had been overstated by the previous parser. FlapJax's separate token bonuses are excluded from net earnings unless independently verified.

Continue public read-only discovery and local preparation only. Keep wallet connection, identity/KYC setup, account registration, public posts, submissions, claims, signing and financial transactions outside this work. Do not merge or deploy the PR until the branch tests can be run on the latest commit and eligibility is properly enforced in production.
