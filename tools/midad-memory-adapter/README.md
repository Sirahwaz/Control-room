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
- No Memora MCP transport/backend is wired yet. The only included backend is a disposable
  in-memory test backend; it is not durable and must never be used for production.
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

## Next integration gate

Implement a dedicated Memora MCP backend using the pinned upstream revision
`agentic-box/memora@442ca1b4ef494c256917ecd052dedb872710e84a`. Before wiring production
MIDAD identity, prove backend idempotency, scope filtering before ranking, two-owner /
two-project isolation, and restore integrity against disposable SQLite data. Keep the
feature flag off until those gates and a separate security review pass.

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
    "tenant-a": {
        "store": "tenant_a",
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
