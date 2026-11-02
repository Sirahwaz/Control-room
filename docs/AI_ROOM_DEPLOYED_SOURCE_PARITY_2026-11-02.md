# AI Room deployed source parity — 2026-11-02

## Deployed source evidence

Read-only retrieval from Supabase project `froegigfmpmvtecztfbf` on 2026-11-02:

| Function | Deployed version | Deployment source SHA | Files |
|---|---:|---|---|
| `midad_ai_room_status` | 8 | `3d7c3df9f5473b9ba17165a3c7c7c72be2276248f42ca24234e366dde3bc235b` | `index.ts`, `status-summary.mjs`, `agent-readiness.mjs` |
| `midad_ai_room_preview` | 3 | `f0cbf7c1910f4def88855208d5905de2be8e96ad134eec8f3986805ccf95e43a` | `index.ts` |
| `telegram_bot` | 101 | `910014ecd7992a51b230696f215d305332a8dc81c401819057dab10f2831a1d2` | `index.ts` |

## Preserved behavior

- Status endpoint validates a hashed active Control Room session and enforces a 30-day age bound.
- Browser origins are restricted to the published GitHub Pages origin.
- Six aggregate metrics are returned; large tables use estimated counts and smaller operational metrics use exact counts.
- Agent identity and event evidence is bounded to 200 identities and 50 events, with deterministic read-only readiness synthesis.
- Response guards disable mutations, financial actions, and model calls.
- Preview endpoint accepts GET only and redirects to the fixed GitHub Pages AI Room page; non-GET requests receive 405.
- No secret or private-key material was found in the retrieved status/preview source files. The service-role key is read only from the Supabase environment. The captured deployment SHA records the original deployed bundle; repository-only JSDoc annotations do not alter runtime behavior.

## Deliberate exclusion

The old AI Room PR #100 carries `telegram_bot` v97, while the deployed function is v101. That bot file contains finance/trading command handlers and is not copied from the stale branch. Recover and review the exact deployed v101 source in a separate source-parity change before altering or deploying it.

## Scope

This PR is source recovery and regression coverage only. It does not deploy Edge Functions, change environment variables, change database schema/RLS, rotate credentials, or invoke any Telegram command or financial action.
