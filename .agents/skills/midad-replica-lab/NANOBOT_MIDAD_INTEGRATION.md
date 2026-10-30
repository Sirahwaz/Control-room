# MIDAD Nanobot Runtime Integration

## Decision

Use HKUDS/nanobot as the proposed self-hosted agent runtime and user-facing WebUI/chat/API path instead of the previously considered OnDev Hermes client. The old Hermes checklist is retired. No direct Hermes bridge had been verified, so this changes the selected integration path, not a proven live connection.

Upstream repository: https://github.com/HKUDS/nanobot
Security guidance: https://github.com/HKUDS/nanobot/blob/main/SECURITY.md
API reference: https://github.com/HKUDS/nanobot/blob/main/docs/openai-api.md
Deployment reference: https://github.com/HKUDS/nanobot/blob/main/docs/deployment.md
Latest upstream release listed in the README observed on 2026-10-28: v0.3.5. Re-check release/tag and dependency state before selecting the pilot version.

## What it replaces and what it does not

- Replaces the proposed external client/bridge route for long-running agent UI, chat channels and an API endpoint.
- Does not install a native Android app. On a phone, use its private WebUI or a configured chat channel after a server host is provisioned.
- Does not replace MIDAD Intelligence Force Super, LeanREA, Replica, Mobile Factory, APMIX or a model provider.
- Does not create a live connection just by registering a skill. No Nanobot host or API endpoint is verified by this document.

## Target architecture

Phone/WebUI or a private test chat
-> MIDAD-authenticated server-side adapter
-> isolated Nanobot API/gateway
-> approved model provider

The server-side adapter is an explicit security boundary. The mobile client must never receive the Nanobot API key, model-provider credentials or a privileged MIDAD service key. Keep initial adapter methods read-only and allowlisted. Avoid exposing Nanobot's general tool-running endpoint as a supposedly read-only API unless the selected release has been configured and tested to block all out-of-scope tools.

## Execution sequence

### 1. Select a host before installing

- Inventory existing approved compute first. Prefer a service already operated by MIDAD if it meets the runtime and isolation needs.
- Do not create a new paid service until its cost and limits are known and approved.
- Require Python 3.11 or newer. Prefer a dedicated Linux container/VM with a non-root service account and bwrap support.
- Keep the service off the public internet during the first test. Preserve a clear stop/rollback route.

### 2. Pin and prepare

- Select a stable upstream release and record its tag/commit, package version and dependency audit.
- Inspect the install procedure before running it. Use one documented installer/package-manager path; do not mix install methods.
- Keep provider secrets in server-side environment variables or a secret manager. Set restrictive permissions on Nanobot's home/configuration directories. Never commit secrets.
- Use a separate workspace containing synthetic inputs only. Restrict filesystem access, enable the exec sandbox and validate the configuration against the exact pinned release.
- If the current release cannot safely constrain or disable shell/tool access for the proposed integration, stop before connecting it to MIDAD.

### 3. Verify local runtime

- Run the documented version and status checks.
- Start the private WebUI and send one harmless synthetic prompt such as returning exactly `MIDAD-NANOBOT-READY`.
- Inspect logs for errors and secret exposure.
- Test API health and one authenticated harmless request on loopback or a private network only.
- Verify that missing and incorrect API credentials are rejected. Do not infer the authorization behavior from a successful authorized call alone.

### 4. Test access boundaries

- Bind Telegram only after setting explicit allowFrom identity IDs or a private DM pairing policy. Use a separate test bot; do not reuse an active production bot token in a second gateway.
- For the API, do not expose a public listener without TLS, network restrictions and api.apiKey. A shared API key is not per-user authorization.
- The upstream API shares the same configured tools, workspace and permissions among callers; session_id identifies conversation history but does not authenticate a user. The adapter must enforce user authorization and prevent one caller from selecting another operator's session.
- Verify that disallowed shell/file actions cannot run and have no side effects. If the sandbox or tool controls cannot prove this, mark BLOCKED and keep Nanobot disconnected.

### 5. Connect MIDAD only after the gate passes

- Use a dedicated server-side adapter/secret, not an API call from the mobile UI.
- Start with read-only operations that map to existing, reviewed MIDAD services. Never pass arbitrary user input directly to a shell or unrestricted tool call.
- Log request ID, action, authorization decision, completion status and evidence references. Redact prompts and outputs where they may contain personal or secret material.
- Keep financial actions disabled. Use max three attempts per incident, then circuit-break and report the exact blocker.
- Require a separate verified release gate before production deployment.

## Acceptance criteria

The pilot is ready for a controlled private connection only when the exact release, host, model configuration, authentication, workspace restrictions, tool sandbox, negative authorization test and successful harmless request are all evidenced. An HTTP 200 or a registry entry does not prove task execution or safety.

## Rollback

Stop the Nanobot service, revoke the test API/bot credentials if exposed, remove the adapter secret, retain redacted diagnostics, and revert the branch changes if CI or policy validation fails. No production runtime was started by preparing this guide.
