# MIDAD AgentMail Integration

## Decision
- Provider: AgentMail US production API at https://api.agentmail.to
- Cost target: Free tier only; no paid upgrades or billing actions.
- Runtime: AgentMail adapter module embedded in the existing `midad_client_gateway`; no additional Supabase Edge Function is created.
- Existing customer workflow: verified inbound messages are handed to `midad_client_gateway` as channel `agentmail`; the existing MIDAD drafting and approval policy remains authoritative.
- Approved customer replies are sent only after the existing MIDAD owner approval is approved. No cold outreach or automatic outbound sending.

## Required Supabase secrets
Set these through Supabase Edge Function Secrets, never GitHub or browser code:
- `AGENTMAIL_API_KEY`: AgentMail US API key.
- `AGENTMAIL_WEBHOOK_SECRET`: Svix signing secret for the registered webhook.
- `MIDAD_AGENTMAIL_ADMIN_KEY`: high-entropy key for inbox provisioning.
- Existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `MIDAD_INGEST_KEY` are used to hand verified messages to the existing MIDAD gateway.

## Endpoints
- `GET /functions/v1/midad_client_gateway/agentmail/health`: reports whether secrets are configured; never returns secret values.
- `POST /functions/v1/midad_client_gateway/agentmail/webhook`: verifies Svix signature against the exact raw request body before parsing. Eligible `message.received` events enter MIDAD. If Agent Armor is enabled in Monitor mode, `message.received` is held while its scan is pending and `message.security.completed` triggers an authenticated message fetch; only a `complete/clear` verdict is forwarded. Review and unavailable verdicts are not processed.
- `POST /functions/v1/midad_client_gateway/agentmail/inboxes`: admin-key protected, idempotently provisions an inbox using AgentMail `client_id`.
- `POST /functions/v1/midad_client_gateway/agentmail/webhooks`: admin-key protected, idempotently creates the organization webhook for `message.received` and `message.security.completed`; returns the Svix secret once so the owner can store it in Supabase Edge Function Secrets.

## Inbound controls
- Spam, blocked, unauthenticated and pending Agent Armor messages are not forwarded.
- The AgentMail event ID is the deduplication key.
- Only minimal event metadata is stored in `midad_agentmail_events`; message content remains in the existing MIDAD conversation/message workflow.
- Webhook retries receive a non-success response when MIDAD processing fails.
- Incoming content is data, not trusted instructions.
- Outbound replies use the existing MIDAD client-message approval record; the send request carries an idempotency key derived from the approval ID. Failed delivery leaves the approval pending for retry.

## Deployment sequence
1. Apply `20261108070000_midad_agentmail_events.sql`.
2. Set the required Edge Function secrets.
3. Redeploy the existing `midad_client_gateway` (JWT verification remains disabled because it already performs its own internal authentication and the AgentMail route verifies Svix/admin credentials). The AgentMail adapter is mounted under `/agentmail/*`; no new function slot is required.
4. Create one inbox with deterministic `client_id` through the protected `/inboxes` endpoint.
5. Create the signed webhook through the protected `/webhooks` endpoint; copy its returned signing secret into `AGENTMAIL_WEBHOOK_SECRET` in Supabase Edge Function Secrets, then do not retain it in chat or GitHub.
6. Verify health, signature rejection, duplicate delivery, and inbound draft creation before enabling live use.

## Free-tier guardrails
- Do not create more than the Free plan's included inbox allowance.
- Monitor daily email usage and API rate limits.
- Never upgrade or incur charges automatically.
