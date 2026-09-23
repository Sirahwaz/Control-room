# MIDAD — ViaBTC Read-Only Monitor

This component is a portable read-only mining observer for MIDAD.

## Architecture

MIDAD Control Room / n8n / Supabase
        |
        | internal authenticated HTTP
        v
midad_viabtc_monitor
        |
        | ViaBTC Adapter
        v
static-egress gateway / host
        |
        | fixed outbound IP
        v
ViaBTC API

The monitor is intentionally **not** a financial execution path.

## Current supported observations

- account realtime BTC hashrate
- BTC profit summary
- individual worker realtime hashrate

These map to ViaBTC endpoints documented by ViaBTC as non-signature GET operations. ViaBTC still requires API authentication and IP whitelist configuration.

## Security model

- ViaBTC API key is server-side only.
- No ViaBTC secret is stored in Git.
- No generic upstream proxy or arbitrary URL forwarding exists.
- Only explicit ViaBTC read endpoints are allowed.
- Monitor endpoints require `MIDAD_MONITOR_TOKEN`.
- No withdrawal, transfer, order, payout, or account-mutation endpoint is implemented.
- The monitor returns normalized observations with source, timestamp and freshness metadata.
- Default bind is localhost. A gateway/container reverse proxy should expose it only to trusted internal callers.
- Set a stable public egress IP on the host/network and whitelist that IP in ViaBTC.

## Configuration

Copy `.env.example` to an environment-specific secret store.

Required:
- `VIABTC_API_KEY`
- `MIDAD_MONITOR_TOKEN`

Optional:
- `VIABTC_API_BASE_URL` (default: https://www.viabtc.net)
- `HOST` (default: 127.0.0.1)
- `PORT` (default: 8787)
- `REQUEST_TIMEOUT_MS` (default: 8000)
- `MAX_FRESHNESS_SECONDS` (default: 120)

## Routes

GET /healthz

GET /v1/account/hashrate?coin=BTC

GET /v1/profit?coin=BTC

GET /v1/worker/:workerId?coin=BTC

All routes other than /healthz require:
`Authorization: Bearer <MIDAD_MONITOR_TOKEN>`

## MIDAD normalized observation

Every successful observation contains:

- schema_version
- provider_id
- provider_type
- environment
- observed_at
- source.endpoint
- source.provider_message
- freshness_seconds
- status
- data

The raw upstream response is not exposed by this service.

## Run

`node server.mjs`

For container use:

`docker build -t midad-viabtc-monitor .`

`docker run --rm -p 127.0.0.1:8787:8787 --env-file .env midad-viabtc-monitor`

Do not publish the monitor directly to the public Internet. Put it behind the chosen static-egress/internal gateway.
