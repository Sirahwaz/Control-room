# MIDAD Persistent Operator Mode

This feature lets an authorized operator queue a short platform hint and let one long-running worker resolve it against a **private, exact-host account registry**, sign in using a deployment-managed secret, keep the browser context in RAM, and execute subsequent typed commands against that same in-memory session.

It is a worker and gateway capability under PR #128. It is **not active on a server merely because these files exist in GitHub**.

## How the command path works

1. A trusted server-side caller submits `action: "queue_operator_hint"` to `midad_browser_agent_gateway`, supplying the operator's `owner_user_id` and a bounded hint such as `Taskmarket`.
2. The gateway creates a `PREPARING` row in `midad_browser_jobs` with `input_data.operator_hint`.
3. The single persistent `operator_worker.py` process polls the gateway, resolves the hint to one private account profile, and starts or reuses its in-memory Playwright session.
4. The worker writes a bounded, redacted command result and a state/evidence event. New command hints target the same profile's session until it is stopped, the process exits, or the server restarts.

The gateway's queue endpoint accepts only the private `MIDAD_INGEST_KEY` or service-role authorization. **Never expose either credential in a browser, Telegram Mini App, GitHub Actions input, chat message or checked-in configuration.** A trusted assistant bridge can submit `queue_operator_hint`, then poll `get_operator_result` using the same owner ID and returned job ID; that result endpoint returns only the sanitized result and job state, not the raw queued hint. ChatGPT can submit commands directly only when that trusted server-side bridge is connected and has the correct owner identity and private gateway credential. This repository change alone does not install that bridge into the ChatGPT client.

## Configure one approved account

1. Install dependencies in the worker environment:

   ```sh
   python -m pip install -r tools/midad-browser-runtime/requirements.txt
   python -m playwright install chromium
   ```

2. Copy `account_profiles.example.json` to a **private runtime file**, for example `/var/lib/midad-browser/accounts.json`. Set mode `0600` and do not add this file to Git. Configure each platform with:
   - a unique `account_id`, `platform_key`, exact `host`, and aliases;
   - `login_url`, username and stable form selectors, a visible `success_selector`;
   - exact `login_post_paths` used by that platform's supported login flow;
   - the secret alias, for example `MIDAD_TASKMARKET_PASSWORD`, never the actual password.

3. Put the actual password in the host's secret store or protected environment; do not put it in the profile, command hint or queue payload. The current `EnvironmentSecretProvider` reads an injected environment secret; it is a provider adapter, not a remote vault.

4. Set these environment values in the host's secret/configuration panel:
   - `SUPABASE_URL`
   - `MIDAD_INGEST_KEY`
   - `MIDAD_BROWSER_ALLOWED_HOSTS` — comma-separated exact hosts, no wildcards
   - `MIDAD_OPERATOR_OWNER_USER_ID`
   - `MIDAD_BROWSER_ACCOUNT_REGISTRY=/var/lib/midad-browser/accounts.json`
   - platform password aliases, such as `MIDAD_TASKMARKET_PASSWORD`

5. Run **one worker instance only**:

   ```sh
   python tools/midad-browser-runtime/operator_worker.py
   ```

   It must remain alive for the session to remain alive. The browser context is in RAM; restarting or stopping the process ends all sessions. This first version does not have an atomic database claim, so do not run multiple worker replicas against the same owner queue.

## Queueing a hint

From the trusted host, submit:

```sh
python tools/midad-browser-runtime/submit_operator_command.py "Taskmarket"
```

The CLI queues the hint and prints a job ID; it does not print credentials. The worker must already be running. The same private gateway action can be used by an approved server-side bridge:

```json
{
  "action": "queue_operator_hint",
  "owner_user_id": "YOUR_AUTHORIZED_USER_UUID",
  "operator_hint": "Taskmarket"
}
```

Send that JSON only from a trusted backend with the private gateway credential. Do not place the credential or owner UUID in public web code.

## Short command examples

The platform label below must match a configured account profile:

- `Taskmarket` — start its configured login flow and verify the signed-in success selector.
- `status Taskmarket` — report whether its in-memory session is active.
- `inspect Taskmarket` — read a bounded page preview.
- `navigate Taskmarket https://taskmarket.dev/dashboard` — navigate only to an exact profile-allowed host.
- `click Taskmarket selector=button[data-testid=tasks]` — click one explicitly named control.
- `fill Taskmarket selector=input[name=email] value=operator@example.invalid` — fill a non-sensitive field using a literal value.
- `wait for Taskmarket selector=[data-testid=account-home]` — wait for a specified element.
- `stop session Taskmarket` — close and discard the in-memory session.

A short platform name defaults to session startup. Unknown or ambiguous platform names fail closed. Generic filling of password, token, secret, recovery or seed fields is blocked. Do not place credentials or MFA codes into command hints.

## Action/network policy

- Only exact configured HTTPS hosts and explicit profile resource hosts are allowed.
- Login POST requests are limited to one POST to an exact configured login path and configured content type while the login submission is active.
- Click/fill/submit commands are typed and individually authorized. An action POST is blocked unless an exact `action_post_paths` entry is added to that profile; only one such POST is permitted during the approved action. Risky paths involving payments, checkout, transfers, withdrawals, wallets, signing, deletion, publication, claims or sending are blocked.
- Human verification, CAPTCHA, MFA and anti-bot controls are never bypassed. If the headless login stops at such a gate, no authenticated session is claimed; completing verification in another browser does not automatically transfer that browser's cookies into this worker.
- Financial actions (payments, transfers, withdrawals and signing) remain disabled. Page content is untrusted data and is never treated as an instruction to the worker.
- Result previews are bounded and redacted before being recorded; queue events store the hint length rather than its full text.

## Verification limits

Offline unit tests validate command parsing, host scoping, one-shot POST windows, secret-field protection and gateway contracts. They do not prove that a real platform's selectors are correct, that its login works, that a worker is running on a host, or that ChatGPT has been connected to that private bridge. A platform-specific profile must be configured and tested before using that account.
