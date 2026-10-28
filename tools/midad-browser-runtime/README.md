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
`revenue_radar.py` maps existing Revenue Radar / `public.opportunities`-shaped rows to qualification results and exact-host, read-only Browser Worker target plans. Registered source hosts: J4C, Bounties.sh, CryptoTask, TaskMarket, BountyBook, BasedAgents, UGig, and Superteam. **Registration means only that the host is a permitted public-read target; it does not mean the source or every listing has verified payout.**

The current payout-terms allowlist is intentionally narrower:
- Bounties.sh official payment FAQ: `https://bounties.sh/faqs` (USDC; escrow required for posted bounties; platform says no commission and covers certain in-platform fees; third-party withdrawal fees remain variable).
- BasedAgents official docs: `https://basedagents.ai/docs` (USDC payout, escrow by default on eligible tasks; settlement depends on acceptance or the stated review timer).
- Taskmarket official fee/payment docs: `https://docs.taskmarket.dev/concepts/fees-payments` (USDC on Base; default 7.5% platform fee; some paid actions cost 0.001 USDC and claim-mode deposits may apply).

Other registered sources remain blocked for payout qualification until their official payment terms are reviewed and added explicitly. Per listing, the adapter also requires explicit asset **and network**, official listing-specific payment evidence, hashes of both the listing and payout terms, evidence checked within 24 hours, funded status, region/KYC eligibility, automation permission, and zero upfront/claim cost. A `payment_coin`, `funded_signal`, prize pool headline, or platform-level crypto support alone never proves the specific task is payable.

Net value = gross reward − platform fee − network fee − claim fee. Priority = net × acceptance probability × payout confidence ÷ estimated hours. Cross-source duplicates are collapsed by listing ID, canonical URL, then normalized title+host. Defaults suppress small opportunities: gross >= $100, net >= $75, expected net >= $50. Each result has `action_authorized: false`; READY_FOR_REVIEW means only that supplied evidence passed the data gates, not permission to submit or claim.

Run against a JSON export (no credentials or network needed):
```sh
cd tools/midad-browser-runtime
python revenue_radar_cli.py opportunities.json > revenue-radar-report.json
cat opportunities.json | python revenue_radar_cli.py
python -m unittest -v
```
Input may be a JSON array or `{"candidates":[...]}`. The CLI reports `paid_provider_used: false`, `browser_jobs_created: 0`, and `external_actions_performed: 0`. This is an offline qualification and planning adapter, not yet a deployed Supabase queue consumer; it does not claim any live payout has been verified.


## Persistent assistant operator sessions

The private queue-backed operator mode supports a platform hint, an in-memory authenticated Playwright session, and subsequent typed commands. Read [README-OPERATOR-MODE.md](README-OPERATOR-MODE.md) for private profile setup, command syntax, action/network safeguards, and deployment requirements. The worker and gateway changes are in PR #128; they are not live until the trusted worker, private environment configuration, and gateway version are deployed.
