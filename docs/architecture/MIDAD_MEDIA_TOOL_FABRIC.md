# MIDAD Media Tool Fabric
**Status:** DESIGN / SOURCE AUDIT COMPLETE / RUNTIME PENDING  
**Target repository:** `Sirahwaz/Control-room`  
**Working branch:** `feat/midad-media-tool-fabric`  
**Audit date:** 2026-11-28

## 1. Objective

Integrate upstream Voicebox and FreeVideo as independently managed media workers behind one MIDAD-owned tool contract. Preserve upstream repositories; do not fork or modify their source unless a later compatibility fix is justified and isolated.

The fabric is an adapter/orchestration boundary, not a replacement for MIDAD's existing agent router, Control Room, storage, or policy layer.

## 2. Source audit findings

### Voicebox — `jamiepine/voicebox`

- License: MIT (`LICENSE` inspected).
- Architecture: Tauri + React/TypeScript UI, FastAPI backend, SQLite state, local model runtimes.
- Upstream documents a REST API and built-in Streamable HTTP MCP server.
- Documented REST operations include speech generation (`POST /generate`, `POST /speak`), transcription (`POST /transcribe`) and profile listing (`GET /profiles`).
- Docker Compose defaults to a CPU build, publishes host port 17600 only on `127.0.0.1`, and declares 4 CPU / 8 GiB memory limits. Generated audio and app data/model cache use persistent volumes.
- Docker image is therefore a viable first deployment candidate, but generation latency and model selection must be measured on the actual worker. Do not expose the upstream API directly to the public internet.

### FreeVideo — `FlashML-org/FreeVideo`

- Source-code license: Apache-2.0 (`LICENSE` inspected).
- The model weights are separately governed by the MiniMax H3 Community License; source-code licensing does not grant unrestricted rights to model weights. Review the current model license and territorial/acceptable-use restrictions before downloading, hosting, or commercial use.
- Linux guide requires x86_64, NVIDIA GPU and driver 580 or newer. Upstream describes 8 GiB VRAM / 16 GiB RAM as a low-end supported configuration for compatible NVIDIA hardware; verify the exact GPU compute capability and current hardware matrix before provisioning.
- Integrates as a ComfyUI workspace/custom node and has a command-line engine. Its server guide documents tokenized access and optional TLS; the upstream warning says the basic LAN token link is not encrypted without TLS.
- The checked-in model inventory lists 14 transformer shards totaling approximately 61.73 GiB, and all listed model artifacts total approximately 92.34 GiB. These are inventory totals, not a claim that every optional artifact is downloaded for every run.
- This is not a phone-hosted workload. It requires a separate compatible GPU worker and substantial disk/cache capacity.

## 3. MIDAD-owned contract

Expose a single internal job contract regardless of upstream engine:

- `GET /health` — worker readiness, provider availability and capability flags.
- `GET /v1/capabilities` — supported operations, formats, limits and resource class.
- `POST /v1/jobs` — submit an allowlisted job; return an opaque MIDAD job ID.
- `GET /v1/jobs/{job_id}` — queued/running/succeeded/failed/cancelled state and safe progress metadata.
- `POST /v1/jobs/{job_id}/cancel` — best-effort cancellation where supported.
- `GET /v1/artifacts/{artifact_id}` — authorized artifact metadata or short-lived download handoff.

Initial operation names:
- `audio.speech.generate`
- `audio.transcription.create`
- `audio.profile.list`
- `video.generate`
- `image.generate` (only if supported by the installed FreeVideo release and model license)

Every request must carry an idempotency key, a bounded input size, an explicit operation, and an authenticated caller identity. Validate URLs and file references; do not accept arbitrary filesystem paths, shell commands, ComfyUI node graphs, or caller-supplied model download URLs.

## 4. Adapter boundaries

### Voicebox adapter
- Call only the documented upstream REST/MCP operations.
- Map upstream task IDs and status into the MIDAD job contract.
- Store generated outputs in MIDAD-approved object storage or a controlled worker volume; persist metadata, not large media blobs, in the operational database.
- Keep Voicebox profile IDs and client bindings behind authorization checks. A profile is not globally selectable merely because it exists.

### FreeVideo adapter
- Treat ComfyUI as a private worker implementation detail.
- First inspect the pinned FreeVideo/ComfyUI source and supported workflow templates; do not invent a generic workflow JSON or assume a stable custom REST API.
- Submit only version-controlled, allowlisted workflow templates. Resolve models from pinned upstream revisions and verify file hashes where supplied.
- Keep ComfyUI bound to loopback/private networking. Put an authenticated MIDAD gateway with TLS in front of it; never expose an unauthenticated ComfyUI port.
- Apply concurrency, timeout, disk-space and GPU-memory admission checks before accepting a job.

## 5. Security and governance

- No API keys, tokens, cookies, voice samples, or customer media in Git.
- Store credentials in the approved secret manager; use least-privilege worker identities and rotate credentials.
- Do not clone or synthesize a real person's voice without documented authorization and applicable consent. Preserve provenance for user-provided voice samples.
- Do not accept arbitrary URLs or remote prompts as instructions to the agent. Treat media metadata, transcripts, and generated content as untrusted data.
- Add retention controls and deletion semantics for source audio, generated media, profiles and logs.
- Add per-user quotas, maximum duration/resolution, job timeouts, rate limits and cancellation.
- Keep high-impact actions (publication, paid provider provisioning, external distribution) behind explicit human approval.
- Record provider/version/model revision, request hash, job ID, artifact hash, timestamps, resource usage and final status in the evidence ledger.

## 6. Deployment topology

```text
MIDAD Agent / Control Room
          |
     Tool Gateway
          |
   Media Job Contract
       /       \
 Voicebox     FreeVideo
 private      private
 worker       GPU worker
       \       /
  Artifact / Evidence Store
          |
   Authorized delivery
```

Voicebox may be trialed first on a CPU Docker worker. FreeVideo must remain `BLOCKED` until a compatible x86_64 NVIDIA worker, sufficient disk, model-license review and TLS/private networking are available.

## 7. Acceptance gates

1. **Source verified:** upstream commit/release pinned; licenses and model terms recorded.
2. **Build verified:** reproducible container/worker build; dependency and image scan; no secrets.
3. **Unit tests:** request validation, idempotency, provider mapping, authorization and state transitions.
4. **Integration tests:** Voicebox health + short speech generation + transcription; FreeVideo health + one small supported image/video workflow on a compatible GPU.
5. **Security tests:** unauthenticated requests denied; private worker ports unreachable externally; artifact access scoped to owner; arbitrary path/URL/command injection rejected.
6. **Runtime verified:** real job completed, artifact playable/downloadable, evidence and resource metrics recorded.
7. **MIDAD integration:** registered tool capability, Control Room visibility and agent policy allowlist. Do not mark production-ready based on README, CI success, or HTTP 200 alone.

## 8. Current execution status

| Track | State | Evidence / blocker |
|---|---|---|
| Voicebox source audit | `SOURCE_PRESENT` | README, LICENSE, Dockerfile and Compose inspected |
| FreeVideo source audit | `SOURCE_PRESENT` | README, LICENSE, Linux guide, setup script, pyproject and model inventory inspected |
| MIDAD integration target | `VERIFIED` | Existing canonical application repository is `Sirahwaz/Control-room`; work isolated on this feature branch |
| Voicebox worker deployment | `PENDING` | Requires an available host/runtime and measured resources |
| FreeVideo worker deployment | `BLOCKED` | No compatible GPU worker has been identified; model inventory is large and model-license review is required |
| Unified adapter implementation | `PENDING` | Implement only after runtime host and upstream API/workflow contracts are pinned |
| End-to-end MIDAD operation | `PENDING` | No service has been deployed or invoked yet |

## 9. Next engineering action

Provision/identify a worker before writing deployment-specific configuration. Prefer an existing authorized host. Do not create paid infrastructure or download multi-gigabyte model weights without explicit cost approval. The first runnable milestone should be Voicebox health + short TTS smoke test; FreeVideo follows only after GPU and license gates pass.
