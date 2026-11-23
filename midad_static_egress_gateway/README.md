# MIDAD — Static Egress Gateway

A minimal outbound gateway for MIDAD provider adapters that require a fixed source IP.

## Purpose

The gateway is the only component that talks to ViaBTC when IP whitelisting is enabled.

It is **not** a generic proxy.

Allowed upstream paths are fixed to ViaBTC mining read endpoints:

- /res/openapi/v1/hashrate
- /res/openapi/v1/profit
- /res/openapi/v1/profit/history
- /res/openapi/v1/wallet/payment/history
- /res/openapi/v1/hashrate/history
- /res/openapi/v1/hashrate/worker
- /res/openapi/v1/hashrate/worker/{worker_id}

Only GET is used upstream.

## Secret placement

Gateway host only:

- VIABTC_API_KEY
- MIDAD_VIABTC_GATEWAY_KEY

The incoming monitor request does not need to carry the ViaBTC API key. The gateway injects its own server-side key.

Do not place these values in GitHub Pages, Telegram, browser storage, or Control Room.

## Fixed egress requirement

Deploy this service on a host/network with a stable public IPv4 address.

Whitelist that exact source IPv4 in ViaBTC API Management. ViaBTC documents IP whitelist as a prerequisite for API use. A changed egress address will cause API error 12004 until the whitelist is updated.

## Contract

POST /v1/viabtc

Header:
Authorization: Bearer <MIDAD_VIABTC_GATEWAY_KEY>

Body:
{
  "path": "/res/openapi/v1/hashrate",
  "query": { "coin": "BTC" }
}

The response exposes only status and upstream JSON. Request/response credentials are never returned.

## Run

node server.mjs

or:

docker build -t midad-static-egress-gateway .
docker run --rm -p 127.0.0.1:8788:8788 --env-file .env midad-static-egress-gateway

Bind externally only through the trusted network/reverse proxy.

## Optional no-card proxy bridge

When a dedicated VPS/static-egress host is unavailable, the gateway can route its ViaBTC upstream requests through a fixed/static proxy.

Set:

- `MIDAD_VIABTC_PROXY_URL` = the proxy URL including credentials if the provider requires them.
- `MIDAD_VIABTC_PROXY_REQUIRED=true` = fail closed; if the proxy is unavailable or unset, the gateway will not connect directly.

The proxy is used only for the gateway's outbound ViaBTC requests. The caller still talks only to the MIDAD gateway.

For a ViaBTC IP whitelist, add the proxy's actual public egress IP address, not the Render/container address.

This mode is intended as a temporary bridge/testing path when the proxy provider is shared. Shared proxy IPs can be abused, blocked, rotated, or revoked; do not treat them as production-grade identity.

Never commit proxy credentials, ViaBTC keys, or gateway keys to Git. Put them in the hosting provider's secret/environment settings.

