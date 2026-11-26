# MIDAD Publishing & Growth Engine v1

**Status:** ARCHITECTURE PROPOSAL — NOT DEPLOYED  
**Repository:** `Sirahwaz/Control-room`  
**Owner boundary:** Control Room owns orchestration and operator UX; Supabase owns durable state and queue; provider adapters own platform-specific API contracts.

## 1. Product objective

Turn MIDAD from a manual content helper into a measurable, multi-platform publishing and growth system:

`INTELLIGENCE → CONTENT → REVIEW → DISTRIBUTION → ENGAGEMENT → LEAD → CHECKOUT → VERIFIED REVENUE → LEARNING`

The system must produce business outcomes, not merely publish volume. Views, clicks, qualified leads, checkout requests, paid orders, and verified on-chain receipts are separate metrics.

## 2. Preserve and integrate existing assets

Do not rebuild these existing components:

- `revenue/index.html`: public storefront and conversion surface.
- `revenue/checkout-key.js`: checkout key behavior.
- `revenue/distribution-mesh.json`: channel policy, attribution contract and current human gates.
- `supabase/functions/midad_public_checkout`: public checkout and attribution handoff.
- `supabase/functions/generate_campaign`: authenticated campaign generation, brand-kit support, orchestration/Gemini fallback and usage accounting.
- `supabase/functions/midad_revenue_intelligence_mesh`: opportunity discovery and qualification context.
- Existing Control Room shell, authentication, Supabase client conventions, secrets and architecture governance.

Before implementation, inspect the current database migrations, campaign UI, generated content schema, and deployment workflows. Do not assume the current `campaigns` table or `generate_campaign` response is sufficient for scheduling or delivery.

## 3. Target architecture

```text
Control Room / Telegram command surface
              |
       Publishing API
              |
    Campaign Orchestrator
       /      |       \
  Discovery  Content  Policy & QA
       \      |       /
       Canonical Content Package
              |
      Platform Renderer
              |
       Approval Gate
              |
       Durable Outbox
              |
     Provider Adapter Registry
       |    |    |    |    |
       X  LinkedIn Meta YouTube Telegram
              |
      Provider Webhooks / Pollers
              |
    Analytics & Attribution Join
              |
  Lead / Checkout / Payment Evidence
              |
       Learning & Re-optimization
```

### Runtime responsibilities

- **Supabase Postgres:** canonical campaigns, content assets, platform accounts, scheduled deliveries, idempotency keys, event ledger, metrics snapshots and audit trail.
- **Supabase Edge Functions:** authenticated command/API boundaries, queue claims, callbacks and bounded provider calls.
- **Supabase Cron / queue worker:** due-job dispatch, retry scheduling, reconciliation and health checks. Do not make n8n a core dependency.
- **Control Room:** campaign studio, calendar, approvals, delivery status, analytics and operator intervention.
- **Provider adapters:** isolated platform-specific authentication, capability discovery, rendering, publish, delete/update (only if supported), status and metrics operations.
- **Object storage:** media assets, thumbnails, captions and generated derivatives; no large media blobs in Postgres rows.
- **Existing Revenue Store:** canonical conversion destination and payment verification. No parallel checkout or wallet flow.

## 4. Platform adapter strategy

Use a capability registry, not assumptions that every platform supports the same operations.

Initial adapter candidates:

| Platform | Initial capability | Important constraint |
|---|---|---|
| Telegram Channels | Text, media, scheduled dispatch via MIDAD queue | Bot must be an authorized channel admin; publishing is an external effect |
| YouTube | Video upload, title/description/tags, scheduled privacy state | OAuth scopes, quota, upload processing and channel eligibility |
| LinkedIn | Organization/member posts where granted | Product access, scopes and organization role can limit publishing |
| Facebook Pages | Page feed and supported media publishing | Page token, app review/access and media-specific API limits |
| Instagram | Professional account media publishing | Professional account linkage, publishing permissions and media requirements |
| X | Text/media posting where API access permits | API tier, quotas and media upload contract |
| TikTok | Content posting only after app capability approval | Direct-post access and audit/visibility restrictions must be verified |

Every adapter must expose a live capability state:
- `AVAILABLE`: credentials and a non-destructive capability check passed.
- `LIMITED`: connected, but some formats or actions are unavailable.
- `AUTH_REQUIRED`: user action required to connect or refresh access.
- `APP_REVIEW_REQUIRED`: platform approval is pending.
- `DISABLED`: intentionally disabled by owner/policy.
- `ERROR`: provider call failed; preserve error code and retryability.

Do not store platform passwords or browser cookies. Use OAuth access/refresh tokens in managed secrets or an encrypted token vault with least privilege, rotation and audit. Never scrape private APIs or bypass platform review, CAPTCHA, MFA, rate limits or access controls.

## 5. Canonical content package

A campaign should produce one source package and explicit platform variants, not unrelated copies.

Required fields:
- `campaign_id`, `brand_id`, `objective`, `audience_segment`, `offer_id`, `source_evidence[]`
- `content_id`, `content_type`, `language`, `locale`, `tone`, `claim_ledger[]`
- `body`, `title`, `hook`, `cta`, `hashtags[]`, `alt_text`, `captions`
- `media_assets[]` with source, rights/ownership note, MIME type, dimensions, duration and checksum
- `platform_variants[]` with rendered payload, validation result, provider and format
- `tracked_destination` with UTM/ref/lane metadata and canonical offer link
- `quality_report` with factuality, policy, duplication, readability, format and brand checks.

All factual claims must be traceable to supplied product facts or source evidence. No fabricated testimonials, customer results, awards, certifications, scarcity, revenue or guarantees. AI-generated media must be labeled where required by platform policy or law.

## 6. Publishing state machine

`DRAFT → GENERATED → QA_PASSED → APPROVAL_REQUIRED → APPROVED → SCHEDULED → QUEUED → PUBLISHING → PUBLISHED`

Terminal/exception states:
- `REJECTED`, `CANCELLED`, `FAILED_RETRYABLE`, `FAILED_FINAL`, `EXPIRED`, `PARTIAL`.

Rules:
1. A scheduled item is not a published item.
2. Only the owner can enable unattended publishing per connected account and platform.
3. Default mode is `APPROVAL_REQUIRED`; no automatic external post before the owner explicitly enables that platform.
4. Dispatch must use an idempotency key derived from content variant + platform account + scheduled occurrence.
5. Persist the provider response and external post ID before marking success.
6. Retry only transient failures with bounded exponential backoff and jitter; never blindly retry ambiguous timeouts that may have published.
7. Provide cancel/pause/kill-switch and a per-platform circuit breaker.
8. Edits after approval invalidate approval and require re-validation.
9. Bulk campaigns need per-platform previews and one approval action with clear scope.
10. Never send unsolicited direct messages, comments, follows, likes or engagement farming.

## 7. Distinctive features

### A. One-to-Many Content Compiler
Turn one verified source into a platform-native content family: technical article, short post, carousel outline, vertical-video script, Telegram summary, email/newsletter draft and localized variants. Preserve meaning and source links; do not copy-paste the same format everywhere.

### B. Evidence & Claim Ledger
Every product claim is tagged as `VERIFIED`, `USER_SUPPLIED`, `INFERRED` or `UNSUPPORTED`. Unsupported claims block publication. Keep evidence URLs and capture timestamps for later audit.

### C. Opportunity-to-Content Radar
Use the existing Revenue Intelligence Mesh to identify relevant, time-bounded topics and legitimate buyer problems. Score by audience fit, evidence quality, demand signal, offer fit, effort and expiry. Generate content only when the source and offer match.

### D. Content Graph & Anti-Repetition
Track semantic similarity, topic coverage, hooks, examples, assets and prior outcomes. Detect near-duplicate posts across channels and time windows; recommend a genuinely new angle instead of increasing volume.

### E. Adaptive Distribution
Choose platform, format, timing and CTA from observed performance, audience fit and platform capabilities. Keep a human-readable reason for every recommendation. Do not optimize solely for impressions.

### F. Conversion Attribution Loop
Join `UTM/ref/lane → landing session → lead/inquiry → checkout order → payment intent → verified receipt`. Distinguish clicks from leads, invoices from paid orders, and paid orders from fulfilled work. Use the existing checkout metadata contract.

### G. Content Decay & Refresh
Detect evergreen posts whose click/conversion rate decays; propose an evidence-backed refresh or new derivative. Preserve the original and record version lineage. Never silently edit a live post.

### H. Revenue-aware Experiment Engine
Run controlled tests for hooks, CTA, format and posting windows. Use qualified lead rate and verified revenue per reach as primary business outcomes; keep sample size and uncertainty visible. No fabricated uplift claims.

### I. Operator Autopilot
A single command can prepare a campaign, render previews, run QA, schedule approved variants, monitor failures and produce a concise evidence report. High-impact actions remain behind explicit policy gates.

## 8. Proposed logical data model

Use new, namespaced tables only after confirming there are no equivalent existing tables:

- `midad_social_accounts`: owner, provider, provider account ID, scopes, capability state, token reference, expiry.
- `midad_content_campaigns`: objective, audience, offer, source evidence, state, owner.
- `midad_content_items`: canonical content, language, source lineage, claim ledger, QA report.
- `midad_content_variants`: platform/account, rendered payload, validation, asset references.
- `midad_publish_jobs`: scheduled_at, state, idempotency key, attempt count, lease, provider post ID, error class.
- `midad_publish_events`: append-only transition and provider response ledger.
- `midad_content_metrics`: provider, metric, value, period, source and observed_at.
- `midad_content_attribution`: tracked click/session/lead/order references; minimize personal data.
- `midad_content_experiments`: hypothesis, variants, sample size, outcomes and decision.

Security:
- RLS by owner/account; service-role access only inside Edge Functions.
- No tokens in client-readable rows or logs.
- Redact provider errors and webhook payloads.
- Verify webhook signatures and replay windows.
- Unique constraints on provider account + idempotency key.
- Append-only audit events; retention limits for raw webhook data.

## 9. API contract (proposed)

All endpoints require authenticated owner context except provider webhooks.

- `POST /publishing/campaigns` — create campaign intent.
- `POST /publishing/campaigns/{id}/generate` — generate canonical content package.
- `POST /publishing/content/{id}/render` — render selected platform variants.
- `POST /publishing/content/{id}/approve` — approve exact variant hashes and target accounts.
- `POST /publishing/jobs` — schedule approved variants.
- `POST /publishing/jobs/{id}/cancel` — cancel before provider dispatch.
- `GET /publishing/calendar` — calendar and queue state.
- `GET /publishing/accounts` — account connection/capability status.
- `POST /publishing/webhooks/{provider}` — signed provider callbacks.
- `GET /publishing/analytics` — normalized metrics and attribution.

Error envelope:
`{ "error": { "code": "STABLE_CODE", "message": "Safe human-readable detail", "retryable": false, "correlation_id": "..." } }`

All write operations must be idempotent or explicitly reject duplicate requests. API responses must not expose access tokens, private user data or internal stack traces.

## 10. Automation and observability

- Queue worker claims due jobs with leases; expired leases return to retry evaluation.
- Provider-specific concurrency and rate limits.
- Dead-letter queue for final failures with operator replay controls.
- Health checks: queue lag, due-job age, provider auth expiry, publish success rate, webhook lag, analytics freshness.
- Alert only on new/escalated failures, expiring auth, queue backlog and anomalous spend/quota.
- Daily report: generated, approved, scheduled, published, failed, clicks, qualified leads, checkout requests, paid orders, verified receipts and cost per qualified lead.

## 11. Delivery plan

### Phase 0 — Audit & contracts
- Inspect current campaign UI, migrations, RLS, secrets, cron/queue conventions and tests.
- Map existing campaign generation output to canonical content package.
- Confirm platform API access and account eligibility.
- Produce schema/API contract and test plan.

### Phase 1 — Core publishing foundation
- Add schema, RLS, audit ledger and capability registry.
- Add canonical package validator, platform renderer interface, idempotent queue and preview/approval UI.
- Implement Telegram adapter first because it is the most direct controlled channel, subject to owner bot/channel permissions.
- Add dry-run mode and prove no external side effect.

### Phase 2 — First external publishing adapters
- Add YouTube and LinkedIn or X based on the user's actual API access.
- Add Meta Pages/Instagram after permission and account capability checks.
- Add provider callbacks/pollers, normalized analytics and retry reconciliation.

### Phase 3 — Growth intelligence
- Integrate Opportunity-to-Content Radar, Content Graph, decay detection and experiments.
- Join campaign attribution with existing revenue and verified payment records.
- Rank content by qualified leads and verified revenue, not vanity metrics.

### Phase 4 — Controlled autonomy
- Owner-configured auto-publish per account/platform.
- Per-platform spend/quota caps, kill switch, audit and weekly strategy review.
- Expand formats/platforms only when capability is verified.

## 12. Acceptance criteria

- One source brief produces valid, distinct previews for at least three connected platforms.
- Unsupported claims and invalid media formats are blocked before approval.
- An unapproved item cannot enter the provider dispatch path.
- A repeated queue request cannot publish duplicate posts.
- Provider timeout reconciliation does not create duplicate posts.
- Platform auth failure is visible and does not corrupt other platform jobs.
- Every post has a provider post ID or an explicit failure state.
- Analytics reports distinguish impressions, clicks, leads, checkouts, paid orders and verified receipts.
- Attribution survives from post link to the existing checkout metadata.
- No platform is labeled `AVAILABLE` without a real capability check.
- All tests pass; dry-run is verified before enabling any real account publishing.

## 13. Immediate blockers / owner inputs

The architecture can be implemented without credentials, but real multi-platform publishing requires the owner to connect each account and grant approved scopes. Do not request passwords or API keys in chat.

Before activating unattended publishing, the owner must explicitly enable it for each platform/account. Until then, generate, validate, preview and queue in approval-required mode.

**Current status:** design recorded only. No platform account was connected, no post was published, no invoice was created and no live publishing automation was enabled.
