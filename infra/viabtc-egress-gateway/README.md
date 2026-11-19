# MIDAD — ViaBTC Static Egress Gateway

Purpose: give the existing MIDAD ViaBTC monitor a stable outbound IPv4 so ViaBTC IP allowlisting can be used without moving the MIDAD core.

## Security contract

- Only the fixed ViaBTC API host is reachable.
- Only the five read-only telemetry endpoints used by MIDAD are allowed.
- Gateway access requires `MIDAD_GATEWAY_KEY`.
- The ViaBTC API key is forwarded in memory only; it is not stored by this service.
- No withdrawal, transfer, trading, account-management, or arbitrary proxy routes exist.
- Request bodies are capped at 16 KiB.
- Upstream calls have a 10-second timeout.
- Secrets are never written to logs.

## Deployment

1. Create or sign in to Fly.io. Fly currently supports GitHub signup, but may require a payment card for a new Pay-As-You-Go account.
2. From this directory, deploy the app.
3. Set the gateway secret:
   `fly secrets set MIDAD_GATEWAY_KEY="<long-random-secret>" --app midad-viabtc-egress`
4. Allocate an app-scoped static egress pair in the chosen region:
   `fly ips allocate-egress --app midad-viabtc-egress -r fra`
5. Read the allocated IPv4 with:
   `fly ips list --app midad-viabtc-egress`
6. In ViaBTC API Management, add only that IPv4 to the API key's IP whitelist.
7. Configure MIDAD Edge Function secrets:
   - `MIDAD_VIABTC_GATEWAY_URL`
   - `MIDAD_VIABTC_GATEWAY_KEY`
8. Update `midad_viabtc_monitor` to call the gateway and keep `VIABTC_API_KEY` in Supabase.

## Expected flow

Supabase Edge Function -> HTTPS gateway -> ViaBTC API

The gateway's static egress IPv4 is the only address ViaBTC should need to allowlist.