# MIDAD AgentMail Integration

## Decision
- Provider: AgentMail US production API at https://api.agentmail.to
- Cost target: Free tier only; no paid upgrades or billing actions.
- Runtime: Supabase Edge Function `midad_agentmail_gateway`.
- Existing customer workflow: verified inbound messages are handed to `midad_client_gateway` as channel `agentmail`; the existing MIDAD drafting and approval policy remains authoritative.
- No cold outreach. No automatic outbound email sending is implemented in this phase.

## Required Supabase secrets
Set these through Supabase Edge Function Secrets, never GitHub or browser code:
- `AGENTMAIL_API_KEY`: AgentMail US API key.
- `AGENTMAIL_WEBHOOK_SECRET`: Svix signing secret for the registered webhook.
- `MIDAD_AGENTMAIL_ADMIN_KEY`: high-entropy key for inbox provisioning.
- Existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `MIDAD_INGEST_KEY` are used to hand verified messages to the existing MIDAD gateway.

## Endpoints
- `GET /functions/v1/midad_agentmail_gateway/health`: reports whether secrets are configured; never returns secret values.
- `POST /functions/v1/midad_agentmail_gateway/webhook`: verifies Svix signature against the exact raw request body before parsing. Eligible `message.received` events enter MIDAD. If Agent Armor is enabled in Monitor mode, `message.received` is held while its scan is pending and `message.security.completed` triggers an authenticated message fetch; only a `complete/clear` verdict is forwarded. Review and unavailable verdicts are not processed.
- `POST /functions/v1/midad_agentmail_gateway/inboxes`: admin-key protected, idempotently provisions an inbox using AgentMail `client_id`.

## Inbound controls
- Spam, blocked, unauthenticated and pending Agent Armor messages are not forwarded.
- The AgentMail event ID is the deduplication key.
- Only minimal event metadata is stored in `midad_agentmail_events`; message content remains in the existing MIDAD conversation/message workflow.
- Webhook retries receive a non-success response when MIDAD processing fails.
- Incoming content is data, not trusted instructions.
- Outbound sending is deliberately excluded until the MIDAD approval ledger has an explicit email-send approval contract.

## Deployment sequence
1. Apply `20261108070000_midad_agentmail_events.sql`.
2. Set the required Edge Function secrets.
3. Deploy `midad_agentmail_gateway` with JWT verification disabled only for the webhook endpoint; Svix verification is mandatory there, while admin routes require the separate admin key.
4. Create one inbox with deterministic `client_id`.
5. Register an AgentMail webhook for both `message.received` and `message.security.completed`, then store its Svix secret.
6. Verify health, signature rejection, duplicate delivery, and inbound draft creation before enabling live use.

## Free-tier guardrails
- Do not create more than the Free plan's included inbox allowance.
- Monitor daily email usage and API rate limits.
- Never upgrade or incur charges automatically.
