# MIDAD ACP Runtime — protocol smoke only

**State: VERIFIED protocol fixture / PENDING real provider runtime**

This directory contains a local, deterministic ACP v1 stdio smoke harness. It proves that the pinned Python SDK can spawn a fixture agent, negotiate a session, deliver a prompt, receive a streamed update, and close the child process.

It is **not** a production coding-agent worker and does not connect to PandaCode, Hermes, Copilot, Gemini CLI, Supabase, Forge, or the Wispbyte browser worker.

## Run

Python 3.11+:

```sh
python -m pip install -r tools/midad-acp-runtime/requirements.txt
python -m unittest discover -s tools/midad-acp-runtime -p 'test_*.py' -v
```

Expected sentinel: `MIDAD_ACP_PROTOCOL_OK`.

## Fail-closed smoke policy

- The client advertises no filesystem read/write or terminal capability.
- Every permission request is answered as `cancelled`; no allow option is selected.
- Elicitation requests are declined.
- Child environment variables are explicitly allowlisted; provider keys, Supabase credentials, Telegram tokens and other secrets are omitted.
- Workspace paths are resolved through symlinks and must remain below the approved temporary root.
- Output count and text size are bounded.
- The only launched process is the checked-in Python echo fixture, using argv-based subprocess launch through the ACP SDK. No shell command or user-selected executable is accepted.
- The echo fixture has no tools, filesystem access, terminal, network client or credentials.

## What this test proves — and does not prove

**VERIFIED by this fixture:** ACP v1 initialize/session/prompt/update over stdio, streamed response capture, bounded output, and default-deny client permissions.

**NOT VERIFIED:** a real coding agent, a provider login, API cost/quota, an authenticated model call, a write operation, a secure OS/container sandbox, remote queue delivery, Wispbyte deployment, or MIDAD task persistence.

The Factory X adapter `acp-stdio-pending` therefore remains `PENDING` with `execution: none` and no agent binding. This fixture must not be used to change that status.

## Activation gate for a real agent

A separate implementation must provide an installed/version-pinned ACP CLI, dedicated low-privilege identity, real filesystem/network isolation, provider-only credential injection, process-group lifecycle controls, event persistence, and a verified MIDAD Human Approval bridge. The current Wispbyte Playwright worker has a different browser/session authority boundary and must not be repurposed as the coding-agent sandbox.
