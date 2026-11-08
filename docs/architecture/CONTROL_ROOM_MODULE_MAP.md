# Control-room Module Map

**Repository:** `Sirahwaz/Control-room`  
**Branch baseline audited:** `main`  
**Inventory size:** 587 Git tree entries at audit time.

Control-room is a deliberately integrated monorepo. It currently has many active domains; the purpose of this map is to establish ownership and navigation without breaking stable routes.

## Top-level boundaries

| Path | Domain | Keep here |
|---|---|---|
| `.github/workflows/` | CI, validation, controlled automation | Workflows and path-scoped checks; keep permissions least-privilege |
| `.agents/` | Agent skills and reusable agent guidance | Skill definitions, references, agent tests |
| `.codex/` | Local Codex configuration | Non-secret project/tool configuration |
| `supabase/functions/` | Supabase Edge Function source | Function handlers and their local modules |
| `supabase/migrations/` | Database migrations | Ordered schema migrations; review before applying remotely |
| `supabase/tests/` | Database/function contract tests | Non-production test fixtures and validation |
| `mobile/` | Mobile app and factory | Mobile-specific web assets, Capacitor config, build/factory code |
| `tools/` | Developer and agent tooling | Browser agent/runtime, miner sensor and reverse-engineering lab tools |
| `tests/` | Cross-module regression and contract tests | Repo-level Node/CJS tests for UI, workflows, runtime and integrations |
| `compute/mncf/` | Neural Compute Fabric | Manifest, bounded Linux worker runtime and compute patches |
| `midad_viabtc_monitor/` | ViaBTC monitoring service | Standalone adapter/server package and its own container files |
| `midad_static_egress_gateway/` | Static egress gateway | Standalone gateway service with Dockerfile and environment example |
| `revenue/` | Public revenue/checkout surface | Checkout UI, attribution/key logic, distribution mesh documentation |
| `automation-backup/` | Exported automation snapshots | Versioned JSON backup exports; not the runtime source of truth |
| `lab/stageshow/` | Isolated StageShow lab package | Package source, build configuration and smoke tests |
| `research/` | Research artifacts | Dated research, publication drafts/status and research scripts |
| `docs/` | Project documentation | Architecture, operating guides, release gates and audit evidence |
| `assets/` | Shared static assets | Explicitly referenced shared images/SVGs |

## Root-level application entry points

The following root files are currently part of the web/mini-app surface or stable page bundles:

- `index.html` — primary static entry page.
- `ai-room.html` — AI Room surface.
- `iaitrader.html`, `iaitrader.js`, `iaitrader.css` — iAiTrader interface bundle.
- `midad-browser.html`, `midad-browser.js`, `midad-browser.css`, `midad-browser-bridge.js` — browser interface/bridge.
- `midad-mobile-control.html` — mobile control surface.
- `midad-cockpit.js`, `midad-cockpit.css`, `midad-control-v2.js`, `midad-control-v2.css` — control-room UI bundles.
- `services.html`, `services.catalog.mjs` — service catalogue surface.
- `revenue-forge.html` — revenue/checkout-related UI surface.
- `viabtc.html`, `viabtc-monitor.js`, `viabtc-monitor.css`, `viabtc-neuralpp-v1.js`, `viabtc-neuralpp-v1.css` — ViaBTC monitoring UI assets.
- `trust-wallet-link.html`, `reown-wallet-connect.html` — wallet connection surfaces; treat as security-sensitive and do not relocate without route/contract tests.
- `manifest.webmanifest`, `service-worker.js`, `midad-pwa-icon.svg` — PWA assets.

**Why these remain at root:** GitHub Pages paths, Mini App links, service-worker scope, browser bookmarks and workflows may use the existing URLs. A directory move is a breaking change unless every consumer is discovered and updated.

## Cross-cutting contracts

- `MIDAD_FABRIC_REGISTRY.md`: dated inventory snapshot. It must be treated as historical, not a live service inventory.
- `MIDAD_PROVIDER_ADAPTER_CONTRACT.md`: financial/provider adapter boundary. It is not a compute-provider contract.
- `MIDAD_CRYPTO_ONLY_AUTONOMY_POLICY.md`: policy boundary for crypto-only automation.
- `MIDAD_TREASURY_MARKET_RULES_V2.md`: treasury/market decision rules.
- `MIDAD_HYBRID_REVENUE_SWARM.md`, `REVENUE_DELEGATION_CHARTER.md`, `REVENUE_MESH_V3_MULTI_MARKET.md`: revenue architecture and delegation documentation.

Do not move or rewrite these contracts without a references audit and owner review.

## Rules for future organization

1. New code belongs in the domain directory, not as another loosely named root file.
2. A UI route that must stay root-addressable needs an explicit compatibility route if implementation is extracted into a subdirectory.
3. Each deployable subproject should own a README, package/runtime manifest, environment example without secret values, health/verification instructions, and focused tests.
4. Keep generated files out of source control; keep only small, deterministic fixtures.
5. Avoid duplicate versioned bundles when two files are byte-identical. First identify all references, then consolidate behind compatibility paths.
6. Before any rename/move, search the repository for path references and validate:
   - GitHub Actions `paths` filters and `working-directory`
   - GitHub Pages URLs and relative asset references
   - Telegram Mini App URLs and manifests
   - service-worker scope and asset caching
   - test fixtures, shell scripts, and external consumers
7. Never delete a module solely because a newer-looking version exists. Establish canonical ownership and migration/rollback first.

## Observed cleanup candidates (not yet changed)

- The root contains multiple versioned UI bundles and some root-level domain pages. Keep them operational while a route/reference graph is built.
- `viabtc-monitor.*` and `viabtc-neuralpp-v1.*` appeared byte-identical by name/size in the file inventory; verify hashes before any deduplication.
- Several standalone Node packages have their own `package.json` and Dockerfiles; add package-specific lifecycle/readiness documentation rather than merging them into a global package.
- Automation backup exports should remain clearly distinguished from active deployed workflows.
- The fabric registry is dated and should be regenerated from verified live inventories before operational use.
