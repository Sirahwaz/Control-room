# MIDAD MIMIC — Public Wallet Behavior Intelligence

## Scope
This module is a deterministic, read-only feature extractor for public EVM wallet activity returned by the existing `midad_chain_intelligence` v42 endpoint (Etherscan V2). It is not a transaction mirror or a trading bot.

## Inputs
- Public EVM address and numeric chain ID.
- Public transaction rows and token-transfer rows already retrieved by the existing Chain Intelligence service.
- Maximum sample: 500 normal transactions and 500 token transfers per evaluation.

## Outputs
- Directional activity, successful/failed counts, active days, cadence, contract-interaction ratio, counterparty concentration, token contract diversity.
- A bounded, descriptive feature vector and sample-quality flag.
- A feature-similarity index that is explicitly not proof of common ownership, profitability, or future performance.

## Hard boundaries
- No private keys, signatures, wallet connection, signing, order placement, copy trading, auto-follow, token swap, transfer, or withdrawal.
- No inference of the wallet owner's real-world identity.
- No profit prediction or claim of edge; observations are descriptive and sample-dependent.
- The code does not fetch chain data or invoke the Edge Function by itself. Integration into the existing market/trading UI is a later, separately reviewed change.
- No new Edge Function or database schema is introduced.

## Verification
The Node tests validate EVM address and chain input, transaction normalization, deduplication, failure separation, token-contract diversity without retaining transfer amounts, sample caps, and no-execution invariants.
