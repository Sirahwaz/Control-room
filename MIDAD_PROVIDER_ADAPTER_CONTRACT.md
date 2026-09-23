# MIDAD — Provider Adapter Contract

A provider adapter is the boundary between MIDAD and an external financial venue.

## Required metadata
- provider_id
- provider_type: EXCHANGE | WALLET | PAYMENT | CHAIN | MINING
- environment: PAPER | TESTNET | LIVE
- capabilities
- rate_limits
- credential_scope
- health_status
- clock_status

## Canonical market objects
- symbol
- base_asset
- quote_asset
- market_type
- tick_size
- step_size
- min_notional
- fee_model

## Canonical order request
- request_id
- provider_id
- symbol
- side
- order_type
- amount
- limit_price
- stop_price
- time_in_force
- client_order_id
- created_at
- expires_at
- risk_context

## Canonical order result
- provider_order_id
- client_order_id
- status
- filled_amount
- remaining_amount
- average_price
- fees
- timestamps
- raw_reference

## Canonical transfer request
- request_id
- source
- destination
- asset
- network
- amount
- purpose
- approval_id
- allowlist_match

## Security requirements
1. Secrets live outside the browser.
2. Read-only credentials are preferred.
3. Trading and withdrawal credentials are separated.
4. Withdrawal destinations are allow-listed where supported.
5. The adapter rejects expired order requests.
6. The adapter records provider timestamps and request ids.
7. Every live mutation is idempotency-safe where the venue supports client order ids.
8. Raw provider responses are retained in secure logs for reconciliation, not exposed as secrets.

## Latency design
- WebSocket/streaming feeds for market-event detection where available.
- REST for reconciliation and control-plane actions.
- Pre-computed policy state.
- Short-lived cached market metadata.
- Bounded retry policy.
- No unbounded retry on order submission.
- Cancel/replace logic must be explicit and idempotent.

## Kill behavior
A global kill switch must be able to:
- stop new orders
- cancel open orders where supported
- mark the strategy disabled
- preserve audit logs

It must not silently create a new position while attempting to exit another one.
