# MIDAD Trading Intelligence — architecture and evidence gates

## Product intent

A dedicated Android command surface for live public market data, market-structure research, public-chain/social event intelligence, manual trade preparation, strategy research, and eventually guarded automated execution. The phone is a control/monitoring surface; persistent collectors, strategy workers, risk checks and the single order executor belong server-side.

This product does not promise profits. Every performance claim must be based on independently reconciled fills and realised net PnL after fees, slippage, funding, gas and failed/partial orders.

## Existing system audit (2026-11-05)

### Reuse

- mobile/factory/ and Factory X already provide manifest-driven Capacitor Android builds, reusable registries, capability/provider discovery, bounded parallelism, Agentation DOM feedback, quality gates, and Android emulator runtime smoke.
- mobile/factory/products/midad-mobile.json is the known-good v0.4.1 shell baseline. The new product uses a separate manifest and Android application ID; it does not overwrite MIDAD Mobile.
- Existing iaitrader.html and midad_iaitrader_station expose a Telegram Mini App-authenticated station with overview, configuration, connector credential storage through server-side vault, connector testing, market-rule lookup, analysis, paper, trade preparation, live-gate request, lock and copilot actions.
- midad_market_ingest already gathers public signals from Binance, Bybit, CoinEx, CoinGecko, DexScreener token boosts and CoinGecko trending. Its write path requires a server-side ingest/autonomy key.
- midad_noncopy_trading_engine currently compares public BTC spot snapshots from Binance, Bybit, CoinEx, CoinGecko, Kraken and OKX. This is useful as a baseline but is not a multi-market, tick/order-book or low-latency arbitrage engine.
- midad_market_edge supports authenticated quote, risk-check and trade-intent preparation for Binance/CoinEx. It explicitly reports no live order submission and requires the server ingest key.
- The current exchange connectors in midad_financial_connectors are planned for Weex, Ourbit and CoinEx; no verified connected account was found. The iAiTrader governor is paper/locked. Existing station source reports live_execution:false.
- The existing station API requires Telegram initData. A standalone APK cannot assume that Telegram session exists. A dedicated, owner-scoped mobile pairing/session contract is a release blocker for account balances, private account state and trade actions.

### Existing live-data limitation

The current market ingest function is an authenticated collector, not a public mobile API. The market edge function also requires a server-side ingest key. Do not place either secret in the APK. Public market WebSocket feeds may be consumed directly by the client for display, but all private account and trading actions must go through authenticated server-side APIs.

## Proposed architecture

1. Android client (Capacitor 8 / Factory X): live watchlist, freshness badges, chart, order-book view, radar triage, trade ticket, portfolio, strategy lab, kill switch and explainable audit history. The current first increment consumes public Binance Spot ticker WebSocket only. No API secrets or private exchange credentials ship in the APK.
2. Market-data gateway: server-side normalized feed adapters with WebSocket/REST fallback, sequence/timestamp checks, provider health, rate-limit handling, symbol metadata, OHLCV, trades, order books and historical snapshots. Initial candidates: Cryptofeed for supported feed ingestion; CCXT for exchange-neutral REST/private adapter contracts. Provider coverage and licensing/rate limits must be verified before activation.
3. Event intelligence: CEX and DEX market movers; relative-volume and volatility anomalies; DEX pool liquidity/depth and liquidity changes; holder concentration, deployer/insider clusters, token authority and contract risks where chain data permits; public social attention anomalies and announcement verification. DexScreener/CoinGecko sources are discovery inputs, never proof of legitimacy or a buy signal.
4. Strategy research: TA-Lib for indicators; VectorBT for vectorized exploration; Freqtrade as a candidate single strategy runtime; DuckDB for replayable market/trade research; QuantStats for performance reports; skfolio only when portfolio allocation optimization is needed. Do not run multiple order engines. Select one engine after adapter and execution semantics tests.
5. Risk and execution: one server-side order submission service only. Idempotent clientOrderId; query order status before retry; support partial fills, cancel/replace, fee assets, min notional/lot size, price bands, tick sizes, slippage and liquidity checks. Separate read-only account connector from trade-enabled credential scope. Withdrawals, transfers, leverage and wallet signing remain disabled.
6. Persistence/observability: reuse Supabase as control plane and audit store; use DuckDB or object storage for bulky replay datasets where appropriate. Record raw-source timestamp, normalized event, decision inputs, strategy version, risk decision, order request, exchange acknowledgement, fills, fees and reconciliation state.
7. Mobile Factory delivery: separate product manifest midad-trading; Android package ai.midad.trading; debug/internal distribution only until privacy, auth, security and financial approval gates pass.

## Pump/dump and momentum radar policy

The radar is for public market events and asset/contract risk, not tracking or profiling private people. It must distinguish:
- organic momentum (verified listings, protocol releases, broad market moves);
- unusual but unexplained volatility;
- likely coordinated promotion/manipulation indicators;
- liquidity-exit / rug / honeypot / contract-control risk.

A candidate is WATCH, never BUY, until independently verified. Require at least two independent market sources, a baseline-relative volume spike, usable executable liquidity, spread/depth checks, holder/deployer concentration review, contract/authority checks, and exit simulation. Social mentions alone are low-confidence. A sharp move can be a liquidation, listing or news reaction; it is not proof of manipulation.

## Current implementation in this branch

- New isolated Android product manifest and web entry.
- Real public Binance Spot WebSocket ticker stream for a bounded watchlist, freshness/stale-feed handling and visible source provenance.
- Mobile-first market screen, tabs for Market / Pump Radar / Trade / Portfolio / Strategy Lab.
- Manual ticket calculates a preview from a current live quote and estimated fee/slippage/stop cost; it cannot submit an order.
- Portfolio values remain unavailable until an authenticated exchange account is paired; no synthetic balance/PnL.
- Pump Radar explicitly reports missing on-chain/social evidence instead of fabricating signals.
- Deterministic contract tests cover ticker validation, feed freshness, fee/slippage previews and pump triage.
- The Factory quality gate runs those tests for this product.

## Release gates / blockers

1. Verify CI build, artifact integrity, emulator install/launch smoke and actual selected manifest assets.
2. Establish standalone MIDAD mobile authentication/pairing without exposing Telegram initData, Supabase service keys or exchange credentials.
3. Add server-side market gateway for multi-exchange feeds and historical candles/order books; prove freshness and failover.
4. Add on-chain DEX and token-risk providers with rate limits, independent-source validation and source attribution.
5. Add a single order engine and exchange adapter; verify testnet/paper semantics, min-size filters, partial fills, idempotency and reconciliation.
6. Complete paper sessions across volatility regimes and out-of-sample/walk-forward validation. Include fees, slippage, latency, funding, gas and failed orders.
7. Require explicit human approval before any live order capability is enabled. No live trading in this first Android increment.

## Acceptance metrics

- Feed uptime, event age, reconnect count, dropped sequence count and source disagreement.
- Radar precision/false-positive rate and lead time versus price/volume/liquidity changes.
- Net expectancy, profit factor, max drawdown, tail loss, Sharpe/Sortino, turnover and capacity after all costs.
- Paper-vs-live execution slippage, partial-fill rate, order reject rate and reconciliation completeness.
- All displayed balances/PnL must reconcile to exchange fills and fees; unrealised PnL must be labelled separately.

## Security invariants

- Never store exchange keys in the app, logs, GitHub, screenshots or analytics.
- Use least-privilege API keys: read-only first; trade permission only after explicit approval; withdrawals disabled.
- No key entry in chat. Use server-side Vault and credential rotation.
- One order executor, server-side hard limits, kill switch, idempotency and audit trail.
- Unknown/stale market data, missing source, risk-engine outage or account mismatch => fail closed.
