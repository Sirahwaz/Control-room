---
name: midad-nanobot-runtime
description: >-
  Plans and validates Nanobot as MIDAD's self-hosted agent runtime and user-facing
  WebUI/chat/API alternative to an unverified external agent bridge. Requires a
  separately provisioned host, server-side authentication, isolation and real smoke tests.
---

# MIDAD Nanobot Runtime

## State and role

The registry entry and this skill are an integration plan only. Nanobot is NOT installed, hosted, deployed or connected to MIDAD by adding this file. Report UNDEPLOYED until a real host, pinned release, authenticated test and runtime evidence exist.

Nanobot is a self-hosted Python agent runtime with WebUI, chat-channel integrations and an OpenAI-compatible API. It is not an Android-native app, not a model provider, and not a replacement for the MIDAD Intelligence Force Super router. Use this route when MIDAD needs a persistent agent process or a browser/chat interface.

Official upstream: https://github.com/HKUDS/nanobot
Official security guidance: https://github.com/HKUDS/nanobot/blob/main/SECURITY.md
API guide: https://github.com/HKUDS/nanobot/blob/main/docs/openai-api.md
Deployment guide: https://github.com/HKUDS/nanobot/blob/main/docs/deployment.md

## Routing contract

- Intelligence Force Super selects tasks and verifies evidence.
- LeanREA handles authorized binary/package internals; Replica handles clean-room UX mapping and rebuild planning.
- Nanobot supplies the potential long-running agent runtime, WebUI/channel access and API surface.
- Mobile Factory / Factory X remains responsible for product builds, APK integrity and device/emulator smoke tests.
- MIDAD owns authentication, authorization, approvals, logs and any server-side adapter. Do not expose raw Nanobot tool execution directly to a mobile client.

## Host and release preflight

1. Use a dedicated Linux VM/container or an already approved service host. Prefer an isolated Linux host where bubblewrap (bwrap) can be enabled. Never run as root.
2. Use Python 3.11 or newer and one installation method from upstream documentation. Inspect the install script before executing it. Do not pipe a floating remote installer into a privileged shell.
3. Pin an explicit stable release/tag and record its version/commit and dependency audit before deployment. The upstream README observed on 2026-10-28 lists v0.3.5 as its latest release; re-check upstream releases before selecting a version.
4. Use only an already authorized model-provider configuration for the first smoke test. Keep provider credentials in environment references or a secret manager, never in source control, the browser, Telegram messages or APK files.
5. Use a dedicated service identity, a dedicated workspace containing only synthetic test data, restrictive filesystem permissions and a documented stop/rollback action.

## Security boundary

- Start with the WebUI/CLI smoke test in a private isolated instance. Do not add live MIDAD tasks, personal accounts, production credentials, wallets or payment systems.
- Configure an explicit Telegram allowlist or DM pairing before enabling a channel. Use a separate test bot for the pilot; do not attach a live MIDAD bot token to a second polling gateway.
- For Linux, enable the upstream exec sandbox with bwrap and restrict file tools to the workspace. Verify the exact release's configuration schema and prove a harmless sandbox test before marking the sandbox active. If shell/exec cannot be disabled or constrained adequately, keep Nanobot disconnected from MIDAD.
- Do not expose the API to the public internet without TLS, network restrictions and a configured API key. Upstream documents api.apiKey as mandatory when binding to 0.0.0.0 or ::.
- Never call Nanobot directly from the mobile browser with a provider key or shared service token. Put a narrow MIDAD-owned server-side adapter in front of it.
- Upstream documents that API callers share an agent/tool/workspace permission boundary and that session_id is not user authentication. The MIDAD adapter must authenticate the operator, enforce a per-action allowlist, bind sessions to that operator and block arbitrary tool execution. Separate session IDs alone are not isolation.
- Configure request/time/cost limits at the adapter and provider. Log outcomes and evidence, but redact secrets and personal data.
- Keep live financial actions, wallet signing, transfers, withdrawals, real purchases/refunds and production publication disabled.

## Acceptance test

Mark the runtime VERIFIED only when all of these have real evidence:

1. Exact release/commit, Python version, host identity and configuration schema are recorded.
2. nanobot --version and nanobot status complete successfully in the isolated environment.
3. A harmless WebUI conversation succeeds using a synthetic prompt.
4. Local/private API health and an authenticated harmless request succeed; missing or incorrect API credentials are rejected.
5. An out-of-scope shell/file action is denied, with no external or filesystem side effect. If this cannot be demonstrated, do not connect it to MIDAD.
6. Telegram, if used, passes a private test with a restricted identity allowlist; no production bot is reused.
7. Logs are inspected for secret exposure; the stop/rollback procedure is tested.
8. A MIDAD-owned adapter only exposes explicitly approved read-only operations at first. Any write operation requires its own task-level authorization and evidence.

## Reporting

Use VERIFIED, PARTIAL or BLOCKED. The skill itself and a passing registry test are not runtime proof. State whether Nanobot is only documented, installed, locally tested, privately connected or production-connected. Do not promote it to production based on README claims or an HTTP 200 alone.
