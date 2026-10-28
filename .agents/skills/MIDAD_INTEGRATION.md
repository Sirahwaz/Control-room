# MIDAD Intelligence Force Super + Replica Skill Pack

This skill set is coordinated by MIDAD Intelligence Force Super. It routes binary and package internals to LeanREA, product behavior to Replica, scoped security analysis to the authorized analysis workflow, and Android builds to the existing Mobile Factory.

LeanREA source: https://github.com/aicodeking/leanrea (MIT). Its benchmark is upstream evidence only and has not been reproduced on MIDAD.

This folder imports the MIT-licensed Replica skill pack from https://github.com/Jakeschincariol/replica-skill and adds MIDAD routing and authorized-analysis skills.

## Included upstream workflows

- midad-intelligence-force-super: top-level evidence-first router across LeanREA, Replica, isolated analysis and Factory handoff
- leanrea: fast CLI routing for authorized binary, package, bundle, APK and native artifact analysis
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

## MIDAD guardrails

1. Analyze only public material or assets/accounts the operator owns or is expressly authorized to assess.
2. Rebuild behavior, not proprietary code, private content, credentials, branding or private endpoints.
3. APK analysis stays in a separate isolated workflow. JADX, Apktool, Frida and emulator readiness must be demonstrated by a harmless test.
4. No secrets in client apps or chat. No wallet signing, live payments, transfers, withdrawals or real purchases/refunds.
5. No production deployment or external publication without its own verified release gate.
6. Stop after three attempts for one incident and switch path or report a blocker.
7. Importing skills does not prove that any external tool, APK analyzer, device or remote bridge is connected.

## Intelligence routing and evidence

Use LeanREA for technical internals only after target authorization and tool preflight. Use Replica for clean-room UX/feature mapping and independent rebuild. These are complementary routes, not interchangeable: the Replica recon workflow explicitly excludes decompiling binaries to copy private implementation; the authorized analysis workflow has separate scope gates. Label claims seen/inferred/unknown and do not claim runtime behavior from static inspection.

## Handoff

See mobile/factory/REPLICA_SKILL_INTEGRATION.md. The lab and Mobile Factory remain separate execution tracks. The contract is documented, but automatic dispatch is not claimed until a real adapter is tested.

## Validation

Run: python3 -m unittest discover -s .agents/skills/tests -v

Provenance: upstream https://github.com/Jakeschincariol/replica-skill, MIT License. Upstream skills and helper tools are retained, with a MIDAD safety override in replica-deploy/SKILL.md.
