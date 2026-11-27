# MIDAD Media Tool Fabric

This directory is reserved for the MIDAD-owned adapters and worker contracts for Voicebox and FreeVideo.

Current state: design and upstream source audit only. No worker is deployed, no media job has been executed, and no provider is marked runtime-verified.

See [MIDAD Media Tool Fabric architecture](../../docs/architecture/MIDAD_MEDIA_TOOL_FABRIC.md) for source findings, security boundaries, deployment requirements and acceptance gates.

Implementation rules:
- Preserve upstream repositories and pin exact revisions.
- Keep provider-specific details behind adapters.
- Never expose upstream worker ports publicly.
- Store secrets outside Git.
- Use allowlisted operations and workflow templates only.
- Add tests before behavior changes.
- Report SOURCE_PRESENT, TESTED_CI and RUNTIME_VERIFIED as distinct evidence states.
