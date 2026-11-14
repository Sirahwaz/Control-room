# MIDAD Micro Calendar Read-only Adapter

Internal server-to-server adapter for Micro's `GET /api/v1/events/free` method.

## Security contract

- Fixed upstream origin: `https://micro.mu`; no caller-supplied host, URL, path, or headers.
- Only the `calendar_availability` action is accepted.
- Only GET `/api/v1/events/free` is called upstream.
- Redirects are rejected; requests time out; response size is bounded.
- Input is allowlisted and the requested time window is limited to 14 days.
- No token or upstream error body is returned or logged.
- Requires Supabase service-role JWT verification and a separate `MIDAD_MICRO_ADAPTER_KEY`.
- The Micro token is read only from `MIDAD_MICRO_API_TOKEN`.

## Required Supabase secrets

- `MIDAD_MICRO_API_TOKEN`: Micro Personal Access Token scoped to the `events` service.
- `MIDAD_MICRO_ADAPTER_KEY`: independent high-entropy secret used by the trusted MIDAD caller.
- Existing `SUPABASE_SERVICE_ROLE_KEY`: required for the internal service-to-service JWT gate.

Never put either Micro token or adapter key in Git, a browser, Telegram, or this chat.

## Micro account setup

1. In Micro, open Account and connect Google Calendar explicitly. The Calendar connection requests read-only access; select the calendars to include.
2. At `/account/tokens`, create a service-scoped token for the `events` service. Do not select Agent, Work, or Operator capabilities.
3. Store the token in Supabase Edge Function secrets as `MIDAD_MICRO_API_TOKEN`.

Important: Micro scopes tokens by service, not by individual method. The adapter itself calls only `events_free` using GET. A stolen `events`-scoped token could still call other Events service methods against Micro's own records; Google's OAuth grant remains read-only and cannot write to Google Calendar. Keep the token server-side and revoke/rotate it if exposed.

## Request contract

POST `/functions/v1/midad_micro_calendar_adapter`

Headers:
- `Authorization: Bearer <Supabase service-role JWT>`
- `x-midad-micro-adapter-key: <MIDAD_MICRO_ADAPTER_KEY>`
- `Content-Type: application/json`

Body:
```json
{
  "action": "calendar_availability",
  "from": "2026-11-06T09:00:00+01:00",
  "to": "2026-11-07T18:00:00+01:00",
  "minutes": 45,
  "day_start": 9,
  "day_end": 18
}
```

All fields except `action` are optional. Times must be RFC3339 with an explicit timezone. The adapter allows at most 14 days and 15–480 minute slots. Micro defaults to a 7-day window, 30-minute slots and 09:00–18:00 working hours.

## Tests

`node --test supabase/functions/midad_micro_calendar_adapter/adapter.test.mjs`

Tests use a mocked fetch and do not call Micro or access calendar data.
