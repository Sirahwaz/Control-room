# MIDAD AI Router v34 source restoration and safe public route

- Live deployed function version: `34`
- Snapshot: `2026-11-08`
- Scope: restore the current v34 source to Git and add a separate opt-in public/sanitized routing gate.
- Existing generic and specialist routes remain disabled as before.
- No Edge Function deployment, route activation, model inference, schema change, or secret update.

The new public route requires either:
- `data_class=public` and an allowlisted public source scope; or
- `data_class=sanitized`, `sanitization_verified=true`, and an approved sanitization method.
It blocks obvious secrets and private-key/seed-phrase material. The model gateway independently enforces its provider privacy policy. Caller classification is still an attestation, not a full DLP proof; the deterministic scanner is not a substitute for data governance.
