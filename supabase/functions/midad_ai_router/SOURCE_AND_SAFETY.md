# MIDAD AI Router v34 — source provenance and safe public route

- Supabase function: `midad_ai_router`
- Deployed version observed: `34`
- Supabase source SHA-256: `0a1e4b1c583e16b2429cce4f13206398bf5557c8e315291167a17734073034ea`
- Snapshot date: 2026-11-08
- Branch: `fix/ai-router-public-sanitized-path-20261108`

## Source parity
The deployed v34 source files were compared with this branch:
- `index.ts`: intentionally modified or restored (27011 live bytes; 28274 branch bytes)
- `gemini-catalog.mjs`: byte-identical (1988 live bytes; 1988 branch bytes)
- `provider-gateway-policy.mjs`: byte-identical (1135 live bytes; 1135 branch bytes)
- `deno.json`: byte-identical (3 live bytes; 3 branch bytes)

The `index.ts` changes are limited to an opt-in public/sanitized request gate, the forwarding of `data_class` to the existing Gateway and a separate health indicator for the existing public route. No existing task-class route mappings or generic-route readiness behavior were re-enabled.

## Safety boundary
- Existing `public_sanitized` database route only; no route-table edits.
- Requires public provenance or a verified sanitization declaration/method and blocks obvious secrets.
- Gateway independently enforces its provider policy.
- No inference, deployment, schema change, new Edge Function or secret update.
