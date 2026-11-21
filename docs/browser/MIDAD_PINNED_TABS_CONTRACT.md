# MIDAD Browser — Pinned Tabs & Quick Switching Contract

## Scope
Implement pinned tabs and an efficient tab switcher in the native Android browser while preserving WebView, the existing 8-tab cap, restore-last-closed, history/bookmarks/downloads, and current security restrictions.

## Acceptance criteria (test-first)
- Pin/unpin an existing HTTP(S) tab.
- Persist pin state and stable tab identity across app restart alongside restorable URLs.
- Pinned tabs appear before ordinary tabs in the tab picker, with title and hostname (avoid exposing full query strings).
- Pinned tabs cannot be closed until unpinned; explicit unpin/close flow is available.
- Closing an ordinary tab preserves restore-last-closed behavior; restoring a pinned tab does not accidentally restore as unpinned.
- Pin state survives tab reorder/switch, but does not exceed MAX_TABS=8.
- Invalid/non-HTTP URLs are not persisted as pinned entries.
- No sync of browser contents or credentials to cloud.
- UI stays usable on narrow Android screens and accessible labels are provided.

## Engineering sequence
1. Add red tests/contracts for persistence, close guards, ordering, limits and restoration.
2. Implement minimal local pinned-tab state storage and UI controls.
3. Run native APK build, contract/governance checks and Agentation E2E.
4. Inspect failures, repair within three attempts, and merge only with green required checks.

## Autonomy Workspace roadmap
After pinned tabs: session/profile isolation and permissioned task checkpoint foundation; then agent-controller integration and execution adapters. Never expose cookies/passwords/OTP in logs or agent context. Human approval remains required for destructive, financial, sensitive account and deployment actions.
