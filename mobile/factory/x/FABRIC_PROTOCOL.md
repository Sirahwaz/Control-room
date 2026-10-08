# MIDAD Mobile Factory X — Agent Execution Fabric

## Protocol

Every Agent execution becomes a dispatch envelope:

`TASK → AGENT → ACTION → CAPABILITY → PROVIDER → ADAPTER → SAFETY → RESULT`

The Fabric is provider-agnostic. A provider is selected only after capability fit and evidence checks.

## Adapter lanes

- **local**: deterministic factory work in the worker.
- **host_dispatch**: connected/native platform tools such as GitHub, Supabase, Figma, Firecrawl, Context7, Hive, Linear, Notion, OpenArt, HeyGen, Speedbot, TinyFish and Remote Desktop.
- **serverless**: server-side functions and internal APIs.
- **external_api**: third-party HTTP providers using server-side secrets only.
- **workflow_dispatch**: CI/build execution.
- **managed_browser**: browser automation behind profiles/vaults when authorized.
- **approval_queue**: irreversible or sensitive actions.
- **blocked**: no execution.

## Speed model

Independent tasks are grouped into waves up to the configured concurrency ceiling. Factory cache and incremental artifacts are reused before dispatching work.

The Fabric does not automatically request credentials. Missing credentials create a provider gap or human-gate task.

## Provider gap

When no suitable binding exists:

`DISCOVER → EVALUATE → REGISTER → SELECT PRIMARY/FALLBACK → VERIFY → DISPATCH`

## Non-negotiable safety

No privileged client secrets, passwords, OTPs, private keys, or credential recovery material are placed in product bundles. External publication and irreversible financial/external actions remain human-gated.
