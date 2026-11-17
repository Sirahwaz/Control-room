# MIDAD Browser Plugin Runtime Contract — P3

**Status:** Contract implementation / runtime integration pending.

## Trust model

A plugin is untrusted code. Its manifest is a declaration, not an authorization token. The host must validate it, verify package integrity and publisher provenance, show the requested capability/origin scope to the user, and mint a short-lived grant only after explicit approval.

## Manifest v1

Required fields:

- `schemaVersion`: `1`
- `id`: reverse-DNS-style stable identifier
- `name`, `version`, `description`
- `entrypoint`: relative local JavaScript path only
- `integrity`: SHA-256 hex digest of the package payload
- `capabilities`: explicit allowlisted Browser Mesh capabilities
- `origins`: exact HTTPS origins, no wildcard/subdomain patterns
- `permissions`: bounded WebExtension permission names
- `approval.mode`: `read_only` or `per_action_human` for mutating capabilities

Unknown fields, remote entrypoints, path traversal, wildcard origins, unknown capabilities and privileged browser permissions are rejected.

## Capability policy

| Capability | Default policy |
|---|---|
| `browser.inspect` | read-only |
| `browser.capture` | local evidence only |
| `browser.navigate` | exact-origin grant + host policy |
| `browser.wait` | bounded wait |
| `browser.click` | per-action human approval |
| `browser.fill` | per-action human approval; sensitive fields remain blocked |
| `browser.download` | per-action human approval and destination policy |

No plugin may receive cookies, saved passwords, OTP/MFA, authorization headers, session tokens, browser profile databases, arbitrary native APIs, unrestricted network interception or unrestricted filesystem access.

## Grant model

A host-created grant is scoped to:

- plugin ID;
- owner ID;
- exact HTTPS origin;
- subset of manifest-declared capabilities;
- issue time and expiry (maximum 120 seconds);
- approval mode.

The pure contract creates an in-memory grant shape only. The trusted runtime must bind it to a verified package digest, consume it once per action, re-check tab/origin immediately before execution, and revoke on disable/uninstall/owner change. Never persist a grant as a reusable bearer token.

## Lifecycle

`installed → enabled → disabled → enabled`; any non-revoked installed state may transition to `revoked`. Revoked plugins cannot be re-enabled; reinstallation requires a fresh package verification and approval.

## Explicit non-claims

This P3 change does not yet execute third-party plugin code, provide a JavaScript sandbox, verify publisher signatures, install browser-store extensions, pair desktop extensions to Android, or persist grants. Those require the next native runtime and integration milestones. A JavaScript iframe alone is not a security sandbox.
