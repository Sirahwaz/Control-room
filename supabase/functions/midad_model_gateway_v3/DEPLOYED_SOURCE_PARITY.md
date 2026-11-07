# MIDAD Model Gateway — deployed v31 source restoration

- Supabase project: `froegigfmpmvtecztfbf`
- Function: `midad_model_gateway_v3`
- Deployed version observed: `31`
- Deployed source SHA-256: `0279a1a37e64695abc7da1af3c94512cdc96318d165e5f669ff652d5d56c98c5`
- Snapshot captured: 2026-11-08
- Branch: `fix/live-model-gateway-parity-20261108`

## Source comparison
All 11 deployed files were compared with this branch. Ten files are byte-identical to the deployed snapshot. The only difference is `openrouter-request-policy.mjs`: the two already-supported optional destructured fields `requestedModel` and `dataClass` now use explicit `= undefined` defaults. This is a TypeScript/Deno inference compatibility adjustment only; it preserves the deployed runtime behavior and makes the public input shape explicit to the compiler.

## Scope and safety
This is source restoration plus a compiler-compatibility annotation and regression tests. No Supabase deployment, route activation, provider inference, SQL/schema change, or secret modification is included. CI and human review are required before merge. Do not deploy this branch over production as part of the parity repair.
