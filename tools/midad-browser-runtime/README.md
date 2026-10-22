# MIDAD Isolated Playwright Runtime (preview)

A separate, fail-closed Playwright worker for public, read-only browser inspection. It records metadata through the deployed Supabase Browser Agent Gateway v3 using record_event; it does not write directly to the evidence table.

## Safety
- Exact hostname allowlist; wildcards are rejected.
- HTTPS/default port only, no embedded credentials, private IPs, or private DNS answers.
- Every browser request, including redirects, scripts, images and XHR, is checked before continuation. Only GET/HEAD; disallowed requests are aborted.
- Fresh browser context per job, no persistent profile, imported cookies, storage state or user sessions. Downloads and service workers disabled.
- Captures bounded visible body text locally, hashes it, and sends only title/status/hash/length metadata to the evidence ledger.
- Records the RUNNING transition before navigation; defers HUMAN_GATE and skips terminal jobs without opening a browser.
- Retries transient navigation errors up to three attempts, records attempt metadata, and records cancellation as CANCELLED rather than FAILED.
- Explicit navigation and overall timeouts; browser context, browser and Playwright runtime are closed in finally.
- No CAPTCHA/MFA bypass, anti-bot evasion, login, clicks, fills, downloads, submissions, publication, wallet operations or payments.
- No paid browser provider. This is a worker library, not deployed as a persistent consumer.

## Setup
Python 3.11+:
```sh
python -m pip install -r tools/midad-browser-runtime/requirements.txt
python -m playwright install chromium
```

Configure secrets outside source control:
- SUPABASE_URL: HTTPS Supabase project URL.
- MIDAD_INGEST_KEY: gateway ingest secret; never print it.
- MIDAD_BROWSER_ALLOWED_HOSTS: comma-separated exact hostnames.
- Optional MIDAD_BROWSER_NAV_TIMEOUT_MS (15000) and MIDAD_BROWSER_JOB_TIMEOUT_SECONDS (45).

Run only an existing authorized job:
```sh
python tools/midad-browser-runtime/runner.py --job-json '{"id":"EXISTING_JOB_UUID","current_url":"https://example.com/"}'
```

Tests use fakes; no network or real browser is needed. Lifecycle contracts cover RUNNING, HUMAN_GATE, bounded retry, cancellation, and never claiming PAID:
```sh
cd tools/midad-browser-runtime && python -m unittest -v
```

No live browser or gateway integration is claimed by unit tests. The worker does not create jobs or activate a queue.

## Revenue Radar adapter (offline-first)
`revenue_radar.py` bridges existing Revenue Radar / `public.opportunities`-shaped rows into:
1. A strict official-host HTTPS source allowlist (J4C, Bounties.sh, CryptoTask, TaskMarket, BountyBook, BasedAgents, UGig, Superteam).
2. Listing-level payout gates: explicit crypto asset **and network**, official payout terms and listing-specific payment evidence, funded status, region/KYC, automation eligibility, and zero upfront/claim cost.
3. Net value = gross reward − platform fee − network fee − claim fee. Priority = net × acceptance probability × payout confidence ÷ estimated hours.
4. Cross-source deduplication by listing ID, canonical URL, then normalized title+host.
5. Read-only GET target plans for the existing Browser Worker. It never creates browser jobs or takes external actions.

Defaults intentionally suppress small opportunities: gross >= $100, net >= $75, expected net >= $50. Tune these thresholds via CLI flags when needed. The adapter fails closed: `payment_coin`, a `funded_signal`, an advertised prize pool, or platform-level crypto support alone never proves a funded crypto payout. Every result has `action_authorized: false`; READY_FOR_REVIEW means evidence is sufficient for review, not permission to submit or claim.

Run against a JSON export (no credentials or network needed):
```sh
cd tools/midad-browser-runtime
python revenue_radar_cli.py opportunities.json > revenue-radar-report.json
# or pipe JSON to stdin:
cat opportunities.json | python revenue_radar_cli.py
python -m unittest -v
```
Input may be a JSON array or `{"candidates":[...]}`. For rows shaped like existing `public.opportunities`, the adapter maps only explicit evidence fields; it does not promote inferred or legacy fields to verified payout proof. Output states `paid_provider_used: false`, `browser_jobs_created: 0`, and `external_actions_performed: 0`. This is a local qualification/plan adapter, not yet a deployed Supabase queue consumer or a claim that any live payout has been verified.
