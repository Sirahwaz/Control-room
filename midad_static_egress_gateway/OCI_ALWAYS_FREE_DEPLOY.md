# MIDAD Static Egress Gateway — OCI Always Free deployment

## Goal

Run the existing restricted ViaBTC read gateway on a small OCI Always Free VM with a stable public IPv4 path. Do not move ViaBTC credentials into GitHub, Telegram, Control Room, or browser storage.

Supabase Edge Functions do not provide a stable outbound IP, so an outbound gateway is the correct pattern for ViaBTC IP allowlisting.

## OCI resources

Use an Always Free Compute VM. Oracle documents Always Free compute, and the AMD E2.1.Micro includes one VNIC with one public IPv4 address and up to 50 Mbps internet bandwidth. Always Free resources do not expire, subject to Oracle's capacity and idle-instance policies.

Recommended initial shape:
- VM.Standard.E2.1.Micro (AMD)
- Ubuntu 24.04 or another current Ubuntu LTS image
- 1 GB RAM is sufficient for this tiny gateway
- Public subnet + Internet Gateway
- TCP 22 for SSH
- TCP 80/443 for the HTTPS reverse proxy

Oracle's current Free Tier normally requires a phone number and credit card during signup; Oracle states the card is not charged unless the account is upgraded.

## Deployment

1. Create the VM and record its public IPv4 address.
2. Keep the VM/VNIC intact. Do not terminate/recreate it after the ViaBTC IP has been allowlisted.
3. SSH into the VM.
4. Install Node.js 20, Git, and Caddy.
5. Clone the MIDAD repository and enter `midad_static_egress_gateway/`.
6. Create a root-owned environment file containing only:
   - `VIABTC_API_KEY`
   - `MIDAD_VIABTC_GATEWAY_KEY`
   - `VIABTC_API_BASE_URL=https://pool.viabtc.com`
   - `HOST=127.0.0.1`
   - `PORT=8788`
   - `REQUEST_TIMEOUT_MS=8000`
7. Run the gateway under systemd as a non-root service.
8. Put Caddy in front of it and expose only HTTPS.

## HTTPS hostname

Preferred: use a domain you control and point an A record to the VM's public IPv4.

Fallback for a disposable infrastructure hostname: use an IP-derived DNS hostname such as `PUBLIC_IP.sslip.io` and let Caddy obtain a public certificate. Verify the certificate before putting the URL into Supabase.

The resulting gateway URL should be:

`https://YOUR_GATEWAY_HOST/v1/viabtc`

## ViaBTC allowlist

In ViaBTC:
Account Management → API Management → Set up IP whitelist.

Add the gateway VM's public IPv4 address.

ViaBTC currently allows up to 20 IP addresses, one per line. Keep the whitelist limited to the gateway address actually used by MIDAD.

Do not remove the current API key while validating.

## Gateway validation

Before touching Supabase, test:

`GET https://YOUR_GATEWAY_HOST/healthz`

Expected shape:

`{"ok":true,"service":"midad-static-egress-gateway","provider":"viabtc","mode":"READ_ONLY",...}`

Then test the protected ViaBTC route with the gateway key:

POST `https://YOUR_GATEWAY_HOST/v1/viabtc`

Header:
`x-midad-gateway-key: <gateway key>`

Body:
`{"path":"/res/openapi/v1/hashrate","query":{"coin":"BTC"}}`

A successful response must have:
- `ok: true`
- `transport: "static_egress_gateway"`
- `read_only: true`

Do not expose the ViaBTC API key in the response.

## Supabase configuration

In Edge Function Secrets set:
- `MIDAD_VIABTC_GATEWAY_URL=https://YOUR_GATEWAY_HOST`
- `MIDAD_VIABTC_GATEWAY_KEY=<same gateway key>`

Then set:
- `MIDAD_VIABTC_ALLOW_DIRECT=false`

This ensures the production path cannot silently bypass the gateway.

Keep:
- `VIABTC_API_KEY`
- `VIABTC_API_SECRET`

on the server-side monitor/gateway only.

## Final path

Control Room
→ midad_control_room
→ midad_viabtc_monitor
→ static egress gateway
→ fixed source IPv4
→ ViaBTC

The monitor remains read-only and remains outside the financial execution path.
