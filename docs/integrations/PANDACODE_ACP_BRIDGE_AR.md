# PandaCode ACP Interoperability — MIDAD Factory X

**Status: PENDING — design and disabled adapter registration only**

This document records the integration boundary for evaluating PandaCode-compatible coding agents inside MIDAD. It does not install PandaCode, start a process, expose an endpoint, bind an agent, or authorize repository changes.

## Decision

Keep MIDAD Factory X as the control plane and source of truth for task identity, provider selection, execution policy, approvals, audit events and delivery. Add interoperability only through a separately isolated **Agent Client Protocol (ACP) v1 stdio adapter** when a supported host runtime is available.

Do not embed PandaCode's desktop application in the Telegram Mini App or replace MIDAD's Fabric, Forge, Model Gateway, browser worker or Revenue services.

PandaCode is a native Tauri/Rust desktop workspace. لا توجد واجهة HTTP عامة موثقة لربط MIDAD مباشرة بواجهة PandaCode. Its desktop design does not expose a general-purpose HTTP API for MIDAD. Its headless `pandacode serve` mode is a host for PandaCode Connect clients, not a documented MIDAD REST API. Therefore, a future integration must launch an explicitly installed and authorized ACP-compatible agent as a local subprocess on a managed worker, or use a separately reviewed bridge. Do not assume that a PandaCode Connect relay is an available MIDAD provider.

## Existing MIDAD boundary

The existing Factory X envelope remains authoritative under the **MIDAD-FX-1** contract:

`TASK → AGENT → ACTION → CAPABILITY → PROVIDER → ADAPTER → SAFETY → RESULT`

The existing adapters remain in place. The candidate `acp-stdio-pending` is registered for discovery and architecture planning only:

- `status: PENDING`
- `execution: none`
- `secrets: none`
- no agent binding references it
- the execution fabric must return `ready: false` for it

Do not register PandaCode itself as an active provider: no direct MIDAD-compatible API has been verified. Do not add a new orchestrator or duplicate Factory X's agent registry and task scheduler.

## Proposed ACP boundary

When implementation is approved and the host exists, the adapter may negotiate the ACP v1 protocol over stdin/stdout using JSON-RPC 2.0. The first supported lifecycle should be limited to:

1. `initialize` and capability/version negotiation;
2. optional authentication only through the agent's documented, host-managed login flow;
3. `session/new` or a verified resume/load method;
4. `session/prompt` and bounded streaming `session/update` events;
5. `session/request_permission` routed into MIDAD's human approval queue;
6. `session/cancel`, process-group termination and cleanup.

The adapter should normalize output into MIDAD's existing task/event vocabulary. ACP session IDs are external references, not MIDAD task IDs. Persist a mapping keyed by MIDAD task ID, adapter ID and provider session ID; never infer identity from an agent-supplied title.

Any protocol methods, file operations or terminal requests that the bridge does not explicitly implement must fail closed. لا يتم تشغيل أوامر غير معروفة. A permission request is not permission: preserve the offered option IDs and wait for a recorded approval decision. If the request is cancelled, malformed, expired, or cannot be shown to the authorized user, return a cancelled/denied outcome. Never silently select an allow option.

## Required runtime controls before activation

- **Executable allowlist:** use a configured binary and fixed argument profile; never accept a shell command or executable path from a task prompt.
- **Workspace boundary:** canonicalize the checkout path, require it to be within an approved root, and use an isolated worktree or disposable workspace.
- **Process isolation:** run under a dedicated low-privilege OS identity and sandbox/container where available. A working-directory check alone is not a sandbox.
- **No credential forwarding:** لا تُنقل الأسرار إلى prompts, transcripts, browser UI, artifacts or agent-visible logs. Provider credentials remain in a host secret manager and are passed only to the specific subprocess that needs them.
- **Bounded resources:** cap wall time, stdout/stderr frame size, total output, concurrent processes and retries; terminate the process group on timeout, cancellation, task completion or host shutdown.
- **Protocol validation:** validate JSON-RPC envelopes, message IDs, session IDs, method names and payload shapes at the boundary. Bound each line/frame and reject malformed or oversized data.
- **Approval policy:** edits, command execution, network access, external publication, credential operations and destructive actions follow MIDAD policy; high-impact/irreversible actions require Human Approval.
- **Auditability:** record task ID, adapter version, executable identity, provider/session reference, timestamps, state transitions, permission decision ID, bounded result metadata and failure code. Do not store secrets or unbounded raw transcripts in audit rows.
- **Kill switch:** stop new ACP launches and cancel owned process groups without affecting unrelated MIDAD workers.
- **No financial authority:** ACP agents receive no wallet signing, transfers, withdrawals, live trading or settlement capability.

## Evaluated ACP coding-agent candidates

These are upstream-supported candidates, **not installed or enabled MIDAD providers**:

| Candidate | Verified upstream entry point | Authentication / isolation note | MIDAD decision |
|---|---|---|---|
| Gemini CLI | ACP stdio mode is documented. The ACP page shows `gemini --acp`; the CLI reference has also listed `--experimental-acp`, so pin a release and verify its actual `--help` output before launch. | Headless API-key auth supports `GEMINI_API_KEY`. Its sandbox is disabled by default; Docker/Podman-based sandboxing must be explicitly enabled and the container runtime must actually exist. | **First candidate to evaluate**, because MIDAD already has a Gemini route. No key is copied to GitHub Actions or the browser worker. |
| Kimi Code CLI | `kimi acp` speaks ACP JSON-RPC over stdio. | `kimi login` documents an RFC 8628 device-code OAuth flow; the resulting token is stored on the host. | **Fallback candidate** if a dedicated host can hold its login safely. |
| Hermes Agent | `hermes acp` / `hermes-acp` is documented after installing the ACP extra. | Exposes a broader curated file/tool/terminal workflow, so it needs an especially careful capability and approval review. | **Defer** until MIDAD's permission broker and process sandbox are verified. |

The Gemini CLI sources differ on the exact ACP flag name across documentation pages; do not hard-code either spelling based on a moving upstream branch. Pin a release, inspect its help output, and make a protocol-only handshake before any model call. A documented `--sandbox` option is not proof that a sandbox is active: the host must have the selected Docker/Podman/runtime installed and the CLI must report/use the configured sandbox.

**Provider selection:** do not auto-select any candidate while `acp-stdio-pending` is PENDING. The first real-provider gate should be Gemini CLI on a separate worker with Docker/Podman isolation, an ephemeral workspace, least-privilege credential injection and a read-only prompt. No production secret is to be copied into repository or CI configuration.

## Activation gates

The candidate stays **PENDING** until all of the following are evidenced:

1. A dedicated Linux/Windows/macOS worker or isolated runtime is available and its ownership/permissions are verified.
2. At least one supported ACP v1 CLI is installed, version-pinned and authenticated without exposing credentials to MIDAD's frontend.
3. A protocol client passes fixture tests for initialize, new/resume, streamed updates, malformed messages, permission requests, cancellation, timeout and process cleanup.
4. Workspace traversal, symlink escape, command injection, network egress, output-limit and secret-redaction tests pass.
5. Human approval is connected end-to-end and denial/cancellation cannot be interpreted as authorization.
6. MIDAD Fabric emits a truthful dispatch plan, and the task can be stopped and reconciled after worker restart.
7. A read-only smoke test passes in a disposable repository. File-write tests are added only after the read-only phase passes.

Only then may a separately reviewed change set status to `ACTIVE`, select a provider and bind an appropriate coding agent. No production binding is included in this foundation change.

## PandaCode reuse and licensing

This foundation is a clean-room protocol integration plan; it does not copy PandaCode source code, UI assets or provider implementation. The PandaCode repository advertises an MIT-based license with an additional attribution condition for forks/derivative works distributed publicly or commercially. Any future fork or reuse of substantial PandaCode code must be reviewed against the exact license and include the stated attribution where required. ACP protocol compatibility alone is not a PandaCode fork.

## References

- PandaCode repository: https://github.com/aicodeking/pandacode
- PandaCode provider architecture: https://github.com/aicodeking/pandacode/blob/main/docs/providers.md
- PandaCode headless host: https://github.com/aicodeking/pandacode/blob/main/docs/headless.md
- ACP v1 protocol overview: https://agentclientprotocol.com/protocol/overview
- ACP v1 tool permission flow: https://agentclientprotocol.com/protocol/tool-calls#requesting-permission
- MIDAD Factory X Fabric protocol: https://github.com/Sirahwaz/Control-room/blob/main/mobile/factory/x/FABRIC_PROTOCOL.md
- Gemini CLI ACP mode: https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/acp-mode.md
- Gemini CLI sandbox controls: https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/sandbox.md
- Gemini CLI authentication: https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/authentication.md
- Kimi Code CLI ACP mode: https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-acp
- Kimi Code CLI command/login reference: https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-command
- Hermes Agent ACP host integration: https://hermes-agent.nousresearch.com/docs/user-guide/features/acp

---
This document describes a future capability gate, not a deployed or connected ACP runtime.
