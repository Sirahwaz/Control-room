# AI Router Caller Identity & Production Cutover — 2026-11-08

## Production evidence

- Live `midad_ai_router`: ACTIVE v34, accepts either `x-midad-ingest-key` or `x-midad-autonomy-key`.
- Canonical `Control-room/main` contains a newer router build with an explicit identity distinction:
  - ingest identity for ordinary internal requests and PromptOS compilation;
  - autonomy identity for the `public_sanitized` inference route.
- Live `midad_model_gateway_v3`: ACTIVE v31; accepts the same ingest/autonomy headers.
- The canonical model-gateway source differs from the deployed snapshot only by explicit `undefined` defaults for optional `requestedModel` and `dataClass` parameters in the request-policy helper (Deno/TypeScript inference compatibility). No route or policy change is intended by that small source difference.

## Caller audit (live sources, 2026-11-08)

| Caller | Live version | AI Router action | Caller identity | Task class |
|---|---:|---|---|---|
| `midad_control_room` | 109 | `chat` | ingest | `generic` |
| `midad_orchestrator` | 54 | `promptos_compile` | ingest | PromptOS role/task classification |
| `midad_omni_agent_gateway` | 13 | `promptos_compile` | ingest | PromptOS task class |
| `generate_campaign` | 58 | `promptos_compile` | ingest | `content_creation` |

The known live callers do not request `task_class=public_sanitized` using the ingest identity. PromptOS compilation is a separate early-return action and does not enter the model-inference route guard.

## Public/sanitized route gate

The canonical router requires the autonomy identity before `public_sanitized` inference. It also requires an explicit data class, allowlisted source provenance for public data, or verified sanitization for sanitized data. Sensitive material is rejected before calling the model gateway. Fallback is disabled for this task class.

The only enabled production model route at the time of this audit is `public_sanitized`, OpenRouter `stealth/crouton-alpha`, free budget, public/sanitized only, `data_collection=deny`, `allow_fallbacks=false`, `zdr=false`. It is **not ZDR**. No additional routes have been enabled.

## Deployment decision

**Do not deploy the newer AI Router or Model Gateway until the caller-contract CI and end-to-end service-identity smoke checks are green against the exact deployed environment.** This merge restores the live `midad_control_room` source and codifies caller compatibility; it does not change production behavior, secrets, provider routes, inference, or database state.

No production Edge Function was deployed during this source synchronization.
