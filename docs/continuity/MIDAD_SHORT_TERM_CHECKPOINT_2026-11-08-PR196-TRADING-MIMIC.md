# MIDAD — Trading/MIMIC Post-Merge Verification Checkpoint

**Checkpoint date:** 2026-11-08  
**Repository head checked:** `main` at `4bc5bf7222043b5348e2afd92736e849f53182d9`  
**Overall status:** `REVIEW` — PR #196, its MIMIC CI, and GitHub Pages deployment are verified. Production release signing and the deployed MIMIC endpoint's public abuse controls remain open blockers. No Supabase deployment or financial action was performed.

## 1. PR #196 — merged and verified

- PR: [#196 — Integrate MIMIC read-only wallet intelligence into Trading Android](https://github.com/Sirahwaz/Control-room/pull/196)
- Feature head: `31296adb554bd59a0cf8257a361f99b9f119e855`
- Merge commit: `65d32adfb9e54f585be36bee92e25780d2bc2aa5`
- Merge time: `2026-11-08 03:30:48 UTC`
- Changed files: 8.
- Current `main` contains the merge commit; no re-merge is required.

### Exact-head MIMIC CI evidence

- Workflow run: [42442133209](https://github.com/Sirahwaz/Control-room/actions/runs/42442133209)
- Result: `completed / success`.
- Job: `test`, completed successfully.
- Verified steps include MIMIC public-wallet tests, browser runtime smoke, Factory security/quality gate, Android debug APK build and package integrity, Android emulator install/launch, and artifact uploads.
- Artifacts: `MIDAD-Trading-Intelligence-v0.2.1-mimic-debug` and `midad-trading-mimic-browser-smoke`.
- Local downloaded APK: `MIDAD-Trading-Intelligence-v0.2.1-mimic-debug.apk`.
- Package ID: `ai.midad.trading`.
- Locally recomputed APK SHA-256: `d94893384e2eee5d597e874c0dc369ba450634581f772c55f58d8c6af9057623`.

**Boundary:** this is a debug APK and emulator evidence. It does not establish physical handset installation or production release signing.

## 2. GitHub Pages — deployed and publicly reachable

- Pages workflow: [Deploy MIDAD Control Room to GitHub Pages](https://github.com/Sirahwaz/Control-room/actions/workflows/pages.yml)
- Latest checked deployment: [run #855](https://github.com/Sirahwaz/Control-room/actions/runs/42444999877)
- Run ID: `42444999877`.
- Time: `2026-11-08 04:00:18 UTC`.
- Result: `success`, deploy job and its Configure Pages / upload artifact / deploy steps completed.
- Deployed commit: `4bc5bf7222043b5348e2afd92736e849f53182d9`.
- Live URL: [https://sirahwaz.github.io/Control-room/](https://sirahwaz.github.io/Control-room/).

A read-only browser check confirmed that the page renders the title `MIDAD — Neural Control Room` and the `SECURE CONTROL / ACCESS GATE`. It requests a MIDAD Control Room Access Key. No access key, passkey, recovery phrase or private key was entered; no authentication flow was exercised.

The Pages workflow uploads repository root path `.`. Treat all tracked repository content as publicly publishable and never place secrets or private material in tracked files.

## 3. Android release-signing audit

### Verified current configuration

- Product manifest: `mobile/factory/products/midad-trading.json`.
- Product version: `0.2.1`.
- App ID: `ai.midad.trading`.
- Manifest release channel: `debug`.
- MIMIC workflow builds `assembleDebug`.

The generic `.github/workflows/midad-mobile-android.yml` currently generates a temporary JKS during the workflow, signs the release artifact with that per-run temporary key, and removes the signing directory afterward. The generated signing identity is not a persistent product release identity.

### Finding

`BLOCKED — PRODUCTION SIGNING`

A different generated signing key on a later run cannot serve as a stable update-signing identity for an already distributed Android app. The current temporary signing path is suitable only for installability/testing, not for a durable production release channel.

### Required resolution

1. Choose and create/obtain a persistent owner-controlled Android signing identity.
2. Store the keystore and passwords in protected GitHub Actions secrets, never in the repository or APK.
3. Add a release job that fails closed when persistent signing material is absent.
4. Verify the signing certificate fingerprint and APK signature, then retain a protected backup and documented rotation/recovery plan.
5. Keep the debug channel separate from the production release channel.

No persistent key was generated or stored in this checkpoint. Signing identity creation and secret storage require an explicit owner decision.

## 4. Deployed MIMIC Edge Function — live security and parity audit

### Verified deployed state

- Supabase project: `froegigfmpmvtecztfbf`.
- Function: `midad_chain_intelligence`.
- Runtime state: `ACTIVE`.
- Deployed version: `42`.
- Gateway JWT verification: `true`.
- Deployed source SHA-256: `9ad830962823f6228744dd05a85751d2e9e0510412c1413143dd96e0016f891f`.

The deployed source exposes six read-only Etherscan actions: `balance`, `txlist`, `tokentx`, `txlistinternal`, `getsourcecode`, and `profile`. The client integration added in PR #196 calls only `profile`, on manual user request, with one page capped at 50 records. It does not poll, sign, submit orders, transfer funds, or enable copy trading.

### Findings

- No server-side rate limiter or `429` enforcement was found in the inspected deployed v42 source.
- The app uses public client credentials and the legacy `anon` role. Gateway JWT verification therefore does not make this endpoint private to a single trusted operator.
- The deployed `supabase/functions/midad_chain_intelligence/index.ts` path was not found on current repository `main`. The deployed runtime source is therefore not currently represented by an exact repository snapshot at that path.
- The absence of a server-side limiter is an API quota / abuse-resilience risk, not evidence of financial execution capability.

### Required resolution

1. Add a versioned source snapshot for deployed v42 to the repository and verify byte/source parity before changing runtime behavior.
2. Add server-enforced action allowlisting for the mobile use case; keep the public mobile path restricted to `profile` and its bounded paging contract.
3. Add a shared/distributed rate limiter with explicit per-IP and aggregate budgets, response headers, and observable 429 events. An external Redis-compatible limiter is a candidate; provider, free/paid tier, and limits must be evaluated before adding dependencies or secrets.
4. Add tests for allowed/disallowed actions, bounds, rate exhaustion, fail-closed behavior, and concurrent requests.
5. Review every existing consumer before removing any of the other read-only actions.
6. Deploy only after the source is versioned, tests pass, the budget/provider decision is clear, and rollback evidence is ready.

No Supabase function, secret, route, cron job or database object was changed. MIMIC remains public-data-only, manual, bounded and descriptive.

## 5. Evidence and remaining state

| Area | State | Evidence / boundary |
|---|---|---|
| PR #196 merge | `VERIFIED` | Merge commit `65d32adf...` on current main |
| MIMIC exact-head CI | `VERIFIED` | Run `42442133209`, success |
| Debug APK package/hash | `VERIFIED` | `ai.midad.trading`, local SHA-256 above |
| Android emulator | `VERIFIED` | CI install/launch passed |
| Physical handset | `PENDING` | Not remotely verified |
| GitHub Pages | `VERIFIED` | Run `42444999877`, live gate rendered |
| Authenticated Control Room flow | `PENDING` | No key entered; no auth test performed |
| Persistent Android release signing | `BLOCKED` | No durable signing identity/secret binding verified |
| MIMIC source parity in GitHub | `BLOCKED` | Deployed v42 path absent on main |
| MIMIC server rate limiting | `BLOCKED` | No limiter found in deployed v42 source |
| Supabase production changes | `NOT PERFORMED` | No deploy or database mutation |
| Live trading / financial actions | `DISABLED / NOT PERFORMED` | No signing, order, transfer or withdrawal path enabled |

## 6. Next execution order

1. **Repository source parity:** add the exact deployed v42 function source to GitHub, with no behavioral change, then compare and test it.
2. **Server-side MIMIC hardening:** implement an enforced mobile action boundary and shared rate limiter, with tests and a provider/cost decision before deployment.
3. **Persistent Android signing:** obtain owner approval for a durable signing identity and protected GitHub secret storage; then add a separate fail-closed release workflow.
4. **Device verification:** install the debug APK on a physical Android handset and record OS/WebView/app-launch evidence.
5. **Control Room authentication:** after an authorized access key is available through the intended secure flow, test sign-in and guarded routes without requesting secrets in chat.

## 7. Safety and non-actions

- No Supabase production deployment or database schema mutation.
- No Pages configuration change.
- No GitHub Actions secret or signing-key mutation.
- No wallet connection/signature, transfer, withdrawal, trade, or external payment.
- No source deletion or rebuild of the existing Trading/MIMIC integration.
- This checkpoint records evidence and blockers; it does not claim production readiness.
