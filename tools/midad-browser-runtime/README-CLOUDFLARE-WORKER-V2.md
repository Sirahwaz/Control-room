# MIDAD Stateful Browser Worker v2 — Operations & Deployment Gate

**Status at 2026-11-09:** source implementation is in draft PR #233. The 149-test isolated Playwright runtime suite, Architecture Governance, Factory X and Control Room checks passed on commit `0a7c1d5`. The worker has **not** been enrolled or started against a live Cloudflare account. No Cloudflare deployment, Supabase change, VPS mutation, proxy activation or external account action is included.

## 1. Architecture and authority

- GitHub `Sirahwaz/Control-room` is the source of truth for code, contracts, CI and release evidence.
- Cloudflare `midad-continuity-ledger` (SQLite-backed Durable Object) is the intended authoritative task/lease/checkpoint/evidence plane. Its P0–P2 source is merged on `main`, but the Worker and Queues have not been deployed.
- The P3 Browser participant is a single-slot, pull-claim node. Queue/WebSocket events are wake hints only; authenticated `POST /v1/tasks/claim` obtains the authoritative lease.
- Chromium/Playwright executes on an owner-controlled persistent Linux host. That host may be a VPS, local Linux machine, or another approved substrate. A VPS is an execution option, not the architecture's centre.
- The participant reuses the current `AccountRegistry`, `OperatorWorker`, `PersistentSessionPool` and `PlatformBrowserSession`. It does not start the older Supabase Browser job poller or create a second queue.
- Supabase `midad_browser_agent_gateway` v16 remains a separate deployed gateway. PR #232 reconciles its GitHub source mirror; it does not deploy or modify the function.
- The Android app is a user-controlled browser/human-intervention surface. It is not a 24/7 worker host. P4 Android Participant remains a separate pending phase.

## 2. Current P3 safety contract

The worker is deliberately narrow. It accepts only the existing operator runtime's bounded start/status/inspect/navigate/wait/stop actions. Generic `click`, `fill`, `submit_form`, downloads, payment, transfer, withdrawal, wallet signing, deletion and publication remain blocked until a separately verified approval/authorization contract exists.

Before a node reports READY, it must:
- read one valid, owner-scoped, enrolled node token;
- pass the local Chromium `about:blank` runtime smoke;
- read a private exact-host account registry;
- resolve every referenced `MIDAD_...` secret alias from the host environment;
- initialize the AES-256-GCM session store;
- advertise only the capabilities that were actually enrolled;
- report a measured/approved host cost with `cost_estimate_verified=true`.

Claimed tasks are checked against the configured owner, task ID, lease token and 1–3 attempt bound. A browser task is not automatically replayed after an uncertain external effect: the Continuity Ledger moves it to human reconciliation.

## 3. Encrypted session persistence

Playwright `storage_state` is never stored as plaintext. The first implementation uses AES-256-GCM with:
- a 32-byte key injected from the host secret store;
- authenticated context binding owner ID, account ID, exact host, schema version and key ID;
- SHA-256-derived file names that do not disclose account or host labels;
- atomic file replacement, a `0700` store directory and `0600` state files;
- no-follow reads, size limits, file-owner/permission checks and authentication-tag verification.

A graceful worker shutdown saves an authenticated session. An explicit `stop_session` command closes the browser and deletes that account's stored session. A failed login or CAPTCHA/MFA/human-verification gate is not persisted as an authenticated session. A restored session is reused only after the configured post-login success selector is visible.

The initial `EnvironmentSecretProvider` is a host-environment adapter, not the final central encrypted Vault. Keep its secret aliases outside GitHub, APKs, task payloads and chat. Central Vault broker APIs, rotation/revocation lifecycle and Android WebView proxy support are still outstanding.

## 4. Prepare one Linux host

Use an existing authorized Linux host. Do not create a paid instance for this procedure until its incremental cost is known and approved.

Example layout:
- source checkout: `/opt/midad/Control-room`
- private settings and token: `/etc/midad-browser/`
- encrypted session store: `/var/lib/midad-browser/sessions/`
- browser cache: `/var/lib/midad-browser/.cache/ms-playwright/`

Create a dedicated non-root service identity and private directories:

```sh
sudo useradd --system --create-home --home-dir /var/lib/midad-browser --shell /usr/sbin/nologin midad-browser
sudo install -d -o midad-browser -g midad-browser -m 0700 /etc/midad-browser
sudo install -d -o midad-browser -g midad-browser -m 0700 /var/lib/midad-browser
sudo install -d -o midad-browser -g midad-browser -m 0700 /var/lib/midad-browser/sessions
```

Install the repository checkout under `/opt/midad/Control-room`, and ensure the service account can read the repository and execute its virtual environment. Keep the source checkout read-only to the service user.

Install the pinned dependencies and Chromium as the service account:

```sh
sudo -u midad-browser python3 -m venv /opt/midad/Control-room/.venv
sudo -u midad-browser /opt/midad/Control-room/.venv/bin/python -m pip install --disable-pip-version-check -r /opt/midad/Control-room/tools/midad-browser-runtime/requirements.txt
sudo -u midad-browser env HOME=/var/lib/midad-browser PLAYWRIGHT_BROWSERS_PATH=/var/lib/midad-browser/.cache/ms-playwright /opt/midad/Control-room/.venv/bin/python -m playwright install --with-deps chromium
```

The pinned runtime uses Python Playwright `1.64.1`; the dependency is pinned in `requirements.txt`. Use Python 3.10 or later. Do not add `--no-sandbox` to Chromium as a workaround for a misconfigured host; repair the host's Chromium sandbox prerequisites instead.

## 5. Prepare private account profiles and secret aliases

Create `/etc/midad-browser/accounts.json` owned by `midad-browser:midad-browser`, mode `0600`. It contains non-secret metadata only:
- unique account ID and platform key;
- exact approved hostname;
- username;
- login URL and stable selectors;
- explicitly allowed login POST paths/content types;
- a secret reference such as `MIDAD_EXAMPLE_PASSWORD`, never the actual password.

The actual values referenced by these aliases must be injected into the worker process by an approved host-side secret mechanism. The current adapter reads environment variables, so if a protected EnvironmentFile is used, keep it outside the repository, mode `0600`, readable only by the service identity and root. Do not put secrets in `accounts.json`, GitHub Actions inputs, Android assets, logs or browser commands.

Set a 32-byte random session key privately, e.g. generate it with `openssl rand -base64 32`. Do not paste it into the repository or the chat. Keep a secure recovery copy outside the host; losing this key makes existing encrypted sessions unreadable. Rotating the key requires a planned migration/reauthentication, not simply replacing it.

## 6. Enroll one owner-approved node

Enrollment is a distinct administrative action. It requires the owner's explicit consent and the Cloudflare Continuity Ledger admin key. The one-time node token is returned only by the enrollment response and is written to a private file; it is never printed.

Before enrollment:
- verify the deployed Cloudflare Worker and `/health`;
- verify the account remains on the intended plan and no paid upgrade is enabled;
- confirm the exact owner UUID and node ID;
- confirm the token destination does not already contain an old token;
- confirm the actual host cost. Do not claim a zero cost unless the host's incremental cost is actually zero.

Run the tool from the repository. Materialize the admin key from the trusted operator secret manager into a short-lived file owned by `midad-browser`, mode `0600`; do not put the key in shell history, a command argument, `worker.env`, or a GitHub Actions input. Set only the file path in the environment:

```sh
# The secret manager writes the key into this file with owner=midad-browser and mode=0600.
export MIDAD_LEDGER_ADMIN_KEY_FILE=/etc/midad-browser/ledger-admin-key
sudo -u midad-browser env MIDAD_LEDGER_ADMIN_KEY_FILE=/etc/midad-browser/ledger-admin-key /opt/midad/Control-room/.venv/bin/python /opt/midad/Control-room/tools/midad-browser-runtime/enroll_continuity_node.py --ledger-url "$MIDAD_CONTINUITY_LEDGER_URL" --node-id midad-browser-node-01 --owner-id "$MIDAD_CONTINUITY_OWNER_ID" --token-file /etc/midad-browser/node-token --confirm-owner-consent
sudo rm -f /etc/midad-browser/ledger-admin-key
unset MIDAD_LEDGER_ADMIN_KEY_FILE
```

The enrollment helper opens the key file without following symlinks and checks that it is a regular file, owned by the enrolling user, mode `0600`, bounded in size and ASCII-safe. The helper never prints the admin key or the one-time node token. The script refuses an existing token file unless a deliberate rotation is requested. A rotation invalidates the previous token at the ledger, so do not use `--replace-token-file` for routine startup. The generated node-token file is mode `0600`; the service reads it through `MIDAD_CONTINUITY_NODE_TOKEN_FILE`. The running worker does not need the admin key.

## 7. Configure the worker

Copy `deploy/worker-v2.env.example` to `/etc/midad-browser/worker.env`, fill only verified values and protect it:

```sh
sudo chown midad-browser:midad-browser /etc/midad-browser/worker.env
sudo chmod 0600 /etc/midad-browser/worker.env
```

Important settings:
- `MIDAD_CONTINUITY_LEDGER_URL`: the deployed HTTPS `workers.dev` or approved custom origin.
- `MIDAD_CONTINUITY_NODE_ID`, `MIDAD_CONTINUITY_NODE_TOKEN_FILE`, `MIDAD_CONTINUITY_OWNER_ID`: exact enrolled identity.
- `MIDAD_BROWSER_ALLOWED_HOSTS`: comma-separated exact hostnames; no wildcards.
- `MIDAD_CONTINUITY_ENROLLED_CAPABILITIES`: must match the capabilities approved at enrollment.
- `MIDAD_CONTINUITY_COST_ESTIMATE_VERIFIED` and `MIDAD_CONTINUITY_COST_PER_HOUR_USD`: the measured/approved value. Keep verification false until the cost is actually known.
- `MIDAD_BROWSER_SESSION_MASTER_KEY_B64`: 32-byte key in base64, held only in private host configuration.
- `MIDAD_BROWSER_ACCOUNT_REGISTRY`, `MIDAD_BROWSER_SESSION_STORE_DIR`: absolute paths.
- The account's `MIDAD_...` secret aliases: injected securely for this process.

## 8. Run as a managed service

Install `deploy/midad-continuity-browser-worker-v2.service` into `/etc/systemd/system/`, verify the paths match the host's checkout and venv, then:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now midad-continuity-browser-worker-v2
sudo systemctl status midad-continuity-browser-worker-v2 --no-pager
sudo journalctl -u midad-continuity-browser-worker-v2 -n 100 --no-pager
```

The service restarts on failure with a bounded systemd start-rate limit. The worker itself backs off after transient errors and logs only sanitized exception classes. Do not enable multiple replicas for the same owner: this first participant is deliberately single-slot. The Cloudflare ledger enforces leases, but the current Playwright session map is process-local.

## 9. Verification and rollback

A real activation is VERIFIED only when all are true:
1. Cloudflare `GET /health` reports the expected service/schema.
2. Node enrollment is confirmed for the intended owner, with explicit consent.
3. Worker heartbeat is fresh (the ledger's 45-second window) and the node is READY with the expected enrolled capabilities.
4. A harmless `BROWSER_SESSION` task can be enqueued, claimed once, checkpointed, completed, and found in the ledger with sanitized evidence.
5. A restart restores the encrypted session only when the configured success selector is visible.
6. `stop_session` discards the encrypted session, and node revocation closes future claims.
7. No raw page text, credentials, cookies, storage state, OTPs or private keys appear in task payloads, checkpoints, result records or logs.

Rollback: stop and disable the systemd service; revoke the enrolled node through the admin API; verify its wake sockets/leases are closed or reconciled; preserve the encrypted session directory for forensic/recovery purposes unless explicit secure deletion is requested. The worker does not deploy or alter the Cloudflare ledger.

## 10. Explicit remaining work

- Cloudflare production deployment, Queue creation, secrets and a live health test.
- One real owner-approved node enrollment and a measured heartbeat.
- Real Chromium task lifecycle on the host, including interrupted lease and restart recovery.
- P4 Android Participant: secure device pairing, user-visible foreground participation, offline outbox/replay, revoke/pause, native evidence capture and device-local encrypted state.
- Central encrypted Vault broker, short-lived secret leases, rotation/revocation and audit trail.
- Proxy route health/failover and native Android proxy integration.
- A separately tested human-approval service for scoped reversible/high-impact actions.

The Worker v2 code and CI do not, by themselves, satisfy these deployment and P4 gates.
