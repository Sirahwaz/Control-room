# MIDAD Network Privacy Layer

Policy contract for a future Android VpnService-backed browser network tunnel.

## Planned layers
- Proxy profile abstraction: HTTP, HTTPS, SOCKS5 (proxy support is not equivalent to a VPN tunnel).
- Android VpnService tunnel adapter: full-device/app traffic routing only after implementation and permission grant.
- Kill switch policy: block direct traffic when enabled and tunnel is not verified connected.
- Connection state machine and error reporting.
- Private-content policy: prevent forwarding browser-private classifications to remote proxy infrastructure.
- DNS/leak tests, IPv6 handling, bypass/exclusion rules, and endpoint security are required before claiming leak protection.

This module is policy-only. It does not create a VPN, proxy connection, or tunnel and is not yet integrated into Android UI. A profile requires an actual endpoint; MIDAD does not invent or provide VPN servers.
