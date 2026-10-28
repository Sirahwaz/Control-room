# MIDAD Replica Lab and Mobile Factory integration

## Decision

Keep the lab and Mobile Factory as separate execution tracks under a shared MIDAD orchestrator. The lab owns target authorization, reconnaissance, analysis, clean-room implementation and test design. Factory X owns reuse/provider planning, the product manifest, build workflow, artifact integrity and APK runtime smoke tests.

This is a shared handoff contract. It does not claim that direct dispatch from a skill into a running worker already exists. Current Factory X entry points remain mobile/factory/x/plan.mjs, execution-fabric.mjs and product-specific build workflows.

## Lifecycle

REQUESTED -> AUTHORIZATION_CHECKED -> ANALYZED -> BUILD_PLANNED -> FACTORY_PREFLIGHT -> BUILT -> TESTED -> VERIFIED

Any stage can return BLOCKED with evidence. A generated plan is not proof a worker ran. A successful compile is not proof device runtime behavior passed.

## Contract fields

- Protocol and unique job ID.
- Exact authorized target reference and asset SHA-256 when file-based.
- Authorization evidence reference, allowed scope and excluded scope.
- Request type: analyze, rebuild, test or build.
- Input/output inventory, Factory product key and desired channel (debug by default).
- Tool versions, tests run, attempt count and circuit-breaker state.
- Final status, blocker, report hashes and artifact SHA-256.

The example manifest is in .agents/skills/midad-replica-lab/assets/factory-handoff.example.json. It is a template, not a secret store or executable authorization token.

## Dispatch and verification

1. Verify authorization before analysis.
2. Verify the analyzer/build/runtime adapter before dispatch. Unknown adapters are blockers, not successful connections.
3. Run existing Factory X preflight and product quality gates; preserve working products.
4. Use at most 3 attempts per incident. After 3 failures, break the loop and try a structurally different route or stop.
5. Return APK/AAB only with artifact hash, build report, test report and the checks that actually ran. Explicitly report if physical-device or emulator runtime testing was not done.
6. A draft branch or PR is not a release.
7. No secrets in client artifacts. Live payments, wallet signing, transfers, withdrawals and real purchases/refunds remain disabled. External production publication needs its own gate.

## OnDev Hermes

The app identified as Hermes Agent Client - OnDev AI advertises projects/files, skills and task features. The GitHub repository itself cannot prove the installed client has authenticated access to this repository or a supported MIDAD bridge endpoint.

The safest initial link is a shared Git repository/branch and reviewable PR if the app exposes Git project linking; otherwise use its documented skills/workspace import. Never paste a GitHub token, Supabase service key or other secret into chat or a client-side skill.

A direct OnDev API/WebSocket/MCP connector is not enabled by this document. It requires the installed app's connection settings and a supported endpoint/authentication contract, followed by a read-only health/status check before task dispatch. Until then, use GitHub artifacts as the integration boundary.
