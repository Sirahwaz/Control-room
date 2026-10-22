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
python -m pip install -r tools/midad-browser-runtime/requirements.txt
python -m playwright install chromium

Configure secrets outside source control:
- SUPABASE_URL: HTTPS Supabase project URL.
- MIDAD_INGEST_KEY: gateway ingest secret; never print it.
- MIDAD_BROWSER_ALLOWED_HOSTS: comma-separated exact hostnames.
- Optional MIDAD_BROWSER_NAV_TIMEOUT_MS (15000) and MIDAD_BROWSER_JOB_TIMEOUT_SECONDS (45).

Run only an existing authorized job:
python tools/midad-browser-runtime/runner.py --job-json '{"id":"EXISTING_JOB_UUID","current_url":"https://example.com/"}'

Tests use fakes; no network or real browser is needed. Lifecycle contracts cover RUNNING, HUMAN_GATE, bounded retry, cancellation, and never claiming PAID:
cd tools/midad-browser-runtime && python -m unittest -v

No live browser or gateway integration is claimed by unit tests. The worker does not create jobs or activate a queue.
