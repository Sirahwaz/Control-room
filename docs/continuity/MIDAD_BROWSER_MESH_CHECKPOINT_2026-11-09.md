# MIDAD Browser Mesh — Short-Term Checkpoint (2026-11-09)

**Canonical Notion record:** [MIDAD Browser Mesh — Reality Audit & Build Gate](https://app.notion.com/p/400b132b437d81a8aebfe8b38938cee7)  
**Global boot rules:** [MIDAD Global Continuity](https://app.notion.com/p/3fab132b437d81649bcfe9a5647ebc33)  
**Active engineering checkpoint:** [MIDAD active engineering checkpoint](https://app.notion.com/p/412b132b437d815aa951ddc66a78aa13)

## Mission and architectural invariants

Resume the distributed MIDAD Online & Offline Browser Mesh. Do not reduce this mission to the Android APK.

- GitHub is source, CI, code review and release evidence.
- Cloudflare Durable Objects/Queues are the distributed control/lease/checkpoint plane.
- Linux + Playwright is a persistent browser execution substrate; VPS is optional, not the architecture centre.
- Android/local is an offline-capable browser and human-intervention participant.
- Supabase Gateway v16 is a separate existing control-plane API, not the P3 Cloudflare queue.
- Preserve the existing Browser Gateway, AccountRegistry, OperatorWorker, PersistentSessionPool and native Browser app. Audit → preserve → repair → integrate → upgrade.
- No secrets in Git, APKs, browser page context, task payloads, logs or chat.
- No live financial actions, CAPTCHA/MFA/KYC bypass, wallet signing, withdrawals, transfers or destructive browser actions.

## Source and PR map

| Area | Source / PR | State |
|---|---|---|
| Cloudflare Continuity P0–P2 | [PR #228](https://github.com/Sirahwaz/Control-room/pull/228) | Merged to main; live deployment not verified |
| Native Browser offline shell | [PR #222](https://github.com/Sirahwaz/Control-room/pull/222) | Draft; native Android CI run passed earlier; not full Mesh completion |
| Scoped action policy | [PR #223](https://github.com/Sirahwaz/Control-room/pull/223) | Draft; policy engine exists, full live approval integration pending |
| Supabase Browser Gateway v16 source mirror | [PR #232](https://github.com/Sirahwaz/Control-room/pull/232) | Draft; repository source parity only; no production deploy |
| Proxy / Vault contract | [PR #229](https://github.com/Sirahwaz/Control-room/pull/229) | Draft; stacked on old #222 branch; experimental, no live proxy or final central Vault |
| Stateful Browser Worker v2 | [PR #233](https://github.com/Sirahwaz/Control-room/pull/233) | Draft; P3 source and tests; no live node enrollment/heartbeat |

## P3 — Stateful Browser Worker v2

Current branch: `feat/midad-browser-cloudflare-worker-v2-main-20261109`.

Latest source head at checkpoint creation: `ba1f30c6a2afa178b4cae90cf222b8c436571710`.

Implemented in the PR branch:
- Existing Playwright Operator runtime is reused. Cloudflare pull-claim is authoritative; no second Supabase queue consumer is started.
- Owner-bound `BROWSER_SESSION` workload validation, 64-hex lease token, bounded attempt count, lease renewal, checkpoint, complete/fail and terminal reconciliation on uncertain non-idempotent lease expiry.
- Browser result payloads contain bounded metadata and SHA-256 of page text; raw page text, cookies and storage state are not sent to the ledger.
- First version allows start/status/inspect/navigate/wait/stop only. click/fill/submit and all financial/destructive operations remain blocked.
- AES-256-GCM Playwright storage-state persistence bound to owner/account/exact host/key ID; atomic write, 0700 directory, 0600 files, no-follow reads, restore verification, graceful shutdown persistence and explicit-stop deletion.
- One-time owner-consented Node enrollment helper. Admin key is read from a protected, user-owned file; it is not passed as a command argument or embedded in the worker/APK. Node token is written once to a private file.
- Linux/systemd operations guide, inert environment template and non-root service unit.
- Pinned dependencies: Playwright Python 1.64.1; cryptography 46.0.4.

### CI evidence

Latest complete runtime evidence on commit `dcb1290ea66b413b3925204ab54b58cc9c306f9d`:
- MIDAD Isolated Playwright Runtime Tests: **156 tests passed**.
- Architecture Governance: PASS.
- FIX Contract: PASS.
- Factory X Registry Contract: PASS.
- Control Room Verify: PASS.
- Agentation E2E: PASS.
- Mobile Factory X: PASS.

The subsequent source update `ba1f30c6a2afa178b4cae90cf222b8c436571710` changes the enrollment helper to read the Cloudflare admin key from a protected file and adds explicit admin-key-file tests. **CI for this newer head is PENDING at checkpoint creation; do not copy the older 156-test result forward as if it were new-head evidence.**

## P4 — Android Participant

Design/acceptance contract: `mobile/factory/native/midad-browser/ANDROID_PARTICIPANT_V1.md`.

State: **DESIGN / PENDING IMPLEMENTATION**. Required components:
- owner-authenticated server-side pairing broker; no Cloudflare admin key inside APK;
- Android Keystore-protected device credential;
- user-visible start/pause/stop/revoke controls and appropriate Android foreground-service policy;
- encrypted/idempotent offline outbox and bounded replay/reconciliation;
- device-scoped task claims, local evidence hashes, process-death/reconnect tests.

The Cloudflare `/v1/nodes/enroll` endpoint is admin-only. Android cannot call it directly; a pairing broker must be implemented first. The APK is not an always-on browser server.

## Runtime truth and blockers

- Cloudflare P0–P2 has source and CI evidence, but no production deployment or live `/health` verification.
- No P3 node has been enrolled, no fresh 45-second heartbeat exists, and no real Browser task lifecycle has been executed on a persistent host.
- Supabase `midad_playwright_worker` heartbeat was last observed at `2026-11-05T14:00:04.064Z`; stale/offline.
- Last read-only DB counts: 0 Browser jobs, 0 evidence-ledger rows, 0 linked agent events.
- Central encrypted Vault, short-lived credential leases, rotation/revocation, Proxy health/failover and Android WebView Proxy integration remain pending.
- Existing Linux/VPS runtime must be checked directly before claiming SSH, OS, Chromium or process health. No live host was available through Desktop Commander during this checkpoint.
- No production Supabase function deployment, migration, Cloudflare deployment, VPS mutation, proxy purchase, platform login, customer action or financial operation was performed.

## Next actions

1. Finish CI for PR #233 commit `ba1f30c6a2afa178b4cae90cf222b8c436571710`; inspect failures and update this checkpoint with the exact final run IDs/head.
2. Keep PR #233 Draft until all required checks are green and the source diff is reviewed. Do not merge without the user's approval.
3. Deploy Cloudflare P0–P2 only through the protected environment after account ID/API token/admin/wake secrets are configured. Verify live `/health`.
4. Enroll one owner-approved Linux node using the one-time helper; supply exact allowlist, private registry, secret aliases, AES key and measured host cost.
5. Verify fresh heartbeat and one harmless read-only task: claim → checkpoint → complete → sanitized evidence → restart/session restore → stop/discard.
6. Rebase/review PR #229 on top of the accepted Browser/Continuity foundation; do not activate Proxy until central Vault and route health/failover are implemented.
7. Implement P4 through the owner-authenticated pairing broker and Android Keystore/outbox contract. Run emulator plus offline/reconnect/revoke tests.
8. Verify PR #232 Gateway v16 source parity before any future deployment decision.

## Resume tuple

`GOAL: distributed MIDAD Online & Offline Browser Mesh`  
`LAST VERIFIED: main includes Continuity P0–P2; P3 implementation exists in Draft PR #233; 156 isolated runtime tests passed on dcb1290; later admin-key-file hardening exists on ba1f30c with CI pending`  
`BLOCKERS: verify CI on ba1f30c, deploy Cloudflare, enroll node, fresh heartbeat, real task smoke, P4 Android implementation, final Vault/Proxy integration`  
`NEXT: finish latest PR #233 CI, then owner-approved Cloudflare deployment and one-node smoke`  
`PROHIBITED: APK-only completion claim, VPS-centric rebuild, production mutation without review, secrets in clients/chat/logs, unverified live-worker claims`.
