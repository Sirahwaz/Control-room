# MIDAD Intelligence Force Super + Nanobot + Replica Skill Pack

MIDAD Intelligence Force Super coordinates the specialized workflows. LeanREA handles authorized technical artifact internals, Replica maps public product behavior and clean-room rebuilds, the isolated-analysis skill handles approved security work, Nanobot is the proposed persistent agent runtime, and Mobile Factory owns builds and runtime smoke checks.

Upstream sources:
- LeanREA: https://github.com/aicodeking/leanrea (MIT; upstream benchmark not reproduced on MIDAD).
- Replica skill pack: https://github.com/Jakeschincariol/replica-skill (MIT).
- Nanobot: https://github.com/HKUDS/nanobot (self-hosted Python agent runtime; review its security, API and deployment guides before use).

## Included workflows

- midad-intelligence-force-super: evidence-first routing across LeanREA, Replica, isolated analysis, Nanobot runtime planning and Factory handoff
- leanrea: CLI command routing for authorized binary, package, bundle, APK and native artifact analysis
- midad-nanobot-runtime: guarded integration and runtime validation plan for Nanobot; not proof of a deployed service
- replica-recon: source inventory, screens, flows and feature matrix
- replica-architect: architecture and data/API planning
- replica-design: design tokens and components
- replica-build: clean-room implementation
- replica-backend: auth, database and official API integration
- replica-test: flow coverage, edge cases and bug reports
- replica-diff: feature and visual parity
- replica-entrepreneur: evidence-backed product research
- replica-brand: independent brand and residual-name sweep
- replica-launch: store listing and launch materials
- replica-deploy: preflight and release checklist

## Runtime decision

The OnDev Hermes checklist is retired in favor of the Nanobot integration plan in `midad-replica-lab/NANOBOT_MIDAD_INTEGRATION.md`. The earlier Hermes bridge was not verified. Nanobot is the selected replacement path for a persistent runtime, but it is not installed, deployed or connected by these docs or registry entries.

Nanobot requires Python 3.11 or newer and a configured model provider or local model server. It supplies WebUI/chat/API surfaces, not an Android-native app or a model. Any MIDAD integration must use an authenticated server-side adapter; never pass a shared Nanobot/API/model credential to a mobile client.

## MIDAD guardrails

1. Analyze only public material or assets/accounts the operator owns or is expressly authorized to assess.
2. Rebuild behavior, not proprietary code, private content, credentials, branding or private endpoints.
3. APK analysis stays in a separate isolated workflow. JADX, Apktool, Frida and emulator readiness must be demonstrated by a harmless test.
4. Keep secrets out of client apps, chat, source control, APKs and logs. No wallet signing, live payments, transfers, withdrawals or real purchases/refunds.
5. No production deployment or external publication without its own verified release gate.
6. Stop after three attempts for one incident and switch path or report a blocker.
7. Importing skills or registering capabilities does not prove that an external tool, runtime, analyzer, device or bridge is connected.
8. Nanobot must have a pinned release, private host, least-privilege workspace, verified sandbox, API authentication, explicit channel allowlists and negative authorization tests before any MIDAD connection.
9. Because Nanobot API callers share configured tools and workspace permissions, session identifiers alone are not an authorization boundary. Enforce operator identity and action allowlists in a MIDAD-owned adapter.

## Intelligence routing and evidence

Use LeanREA for technical internals only after target authorization and tool preflight. Use Replica for clean-room UX/feature mapping and independent rebuild. Use Nanobot only for the persistent runtime/UI/chat/API need, not to replace the specialized analysis skills. Keep the Lab and Mobile Factory as separate execution tracks. Label claims seen/inferred/unknown and do not claim runtime behavior from static inspection.

## Handoff

See `midad-replica-lab/NANOBOT_MIDAD_INTEGRATION.md` and `mobile/factory/REPLICA_SKILL_INTEGRATION.md`. The Lab/Factory contract is documented, but automatic dispatch is not claimed until a real adapter is tested.

## Validation

Run: `python3 -m unittest discover -s .agents/skills/tests -v`

The integration guide is a blueprint only. No Nanobot service or paid host was started by this change.
