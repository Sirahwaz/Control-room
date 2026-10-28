# Wispbyte setup — MIDAD Operator Worker

This archive contains source code and example configuration only. It contains **no real credentials**. The worker does not start a signed-in platform session until a real platform profile and password secret are configured in the private Wispbyte panel.

## 1. Upload

1. Open your Wispbyte server → **Files**.
2. Upload `midad-operator-worker.zip` and extract it. If the panel extracts into a folder named `midad-operator-worker`, open that folder and use its `start_worker.sh` startup path.
3. Copy `accounts.example.json` to `accounts.json` using the file manager. Edit `accounts.json` to add a platform you own and are allowed to access. Do not add a real password to this file.

Wispbyte's panel exposes uploads in Files and startup commands/environment variables under Startup. See the official docs: https://wispbyte.com/kb/server-management and https://wispbyte.com/kb/startup-settings.

## 2. Configure Startup

In **Startup**, choose a Python image compatible with Python 3.11+ and set the Startup Command to:

```sh
sh /home/container/midad-operator-worker/start_worker.sh
```

If the files were extracted directly into the server root instead, use:

```sh
sh /home/container/start_worker.sh
```

Set these environment variables in the private Startup settings (not in a committed file):

- `SUPABASE_URL`: your MIDAD Supabase project URL.
- `MIDAD_INGEST_KEY`: the private gateway ingest key. Never share it in chat or place it in the web UI.
- `MIDAD_BROWSER_ALLOWED_HOSTS`: exact hosts only, comma-separated, e.g. `example.com,taskmarket.dev`.
- `MIDAD_OPERATOR_OWNER_USER_ID`: the authorized owner UUID used by MIDAD's browser jobs.
- `MIDAD_BROWSER_ACCOUNT_REGISTRY=/home/container/midad-operator-worker/accounts.json` (adjust if extracted into the root).
- Define each `MIDAD_*_PASSWORD` alias in Wispbyte's environment settings. The profile file stores only the alias, never the password.

Do not put service-role keys or the MIDAD ingest key in GitHub, a profile JSON, this ZIP, or public client code.

## 3. Configure one approved account

Edit `accounts.json` with a per-platform profile containing:
- unique `account_id`, `platform_key`, exact `host`, and unique `aliases`;
- the correct `login_url`, `username`, and username/password/submit/success selectors;
- the exact `login_post_paths` and allowed login content types for that platform's documented login form;
- a secret alias such as `MIDAD_TASKMARKET_PASSWORD`.

Use only accounts you own or are authorized to operate. Do not guess selectors. A profile without the explicit login paths is rejected.

## 4. Start and verify

1. Open **Console** and press Start.
2. Watch logs. The worker should remain running and poll every few seconds. A startup error is not a successful deployment; fix the environment or Playwright runtime error first.
3. First test the gateway/read-only command path before relying on a signed-in account. A profile must have correct site-specific selectors and an injected password secret for login to succeed.

## What happens after startup

A trusted server-side caller can enqueue a short platform hint such as `Taskmarket` to the private `queue_operator_hint` gateway action. The worker resolves the hint against `accounts.json`, starts the configured login flow and checks the success selector. It then keeps the Playwright context in memory for later commands. Stop/restart of the worker discards the session.

This archive alone does **not** connect ChatGPT's conversation to the private gateway. A trusted server-side bridge must be connected to enqueue commands and retrieve sanitized results. Never give the bridge's private key to a public browser.

## Security / first-version limits

- One worker instance per owner queue; atomic multi-worker job claiming is not implemented yet.
- Only exact HTTPS hostnames are allowed. Login POSTs and any subsequent allowed POSTs are tightly scoped to exact profile paths.
- CAPTCHA/MFA/anti-bot challenges stop the login; no bypass is attempted.
- Generic password/token/recovery fields are blocked.
- Payments, withdrawals, transfers, signing, destructive actions and risky paths stay blocked.
- If the container lacks Playwright's OS libraries, the worker will fail to launch Chromium. Use a runtime image that includes the browser's system dependencies; this script does not attempt privileged OS package installation.
