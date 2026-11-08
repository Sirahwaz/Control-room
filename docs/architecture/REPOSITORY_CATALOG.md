# MIDAD GitHub Repository Catalog

**Audit date:** 2026-11-08  
**Scope:** Repositories visible to the authenticated GitHub account under `Sirahwaz`. This is a source-control inventory, not proof that every repository is deployed or active in production.

## Canonical project topology

| Repository | Visibility | Responsibility | Relationship | Audit status |
|---|---|---|---|---|
| [`Control-room`](https://github.com/Sirahwaz/Control-room) | Public | Main MIDAD application/control-room monorepo: UI, workflows, Supabase source assets, mobile, tools, revenue, Forge/compute and research modules | Canonical MIDAD application source | **Primary** |
| [`midad-intelligence`](https://github.com/Sirahwaz/midad-intelligence) | Private | Read-only opportunity scanners, tests, event examples and Vespa package/configuration | Intelligence acquisition subsystem; separate from control plane | **Specialized** — path normalization and validator proposed in [PR #12](https://github.com/Sirahwaz/midad-intelligence/pull/12) |
| [`midad-genesis0`](https://github.com/Sirahwaz/midad-genesis0) | Private | Experimental GENESIS-0 DSL/interpreter/runtime, tests, security model and optional MIDAD adapter | Independent research/runtime project; integration is explicit and bounded | **Well-bounded research project** |
| [`midad-community`](https://github.com/Sirahwaz/midad-community) | Public | Static community demonstration and documentation using synthetic data | Public educational surface only; no production connectivity | **Separated** — exact Apache-2.0 text correction proposed in [PR #1](https://github.com/Sirahwaz/midad-community/pull/1) |
| [`Sirahwaz`](https://github.com/Sirahwaz/Sirahwaz) | Public | GitHub profile repository (profile README and profile assets) | Personal/profile presentation, not application source | **Separate** |
| [`GitHub-Clone`](https://github.com/Sirahwaz/GitHub-Clone) | Public | Standalone HTML/CSS/JS GitHub-style tutorial/demo; README references an external tutorial/source project | Not a MIDAD subsystem | **Separate / preserve as-is** |
| `Maleh` | Private | Not established by the available source inventory | Unknown; do not attach it to MIDAD until its purpose is identified | **PENDING classification** (repository metadata reports size 0; source tree was not available in this audit) |

## Dependency and ownership boundaries

### 1. Control-room is the application monorepo

Use it for changes that belong to the actual MIDAD user interface, control surfaces, existing Supabase function source/migrations, Telegram/Mini App interfaces, mobile packages, revenue UI, test suites, Forge worker, and developer tools.

Its presence in GitHub does not automatically prove that a corresponding Supabase function or external service is currently deployed. Verify live state separately before describing a source file as production-active.

### 2. MIDAD Intelligence is a read-only discovery subsystem

Keep public-source collectors, evidence filters, non-sending message drafts, scanner tests, de-duplication state, and Vespa package validation here. Do not place wallet-signing, payment execution, trading execution, customer records, or production secrets in this repository.

The Vespa package is configuration plus validation; its presence does not prove a live Vespa deployment.

### 3. GENESIS-0 is an independent research runtime

Keep the DSL specification, parser/evaluator, execution receipts, audit-chain implementation, its tests and threat model inside `midad-genesis0`. MIDAD integration belongs only in the explicit adapter/contract and must stay least-privilege. Do not copy Control Room, operational data, credentials or production workflows into this project.

### 4. Community is deliberately non-production

Keep the public demo static, with synthetic data, architecture/hosting documentation, contributor guidance and an accurately scoped license. No commercial code, Supabase endpoints, customer records, checkout, wallets, trading, mining accounts, API credentials or internal automation endpoints belong here.

### 5. Non-MIDAD repositories stay independent

Do not merge the GitHub tutorial/demo or profile assets into MIDAD application source. Keep `Maleh` unclassified until its purpose and contents can be inspected.

## Repository governance rules

1. **One canonical owner per domain.** A module has one home; other repositories link to it or consume a published interface rather than copying it.
2. **Preserve before moving.** Audit imports, URLs, workflows, Pages routes, package scripts and deployment references before path changes.
3. **Separate source from generated output.** CI artifacts, scan reports, build outputs, caches and temporary state should not be committed unless a small, intentional fixture is required.
4. **No secrets in Git.** Use GitHub Secrets or approved secret stores; never copy secret values into docs, examples or public repos.
5. **Make integration explicit.** Each cross-repository integration should identify its owner, contract, authentication boundary, data classification, failure behavior and test.
6. **Review licensing before exposure.** Public visibility is not an open-source license. Include the intended license only where the owner has the rights to license the included code and assets.
7. **Avoid broad file moves in Control-room.** Root-level HTML/CSS/JS files may be referenced by GitHub Pages, Telegram Mini Apps, workflows, or external links; retain paths until references and routes are proven safe to change.
8. **Keep historical snapshots identifiable.** Dated inventories such as `MIDAD_FABRIC_REGISTRY.md` must carry an as-of date and be distinguished from live truth until regenerated from verified current sources.

## Current safe next steps

- Complete and review the open structural PR in `midad-intelligence`.
- Correct and review the community license PR before representing the license as settled.
- Keep `midad-genesis0` independent; no move is currently justified.
- Keep the profile and GitHub tutorial repositories untouched.
- Inspect the private `Maleh` repository separately before classifying it.
- Only then consider targeted Control-room module moves, each with link/route and workflow regression checks.
