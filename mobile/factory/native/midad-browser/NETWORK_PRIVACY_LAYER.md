# MIDAD Network Privacy Layer

## Current state: policy contract only — NOT a working VPN

The browser currently has no native tunnel service, proxy transport, packet forwarding, or enforced network kill switch. Do not present the UI/policy state as VPN protection.

## Security contract
- Proxy profile abstraction accepts HTTP, HTTPS, and SOCKS5 endpoint metadata; a proxy is not a VPN.
- Direct traffic is blocked by policy while kill switch is enabled and no native tunnel session is attested.
- A plain JavaScript source label is not trusted. The policy requires an opaque object-capability retained privately by the native integration; it must never be exposed to WebView content or page JavaScript.
- A connected attestation must include a session ID, a strict `tun` interface name, installed routes, and configured DNS. Disconnect/failure events must match the active session.
- Proxy credentials are not returned in UI configuration results or status snapshots.
- Private browser content is classified local and must not be forwarded to a remote proxy.
- Unsafe URL schemes and malformed endpoint profiles are rejected.

## Required implementation before VPN claims
1. Android `VpnService` with explicit Android user consent and lifecycle handling.
2. Real packet forwarding or a documented supported tunnel protocol and authenticated endpoint.
3. DNS and IPv6 routing/leak tests, reconnect and process-death tests.
4. Enforced fail-closed behavior at the network layer (not just this JavaScript decision function).
5. Android UI for setup/status and a signed APK plus emulator/device acceptance evidence.

No endpoint is fabricated or bundled. An actual endpoint/provider is required; costs and data handling must be disclosed before use.
