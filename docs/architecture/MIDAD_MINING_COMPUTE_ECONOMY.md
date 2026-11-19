# MIDAD Mining & Compute Economy (MMCE)

**Status:** P0 implementation — offline economics core; no live mining or spending enabled.

## Objective

Compare the verified net daily value of mining, paid compute work, and virtual-PC utility for the same authorized compute resource. MMCE is an advisory decision layer, not a miner controller or financial execution path.

## Preserve and integrate existing components

- `midad_viabtc_monitor`: existing read-only ViaBTC account/worker/profit observations.
- `tools/midad-miner-sensor`: existing local read-only Bitmain/CGMiner telemetry collector.
- `midad_miner_microscope`: existing worker diagnostics and incident history.
- `midad_mining_accounts`: existing mining account/control-room read model.
- Existing wallet and revenue reconciliation paths remain authoritative for confirmed receipts.

MMCE does not duplicate provider polling, miner health diagnosis, pool connectivity, wallet custody, withdrawals, or payment reconciliation.

## P0 delivered

`compute/mmce/economics.mjs` provides two pure functions:

- `evaluateMiningEconomics(input)`: computes daily energy use, electricity cost, pool fee, hosting/other costs, net profit, break-even gross revenue and margin.
- `rankResourceUse(input)`: compares mining, paid compute tasks, and virtual-PC utility using net daily values.

All monetary values are USD/day. Inputs must be finite; their provenance is supplied by the caller and is not authenticated by this pure calculation module. Successful results are labeled `CALCULATED_ESTIMATE` or `CALCULATED_COMPARISON` with `evidenceStatus: CALLER_SUPPLIED_NOT_VERIFIED`; these labels must never be presented as provider-verified facts. Missing required mining inputs return `BLOCKED_MISSING_INPUT`; missing allocation candidates return `BLOCKED_UNVERIFIED_INPUT`. Negative net values are valid and are compared as losses rather than rejected.

## Evidence contract

The engine deliberately does not fetch prices, infer electricity rates, estimate unobserved power draw, or invent pool revenue. A future provider adapter must normalize source observations into this contract and retain:

- source/provider and endpoint;
- observation timestamp and freshness;
- asset, network and payout assumptions;
- gross revenue period and source;
- measured/declared power draw and its evidence;
- electricity tariff and currency conversion timestamp;
- pool fee, hosting charge, and other recurring costs;
- confidence, missing fields, and stale-data status.

A profitability result is an estimate, not a realized receipt. Only finalized wallet receipts matched to asset, network, amount, transaction hash and the relevant mining account/order count as revenue.

## Resource allocation policy

1. Admit only owner-controlled or explicitly authorized resources.
2. Require all three candidate values (MINING, COMPUTE_TASK, VIRTUAL_PC) before automatic comparison.
3. Compare net values after all known costs; never rank on gross revenue.
4. If evidence is missing or stale, return a blocked result and do not start mining.
5. This module only recommends; it does not start/stop miners, rent compute, change pools, sign transactions, withdraw, or move funds.
6. No paid provider, hash-rate contract, hardware purchase, deposit, or cloud instance may be initiated without a separate costed proposal and owner approval.

## Runtime / pause boundary

The existing mining policy previously paused ViaBTC monitoring, miner scans, telemetry and cron/agent steps. This implementation is offline and does not invoke or schedule any of them. Live monitoring and mining remain disabled until the owner separately authorizes a scoped pilot with a verified resource, power/hosting cost, and stop limits.

## Next stages

- P1: read-only source adapter mapping verified ViaBTC and local sensor observations into the evidence contract; reject stale or incomplete observations.
- P2: resource inventory/admission contract for DRF/MNCF nodes; no execution permission by default.
- P3: dashboard surface showing revenue, energy, costs, net result, freshness and evidence provenance.
- P4: owner-approved, bounded pilot on one authorized resource; separate kill switch and receipt reconciliation.
