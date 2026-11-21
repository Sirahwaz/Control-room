# MIDAD Memory Adapter v1 — isolated core

This package is the first executable slice of `MIDAD_MEMORY_ADAPTER_CONTRACT_V1.md`.
It is a **server-side boundary**, not a browser/mobile SDK, public API, identity provider,
or production Memora deployment.

## Current implementation

- Adapter feature flag defaults to `MIDAD_MEMORY_ADAPTER_ENABLED=false`.
- A caller must supply a verified `Principal` created by MIDAD's trusted server-side
  authentication and policy layer. This package does not authenticate users itself.
- Owner scope, project membership, agent identity, run identity, and capabilities are
  taken from that principal. Caller-supplied store/owner/tenant routing fields are rejected.
- `create` injects scope and provenance metadata; `search` passes scope predicates to
  the backend before ranking/truncation and independently rejects out-of-scope results.
- Prompt-like memory content is tagged as untrusted data. Secret-like values, oversized
  payloads, unknown operations, and unapproved projects fail closed.
- A local SQLite intent ledger enforces stable-key replay and payload-conflict detection.
  The backend must also implement idempotent create by the supplied intent key to cover
  process interruption between backend commit and ledger commit.

## Explicitly not implemented / not authorized

- No production MIDAD auth/policy resolver is wired into this package.
- A pinned Memora API v1 HTTP backend is implemented in `memora_api_backend.py`.
- A private service-to-service HTTP entrypoint is implemented in `server.py`; it requires
  a 32+ character server key, HTTPS ingress, an absolute durable SQLite ledger path,
  explicit owner-to-store routes, and server-only Memora bearer-token environment bindings.
- A Supabase Edge Gateway is implemented at `supabase/functions/midad_memory_gateway`.
  It resolves the existing owner-bound Control Room session, verifies ownership of a
  `midad_factory_projects` project, checks an explicit service-managed agent grant,
  verifies a RUNNING `midad_factory_runs` row, writes metadata-only audit events, then
  forwards a server-resolved principal to the private adapter service.
- The in-memory backend remains test-only; it is never selected as a runtime fallback.
- `update`, `absorb`, `digest`, `graph`, `export`, and `restore` return
  `CAPABILITY_UNAVAILABLE`.
- No production endpoint, database, credentials, user data, paid host, or feature-flag
  activation is included.

## Test

From this directory:

```sh
python -m unittest -v test_midad_memory_adapter
```

The CI workflow runs this suite on an isolated GitHub-hosted runner. Passing these unit
tests validates the adapter boundary only; it does not prove Memora backend compatibility,
cross-process transactionality, production authentication, or deployment readiness.

## Current integration gates

1. Apply migration `20261121150000_midad_memory_agent_grants_v1.sql` only after the
   Supabase write path is healthy; it creates empty service-only grants and audit tables.
2. Provision a single synthetic owner/project/agent grant through an approved admin path.
   No grants are seeded automatically and no client can write grants.
3. Deploy the Edge Gateway and private Python service only after configuring separate
   service credentials, a private HTTPS ingress, Memora URL, server-owned owner/store
   routes, per-store bearer token environment bindings, and a durable ledger path.
4. Verify the target Memora store's declared project and transactional-write capability.
   Create remains blocked unless Memora reports `writes: transactional`.
5. Run the owner/project/agent/run isolation tests against disposable SQLite-backed stores.
6. Keep both Edge and Python feature flags false until an explicitly approved synthetic pilot.

No production endpoint, credential, route mapping, migration application, data migration,
deployment, or feature-flag activation has been performed.

## Memora API backend

`memora_api_backend.py` implements the pinned upstream plain-HTTP API v1 contract
(`agentic-box/memora@442ca1b4ef494c256917ecd052dedb872710e84a`), not an MCP session.
It uses only Python's standard library, HTTPS, bounded timeouts/responses, bearer
authentication, and disables HTTP redirects.

The trusted server composition layer must construct `MemoraApiBackend` with:
- `base_url`: private HTTPS Memora API origin (HTTP only for loopback tests);
- `owner_routes`: server-owned mapping from authenticated MIDAD owner scope to
  a Memora store and a token *environment variable name*;
- `environ`: server environment containing the token values (never send tokens
  in requests from agents or clients).

Example shape (illustrative names only; do not commit token values):

```python
owner_routes = {
    "midad-owner:123e4567-e89b-42d3-a456-426614174000": {
        "store": "owner_123e4567",
        "token_env": "MIDAD_MEMORA_API_TOKEN_TENANT_A",
    },
}
backend = MemoraApiBackend(
    base_url="https://memora.internal",
    owner_routes=owner_routes,
)
adapter = MemoryAdapter(backend, idempotency_db_path="/secure/runtime/memory-intents.sqlite3")
```

The backend requires a healthy Memora v1 store. Reads require the store's
declared project scope; writes additionally require `writes: transactional`.
If Memora reports `writes: unsupported`, the adapter refuses to absorb. The
upstream contract explicitly treats that capability as unsupported until a
transactional backend is proven. This implementation does not override it.

## Trusted MIDAD gateway boundary

`gateway.py` adds a server-side composition point. Every request passes through an
injected `principal_resolver` before reaching the adapter. The resolver must be wired
to MIDAD's existing authenticated principal and policy services; caller-supplied
owner, project, role, and capability fields are not accepted as a substitute.

**Integration status: PENDING.** This repository change does not guess at or replace
MIDAD's identity provider. No real auth resolver, HTTP route, Telegram bot route,
or mobile client is wired by this package. The gateway tests prove fail-closed
behavior for missing, unverified, or failing resolvers. A trusted production
resolver must be selected and independently reviewed before any internal pilot.


## Private service configuration

The Python service requires `MIDAD_MEMORY_ADAPTER_SERVICE_KEY` (32+ random characters).
When enabled, it additionally requires:
- `MIDAD_MEMORA_API_URL` — HTTPS Memora API origin;
- `MIDAD_MEMORA_OWNER_ROUTES_JSON` — server-owned JSON mapping of
  the exact `midad-owner:<owner_user_id UUID>` scope emitted by the Edge Gateway to
  a unique `store` and `token_env` name (never token values);
- `MIDAD_MEMORY_LEDGER_PATH` — absolute durable SQLite path;
- `MIDAD_MEMORY_ADAPTER_ENABLED=true` — explicit opt-in.

The service binds to loopback by default. Any non-loopback deployment must use private
network ingress and TLS termination. Do not expose the Python service directly to browsers.

The gateway additionally requires `midad_factory_runs.agent_key` to match the granted
agent. The migration leaves legacy run rows NULL by design, so they are rejected. The
factory run-creation producer must populate `agent_key` from its trusted execution context
before any memory request can be authorized; that producer wiring remains pending.
The Python server caps concurrent request workers (default 8, maximum 32).


## Upstream Memora authentication prerequisite

The pinned Memora API enforces bearer authentication only when the Memora host is
configured with `MEMORA_API_TOKENS_FILE`. Sending an Authorization header from this
adapter is **not proof** that the upstream host enforces it. Before any pilot, configure
that file on the Memora host, provision high-entropy server-only tokens, and map each
token's SHA-256 digest to exactly one owner store (the upstream file stores hashes, not
raw tokens, and rejects group/other-readable file permissions). Run negative tests proving
requests without a token and with an invalid token receive 401/403. Confirm the valid
owner token succeeds only for its mapped store. Never place token values in this repository,
browser configuration, GitHub workflow logs, or client requests.
