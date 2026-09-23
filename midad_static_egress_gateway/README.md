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
