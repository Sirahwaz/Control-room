# MIDAD Local AI / Neural Mesh Integration

**Status:** ADOPTED — staged integration design  
**Date:** 2026-11-14  
**Target upstream:** https://github.com/techjarves/Uncensored-Local-AI-Multiplatform  
**Upstream branch inspected:** `main`  
**MIDAD owner:** `Sirahwaz/Control-room`

## Decision

Adopt the upstream application as a candidate on-device inference runtime for MIDAD Neural Mesh. Do not replace the existing cloud model providers, agent orchestration, Control Room, or mobile application. Integrate through a separately owned provider adapter and an explicit local-device bridge.

The upstream repository remains external and read-only until its licensing and redistribution terms are clarified. GitHub metadata currently reports `license: null`; public visibility is not a license. Do not copy, vendor, redistribute, or modify upstream source as part of MIDAD until rights are established. A separately authored adapter may target the documented OpenAI-compatible API.

## Evidence baseline

- Public Flutter/Dart repository; default branch `main`; repository size reported as 364 KB.
- `pubspec.yaml` declares Flutter SDK `^3.11.4`, `llamadart ^0.6.10`, Hive, GetX and HTTP dependencies.
- README documents a local OpenAI-compatible API at `http://127.0.0.1:4891/v1`.
- Documented endpoints: `GET /v1/models`, `POST /v1/chat/completions`, streaming and non-streaming.
- README roadmap marks Agent Mode as in progress; web search, voice and vision are planned, not assumed available.
- README identifies Android APK v2.0.0. The current pubspec reports `1.1.0+2`; do not assume the branch and release binary are the same build.
- Release v2.0.0 publishes an ARM64 APK with SHA-256 `8f55205e0bdc9e50212a8d1524c7777c879e046f0cdc205a3d5c076970c9684b`.
- The local API binds to loopback by default. Its source also supports an all-interfaces option binding to `0.0.0.0`.
- The inspected request handler routes health, models and chat-completion requests; no authentication gate was observed in the inspected handler. Treat the API as unauthenticated unless a complete source/runtime test proves otherwise.
- GitHub connection has read-only permission on upstream; MIDAD Control-room connection has push permission.

## Integration boundary

```
MIDAD Control Room / Agent Orchestrator
                 |
          MIDAD Model Router
          /              \
 Cloud Provider Adapter   Local AI Adapter
 (existing providers)          |
                         Device Bridge
                               |
                    Uncensored Local AI
                    127.0.0.1:4891/v1
```

### Provider adapter contract

The MIDAD adapter must expose:

- `provider_id = local_device_llm`
- `provider_type = LLM`
- `environment = LOCAL`
- `capabilities = chat, streaming, model_list` (only after endpoint verification)
- `health_status`, `model_id`, `latency_ms`, `tokens_per_second` when available
- Explicit unavailable responses for tool calling, vision, web search and other unsupported capabilities
- Bounded timeout/retry behavior; no unbounded retries
- Provider selection and fallback decisions recorded as non-secret telemetry

### Connectivity and security

1. Keep the upstream API bound to `127.0.0.1` for initial same-device testing.
2. Do not enable the all-interfaces / `0.0.0.0` setting for network or VPS access.
3. Do not expose port 4891 to the public internet.
4. Before remote access, implement an authenticated, encrypted, least-privilege bridge with device pairing, revocation, rate limits and request audit logs.
5. Never embed secrets in the mobile app, browser bundle, repository or model prompts.
6. Do not send private MIDAD records to the local model unless the user/device data boundary and retention behavior are explicit.
7. Keep human approval for financial, wallet-signing, trading and irreversible actions. Local inference does not grant execution authority.

## Delivery sequence

### P0 — Establish a working local runtime
- Confirm device ABI and available RAM/storage before selecting a model.
- Obtain the official release asset; verify the published SHA-256 before installation.
- Install and run on the user's Android device.
- Load a small GGUF model and verify chat, stop, persistence and resource behavior.
- Keep this as an isolated app/runtime test; do not change the production MIDAD APK yet.

### P1 — Build the MIDAD adapter
- Implement an independently authored OpenAI-compatible client behind the existing MIDAD provider abstraction.
- Probe `/healthz` and `/v1/models`; handle offline, no-model-loaded and busy states.
- Support streaming and non-streaming chat.
- Add capability negotiation; reject unsupported tool calls rather than pretending they work.
- Add bounded fallback to existing cloud providers when permitted by data classification and user policy.

### P2 — Control Room integration
- Add Local AI status, selected model, device connectivity and inference metrics to the existing Control Room / AI Room surface.
- Keep local/online routing explainable and operator-controlled.
- Add an explicit offline state and recovery path.

### P3 — Secure remote bridge
- Only after P0/P1 succeed, implement a paired-device bridge for VPS-to-phone requests.
- Default-deny inbound access; authenticated encrypted transport only.
- Add disconnect, revoke and kill-switch behavior.

## Acceptance criteria

- [ ] Official APK checksum matches the published SHA-256.
- [ ] Device can load a small GGUF model and complete a prompt offline.
- [ ] Local API responds on loopback without exposing a LAN/public listener.
- [ ] Adapter detects health, model readiness, busy and offline states.
- [ ] Streaming and non-streaming responses pass contract tests.
- [ ] Unsupported tools/vision/search are explicitly rejected or marked unavailable.
- [ ] Cloud fallback follows data policy and is never silent for private data.
- [ ] No existing MIDAD production route, provider or APK is replaced during initial integration.

## Anti-loop verification policy

This integration has one baseline audit. Do not repeat repository-wide inspection on every session. Re-check only changed files, failed acceptance criteria, new security evidence, or a changed upstream release. Maximum three targeted repair attempts per incident; then record the blocker and escalate.

## Current blockers

1. Upstream license/redistribution terms are not declared in GitHub metadata.
2. No verified access to the user's Android device runtime from this GitHub connector; installation and on-device performance remain pending.
3. No authenticated remote bridge exists; remote VPS connectivity is explicitly out of scope until designed and tested.

## Continuation ledger

- **Goal:** local-first AI runtime integrated into MIDAD Neural Mesh.
- **Last verified evidence:** upstream repository metadata, README API/roadmap, pubspec, changelog, local API server source, v2.0.0 release metadata.
- **Completed:** adoption decision; initial evidence audit; isolated integration branch; integration/security/acceptance specification.
- **Active path:** `feat/midad-local-ai-neural-mesh`.
- **Next action:** verify/download official ARM64 release by published digest, then perform Android smoke test; in parallel, confirm licensing before any source reuse.
