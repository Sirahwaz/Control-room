# MIDAD — Long-Term Architecture & Operating Context

**Record type:** Durable architecture and governance context  
**Last updated:** 2026-11-08  
**Status:** VERIFIED for the local repository evidence stated below; external repository contents are explicitly not re-verified by the local workflow.

## 1. Mission and execution discipline

MIDAD transforms intelligence into practical delivery and legitimate outcomes:

`INTELLIGENCE → OPPORTUNITY → ACTION → DELIVERY → PAYMENT → LEARNING`

Engineering lifecycle:

`AUDIT → VERIFY → PRESERVE → REPAIR → INTEGRATE → UPGRADE → TEST → VERIFY → LEARN`

Prefer real evidence and completed outcomes over activity counts, proposals, dashboards, or assumptions. Preserve functioning components; do not rebuild or remove working assets without evidence and rollback planning.

## 2. Source-of-truth boundaries

- **GitHub** is the source of truth for repository code, architecture manifests, workflows, pull requests, tests, release provenance and CI outcomes.
- **Supabase** is the source of truth for deployed database/runtime objects and live operational state. A GitHub source change does not prove a Supabase deployment.
- **Notion** holds operating rules, durable decisions, short-term continuation records, links and evidence references. It is not a substitute for live runtime state.
- Never copy secrets into continuity pages, source files, logs or reports.

## 3. Repository boundaries

The architecture registry currently catalogs seven repositories:

| Repository | Recorded role | Verification boundary |
|---|---|---|
| `Sirahwaz/Control-room` | Canonical MIDAD engineering/control-room repository | Local source tree is checked by its own CI |
| `Sirahwaz/midad-intelligence` | Separate opportunity discovery and Vespa-related work | External; not fetched by Control-room CI |
| `Sirahwaz/midad-genesis0` | Experimental language/runtime and documented optional bridge | External; bridge is not assumed live/production-connected |
| `Sirahwaz/midad-community` | Synthetic-data community demo | External; Apache-2.0 was recorded in prior repo review |
| `Sirahwaz/Sirahwaz` | Profile repository | External; license/source review remains separate |
| `Sirahwaz/GitHub-Clone` | Unrelated educational demo | External; MIT was recorded in prior repo review |
| `Sirahwaz/Maleh` | Empty/unclassified repository at last source review | Do not infer a product role |

The local manifest records 41 modules and 15 evidence-backed dependency edges. Its current health snapshot is 34 local modules `VERIFIED` and 7 external modules `NOT_CHECKED_EXTERNAL`. “Not checked” is not a failure and is not proof of current source health.

## 4. Governance invariants

1. Every tracked module has a declared owner and safe repository-relative paths.
2. Dependency edges require evidence. Documented or optional links must not be presented as live runtime connections.
3. Change-impact analysis maps changed paths to owners and reverse-traverses registered dependencies.
4. The pre-merge architecture gate fails on changed paths with no registered owner.
5. Provenance records allowlisted commit/workflow metadata and manifest digest; secret values are never serialized.
6. Workspace audits report potential secret files, content findings, unowned paths, generated files and duplicate content without silently mutating the workspace.
7. External repositories remain `NOT_CHECKED_EXTERNAL` until a separate authorized fetch and verification is performed.

## 5. Security and secret-scanning boundary

The built-in content scanner identifies known high-confidence provider-token/private-key formats and high-entropy environment-style credential assignments. It scans eligible text files up to 1 MiB and returns only the rule, file path and line number. It does not emit matched values.

This is a heuristic detector, not a guarantee that no credential exists in the repository, binary assets, files over the size ceiling, external repositories, Git history or connected services. A clean scan is scoped evidence, not a security certification. Any confirmed exposed credential requires an independently authorized rotation/remediation process; do not paste the value into chat or reports.

## 6. Duplicate asset policy

Duplicate SHA-256 groups are review signals, not deletion instructions. Internal reference scans can identify filename references in the local repository; a lack of internal references is reported as `NO_INTERNAL_REFERENCE_FOUND_EXTERNAL_UNVERIFIED`, not as “unused”.

Before retiring a duplicate, inspect at minimum:
- HTML/JS/CSS routes and imports;
- PWA manifests and Service Worker precache/runtime caches;
- Android packaging and build/copy workflows;
- Telegram Mini App links and deployed clients;
- external bookmarks, consumers and integrations.

The current audit explicitly returns `deletionAllowed: false` for duplicate groups. No automatic deletion or rename is permitted.

## 7. Licensing policy

The local audit checks supported root `LICENSE`/`COPYING` files against registry declarations. Missing or unrecognized licenses require an owner decision. Never assign a license based only on assumptions, repository visibility, a README claim, or another repository's license. External repositories are not license-verified by this local-only CI job.

## 8. Canonical implementation references

- [Control-room repository](https://github.com/Sirahwaz/Control-room)
- [Architecture Governance PR #200](https://github.com/Sirahwaz/Control-room/pull/200)
- [Security/dependency/license governance PR #201](https://github.com/Sirahwaz/Control-room/pull/201)
- `architecture/governance/manifest.json`
- `tools/architecture-governance/validator.mjs`
- `tools/architecture-governance/cli.mjs`
- `tests/architecture-governance.test.mjs`
- `docs/architecture/ARCHITECTURE_GOVERNANCE.md`
- `docs/architecture/DEPENDENCY_MAP.md`
- [Continuity register index](./README.md)

## 9. Approval boundaries

Read-only inspection, documentation, tests and safe code changes may proceed under the existing engineering authorization. Human approval remains required for destructive/irreversible operations, external spending, production-sensitive changes, wallet signing, financial transfers, live trades, claims/submissions requiring personal eligibility, and license choice/assignment.


## 10. Mandatory continuity and no-repeat gate

**Effective date:** 2026-11-09  
**Status:** Accepted operating rule; documentation-only change. It does not claim an application-enforced runtime lock.

Before any MIDAD work, the operator/agent must:

1. Retrieve the canonical Notion boot record: [MIDAD Global Continuity — Always Load Commands, Rules & Memory](https://app.notion.com/p/3fab132b437d81649bcfe9a5647ebc33), then retrieve only the newest checkpoint for the exact active workstream.
2. Read this long-term context and the relevant short-term record. Do not load every project history or restart a completed audit.
3. Establish a compact resume tuple before action: `GOAL`, `LAST VERIFIED STATE`, `EVIDENCE/REFS`, `COMPLETED`, `CURRENT BLOCKER`, `APPROVED NEXT ACTION`, and `PROHIBITED ACTIONS`.
4. Preserve the user's agreed architecture, current task, providers, resource/cost boundaries and authorization limits. Do not silently change architecture, replace a selected runtime, move a task to VPS-centric execution, or switch workstreams.
5. Search for and reuse existing branches, PRs, files, credentials *by reference only*, integrations, pages, schedules and deployed components before creating equivalents.
6. Repeat a completed check only when new evidence could materially change the decision, the previous evidence is stale for that decision, or the user explicitly requests it. State what changed.
7. Before any write, inspect the exact target, current state, callers/dependencies, minimal diff, impact and rollback path. Read-only is the default.
8. After each material action, verify the result at its actual source of truth (GitHub for source/CI, Supabase for deployed state, Notion for decisions/checkpoints). Do not equate CI success, PR merge, deployment metadata, HTTP 200 or a saved note with end-to-end readiness.
9. Update the existing workstream checkpoint and mirror its evidence/refs in this register when a material verified state or blocker changes. Do not create duplicate parallel records.

**Hard stop:** If the canonical record or relevant checkpoint cannot be retrieved, sources conflict, target identity is uncertain, or a required approval/rollback condition is missing, do not mutate. Perform only bounded read-only recovery and report `BLOCKED` with the exact missing evidence. Never guess, invent continuity, or ask the user to re-enter information already stored.

A request to continue means **resume from the last verified checkpoint**. It does not authorize a broad re-audit, architecture redesign, duplicate implementation, or task substitution.
