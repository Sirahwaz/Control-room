# MIDAD Architecture Governance Layer

**Status:** CI-backed, read-only architecture control plane  
**Manifest:** `architecture/governance/manifest.json`  
**Schema:** `architecture/governance/manifest.schema.json`  
**Runtime:** Node.js 24, standard library only

## Purpose

The governance layer makes repository ownership, module paths, explicit dependencies, change impact, workspace hygiene and run provenance inspectable and testable. It is a source-control governance tool; it does not deploy services or mutate production systems.

## Components

| Component | Location | Responsibility |
|---|---|---|
| Repository registry | `architecture/governance/manifest.json` | Seven-repository inventory, boundaries, modules, dependencies and audit policies |
| Manifest schema | `architecture/governance/manifest.schema.json` | Editor/integration contract for the governance manifest |
| Validator | `tools/architecture-governance/validator.mjs` | Validates identifiers, ownership, module paths, dependency endpoints and evidence |
| CLI | `tools/architecture-governance/cli.mjs` | Runs validation, workspace hygiene, impact analysis and provenance generation |
| Unit tests | `tests/architecture-governance.test.mjs` | Registry, path safety, impact, drift and provenance regression tests |
| CI workflow | `.github/workflows/architecture-governance.yml` | Runs the checks with read-only GitHub permissions and uploads JSON evidence |

## Repository boundaries

The registry contains all seven repositories observed under the Sirahwaz account at the audit baseline:
- Control-room — canonical MIDAD application/control-room repository.
- midad-intelligence — private, read-only opportunity intelligence and Vespa configuration.
- midad-genesis0 — private experimental runtime with an optional, bounded adapter.
- midad-community — public synthetic-data demo with Apache-2.0 licensing.
- Sirahwaz — profile repository.
- GitHub-Clone — independent educational demo.
- Maleh — unclassified private repository; no inferred MIDAD relationship.

A repository being public, private, active or present in this registry does not by itself prove production deployment. Live services must be verified from their own runtime sources.

## Module ownership

Each module has:
- a stable `id`;
- a repository owner;
- a domain and module kind;
- one or more relative path scopes;
- a lifecycle status and human-readable purpose.

Local Control-room module paths are checked against the checked-out workspace. External repository module paths are not fetched by this local CI job and are reported as `NOT_CHECKED_EXTERNAL`, never as `VERIFIED`; their evidence remains an audited inventory statement until the external repository is checked separately.

Managed roots include `.agents/`, `.codex/`, `.github/workflows/`, `assets/`, `automation-backup/`, `compute/`, `docs/`, `lab/`, `mobile/`, the standalone service packages, `research/`, `revenue/`, `supabase/`, `tests/` and `tools/`.

A new file inside a managed root must be owned by a registered module. This catches unclassified additions before they become architectural drift.

## Dependency evidence and impact analysis

A dependency edge is written as:

`from` depends on `to`.

Every edge includes a relationship type and one or more evidence records containing a repository, path and explanation. Evidence paths inside Control-room are checked for existence. Cross-repository evidence is recorded but is not fetched by this local CI job.

For a changed module, impact analysis traverses the reverse dependency graph: if module A depends on module B, a change to B impacts A and its downstream dependents. Edges can opt out with `impactPropagation: false` where the relation is documentation-only.

Unknown changed paths are reported rather than silently assigned to a guessed module.

## Health and drift rules

| Finding | Severity | Behavior |
|---|---|---|
| Missing local module path | Error | Fails governance checks |
| Unknown repository/module reference | Error | Fails governance checks |
| Missing local dependency evidence | Error | Fails governance checks |
| Unsafe absolute/traversal path | Error | Fails governance checks |
| Secret-like filename (`.env`, private key/certificate names) | Error | Fails governance checks |
| High-confidence secret content (provider tokens, private-key headers, credential assignments) | Error | Reports path/line/rule only; never stores or prints matched values |
| File over the 1 MiB content-scan ceiling | Warning | Explicitly reports that the file was not content-scanned |
| Unowned file in a managed root | Error | Fails governance checks |
| Unowned root-level app asset | Warning | Report for classification |
| Generated/cache path | Warning | Report only; never deletes it |
| Identical file contents | Warning | Report-only; never removes either copy |
| Undocumented external evidence | Warning | Requires human review |

The scanner deliberately excludes `.env.example` and `.env.template` from secret-like filename findings and ignores placeholder credential values. Content scanning covers text files up to 1 MiB and detects high-confidence token/private-key patterns plus high-entropy environment-style credential assignments (while excluding interpolation expressions, URLs, and hexadecimal token/contract addresses). Findings contain only rule ID, path and line number; matched values are never emitted. This is a pragmatic built-in detector, not a guarantee of zero leaked credentials or a replacement for a dedicated enterprise secret scanner. Files over the size ceiling are reported as not scanned.

Duplicate-content findings are not deletion instructions. The audit now records in-repository references to each duplicate path and labels files with no internal references as `NO_INTERNAL_REFERENCE_FOUND_EXTERNAL_UNVERIFIED`; external bookmarks, Telegram Mini Apps, caches and clients remain outside repository visibility. No files are deleted or renamed.

The license audit checks the current repository root for `LICENSE`/`COPYING` and, when present, classifies a supported SPDX identifier against the registry declaration. Other repositories remain `NOT_CHECKED_EXTERNAL` during this local CI job. A missing root license is a warning for an owner decision, not an automatically assigned license.

## Change Impact

The CLI accepts newline-delimited paths (as generated from a Git diff) and produces:
- directly changed modules;
- transitive impacted dependents;
- dependency chains;
- paths that have no registered owner.

Example:

```bash
git diff --name-only origin/main...HEAD > /tmp/changed-paths.txt
node tools/architecture-governance/cli.mjs \
  --impact-file /tmp/changed-paths.txt
```

## Module health and workspace audit

Run locally from the repository root:

```bash
node --test tests/architecture-governance.test.mjs
node tools/architecture-governance/cli.mjs
```

The CLI returns:
- `VERIFIED`: manifest valid and no findings.
- `NOT_CHECKED_EXTERNAL`: a module record points to another repository whose paths are not fetched by this workspace check. This is an explicit limitation, not a pass.
- `REVIEW`: only warnings (for example identical files or generated artifacts).
- `FAILED`: one or more blocking validation or hygiene errors.

## Release and provenance

On each governance workflow run, the CLI creates:
- `architecture-health.json` — validation results, module health, workspace findings and dependency counts;
- `change-impact.json` — direct and transitive change impact;
- `release-provenance.json` — repository, commit SHA, ref, workflow, run ID/attempt, event, actor, timestamp and manifest SHA-256.

Artifacts are uploaded by GitHub Actions and retained for 30 days. Provenance includes no environment variables other than the explicitly allowlisted GitHub run metadata; secret values are never serialized. A successful provenance record proves which source revision and governance manifest produced the report; it does not prove a live deployment or external service health.

## Operating boundaries

- No repository creation, deletion, visibility change, or bulk file move is performed by this layer.
- No Supabase table, function, secret, wallet, account, or production endpoint is changed.
- No automatic deduplication or generated-file deletion.
- No external repository network calls inside the validator.
- Keep dependency edges evidence-backed; use `documented` or `optional` relationships for unimplemented integration plans.
- Treat any new finding as evidence to review, not automatic authorization for destructive cleanup.
