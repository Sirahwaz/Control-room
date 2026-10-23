# BountyBook API verification — 2026-10-23

## Decision

**The live jobs API schema and job JSON payload remain unverified.** Do not treat candidate JSON field names in mapper tests as an observed BountyBook contract. Keep fee, per-agent reward split, escrow funding, eligibility, and settlement gates fail-closed until an official job JSON response or first-party schema can be retrieved and recorded.

## Official read-only GET evidence

### Successful request

- URL: https://api.bountybook.ai/stats
- Method: GET
- Accessed: 2026-10-23
- Result: JSON response successfully retrieved through the web retrieval path.
- Observed response:

```json
{
  "total": 206,
  "totalBudget": 947.146667,
  "totalPaidOut": 174.71,
  "completed": 54,
  "activeAgents": 20,
  "avgPerHour": 7.62,
  "openCount": 126,
  "highestOpen": 25,
  "totalAvailable": 638.01,
  "workingAgents": 3,
  "queuedAgents": 5
}
```

This confirms that the official stats endpoint was reachable and returned JSON at the time of inspection. It does **not** establish the jobs endpoint contract, per-job fields, fee components, escrow state, payout splits, or whether any specific job is eligible or payable. These are provider-reported aggregate statistics, not independent on-chain proof.

### Requests that did not yield the required schema/payload

The following official URLs were attempted with GET/read-only retrieval:

- https://www.bountybook.ai/llms.txt — retrieved, but it contained crawler directives and a sitemap reference only, not an API schema.
- https://www.bountybook.ai/llms-full.txt — unavailable through the retrieval path.
- https://api.bountybook.ai/jobs
- https://api.bountybook.ai/jobs?status=open&limit=1
- https://api.bountybook.ai/jobs/a55bd7d2-b6a0-4bfc-80b5-f788d0ff312d
- https://api.bountybook.ai/.well-known/ai-plugin.json
- https://api.bountybook.ai/.well-known/x402
- https://api.bountybook.ai/openapi.json

The retrieval tool declined the jobs/schema URLs, while shell GET attempts in the execution environment failed at DNS resolution. Therefore no job payload or official OpenAPI contract was captured. An inaccessible endpoint is not evidence that the endpoint is invalid or that any hypothesized field names are correct.

## How this maps to fixtures and tests

- `provider_adapter_fixtures.ts`: `bountyBookFixture` is deliberately a **public-page observation**, not an API response. It records only displayed facts (job ID/title, displayed reward, Base chain ID 8453, the escrow label, and free claim/submission wording).
- `provider_adapter_integration_test.ts`: verifies that the public-page fixture is not misrepresented as an API payload, and that budget-only evidence cannot prove provider fee/net, escrow funding or payout settlement. Other synthetic records are adversarial/candidate-shape tests of fail-closed behavior; they are **not evidence** that BountyBook emits those exact JSON field names.
- `revenue_adapter_qualification.ts`: published 4% platform-fee policy is kept separate from claim/submission fees. The mapped fee schedule is not verified unless gross reward, explicit provider fee, and explicit provider net are all present and internally consistent. Candidate aliases such as `budget_usdc`, `platform_fee_usdc`, and `agent_receives_usdc` must not be described as confirmed schema fields until a successful official GET captures them.

## Official first-party page-level policy reference

Example public job page: https://www.bountybook.ai/job/a55bd7d2-b6a0-4bfc-80b5-f788d0ff312d

The public page was used only for displayed task facts and first-party policy wording (4% platform fee; claiming/submitting are free; Base / chain ID 8453; page-level escrow label). A page-level label is not proof of independently verified escrow funding or a successful payout transaction.

## Required closure criterion

Re-open API mapping verification only after either:
1. an official, free GET returns an actual `GET /jobs` or `GET /jobs/{id}` JSON payload that can be safely recorded with its observed field names; or
2. a first-party, retrievable machine-readable schema/API reference specifies those fields.

Then revise fixtures from the *observed* contract, add regression tests for the actual payload, and rerun the existing branch CI. Until then: qualification stays blocked on unknowns; no claims, submissions, signatures, wallet actions, payment requests, or financial transactions are permitted by this audit.
