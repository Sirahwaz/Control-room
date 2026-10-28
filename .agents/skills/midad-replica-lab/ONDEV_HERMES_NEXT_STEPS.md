# OnDev Hermes connection checklist

1. In OnDev Hermes, inspect its Project/Git/Skills/Connections settings. Confirm whether it supports linking a GitHub repository, local workspace skills, MCP, HTTP API or webhook.
2. Prefer a read-only repository connection or a dedicated branch first. Do not grant repository admin access if read/write branch access is sufficient.
3. Never paste access tokens, passwords, refresh tokens, Supabase service-role keys or model keys into a task prompt or APK.
4. Test one read-only operation first: read branch name and a safe README or issue. Verify actor, repository and permissions before enabling task creation or code writes.
5. Enable a dedicated branch and PR workflow after read-only success. Do not auto-merge.
6. Do not configure a direct endpoint until the exact URL, authentication mode, supported protocol, TLS behavior and access scopes are confirmed by the app's own settings/docs.
7. The present status is UNVERIFIED until the installed client completes the read-only test. This checklist itself does not establish a connection.
