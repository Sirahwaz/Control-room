# Memora Upstream Security & Transport Review

**Review date:** 2026-11-21  
**Repository:** `agentic-box/memora`  
**Reviewed upstream revision:** `442ca1b4ef494c256917ecd052dedb872710e84a`  
**Scope:** source-level review only; no service deployed and no MIDAD production data accessed.

## Decision

**Pilot-only. Remote production exposure remains BLOCKED.** The upstream revision has useful defensive controls, but its remote MCP authentication boundary must not be inferred from the JSON API token mechanism. Keep any initial pilot bound to loopback / an isolated CI runner, with synthetic data.

## Verified findings

1. **HTTP bind default is loopback.** The server source defaults `MEMORA_HOST` to `127.0.0.1`; README documents the same default. This is the safe pilot posture. A non-loopback bind requires a separately verified ingress/authentication boundary.
2. **MCP and custom HTTP routes are distinct security surfaces.** The source constructs `FastMCP("Memory MCP Server", host=..., port=...)`. The README explicitly warns that FastMCP `custom_route()` handlers are unauthenticated even when MCP auth is configured. The health routes therefore implement their own detail restrictions; admin routes use a separate `MEMORA_ADMIN_TOKEN` check.
3. **JSON API v1 is explicitly token-gated.** Routes are not registered unless `MEMORA_API_TOKENS_FILE` is configured. Tokens are stored as SHA-256 digests mapped to allowed store names; the file is opened without following symlinks and is checked for regular-file type, permissions, ownership and size. Requests require a bearer token and are checked for store scope. Request bodies are capped at 64 KiB and API concurrency is bounded.
4. **Do not treat API v1 as a general-purpose MCP replacement.** Its search route uses a read-only connection. Its absorb route invokes `api_absorb.execute` only when `writes_capability(store)` is `transactional`.
5. **Write capability is backend-dependent in this revision.** The code defines transactional capability via `storage.store_is_transactional(store)`; the API absorb executor uses a fenced idempotency claim and a completion update within the absorb transaction. The inspected implementation describes this as local-SQLite-primary support. D1/S3/cloud or otherwise non-transactional stores must be treated as `writes: unsupported`. The older Phase-0 wording in the API contract README does not fully describe the newer implementation; the runtime health capability is authoritative and must be asserted in tests.
6. **Named-store routing is fail-closed.** `/mcp/<name>` binds the database for the MCP session. Unknown stores return a generic 404; the routing wrapper deliberately avoids leaking registry details. The binding is sticky per session, preventing mid-session store switching.
7. **Session resource controls exist.** The streamable-HTTP session guard validates initialize requests before they reach the SDK, bounds initialize body size and rate, and caps sessions. These controls mitigate resource-exhaustion paths but do not replace authentication.
8. **Health and admin routes have separate controls.** Detailed health data uses `MEMORA_HEALTH_TOKEN` or loopback restrictions. Admin routes fail closed without `MEMORA_ADMIN_TOKEN`; the token must be at least 32 ASCII characters and differ from the health token.

## Security conclusions / unresolved items

- **Remote MCP authentication is NOT YET VERIFIED.** The checked server construction and repository documentation do not establish a supported first-party bearer-token policy for every MCP HTTP route. Do not expose `/mcp` publicly or bind it to a public interface until an independently tested authentication proxy/gateway is in front of it.
- **Custom routes require route-specific controls.** Never assume MCP authentication automatically protects `/health`, `/admin/*`, or `/api/v1/*`.
- **API v1 auth is store-scoped, not MIDAD-user auth.** A MIDAD adapter must authenticate its caller and enforce owner/project authorization before calling Memora. Do not map an untrusted client-provided store/project directly to a Memora target.
- **Project isolation is configuration-dependent.** Verify declared project allowlists and cross-project read/write behavior with two synthetic stores and at least two projects before acceptance.
- **The API contract documentation and implementation have drifted on write capability.** Pilot assertions must query health and verify the actual backend capability rather than assume every API absorb is unsupported or transactional.
- **No persistent zero-cost host has been approved or verified.** CI is an ephemeral test runner only, never the production memory host.

## Pilot pin and gates

Use the immutable source revision above as the initial pilot candidate. Before integration, verify its package metadata and dependency lock at that exact revision, then run isolated tests with synthetic data for:

- startup and health;
- MCP tool discovery and the actual MCP create/update/absorb/search/digest/graph/supersession paths;
- JSON API token rejection, allowed-store acceptance, forbidden-store rejection and token rotation;
- API absorb idempotency (same key/same request replay; same key/different request conflict; concurrent claim behavior);
- backend capability reporting (local SQLite transactional; unsupported backends remain non-writable);
- cross-store and cross-project isolation;
- prompt-injection-as-data, secret redaction/rejection, body-size limits and concurrency;
- export/restore, restart recovery, backup integrity and latency.

No MIDAD adapter, production connection, production data import, public endpoint, or paid hosting is authorized by this review.
