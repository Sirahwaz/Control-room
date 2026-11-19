import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateMiningEconomics,
  rankResourceUse
} from "../compute/mmce/economics.mjs";

test("calculates net mining value after electricity, pool, hosting and other costs", () => {
  const result = evaluateMiningEconomics({
    grossRevenuePerDayUsd: 10,
    powerWatts: 1000,
    electricityPricePerKwhUsd: 0.10,
    poolFeePercent: 2,
    hostingCostPerDayUsd: 1,
    otherCostPerDayUsd: 0.25
  });

  assert.equal(result.status, "VERIFIED_ESTIMATE");
  assert.equal(result.energyKwhPerDay, 24);
  assert.equal(result.electricityCostPerDayUsd, 2.4);
  assert.equal(result.poolFeePerDayUsd, 0.2);
  assert.equal(result.totalCostPerDayUsd, 3.85);
  assert.equal(result.netProfitPerDayUsd, 6.15);
  assert.equal(result.breakEvenGrossRevenuePerDayUsd, 3.7244897959);
});

test("fails closed when a required cost input is unknown", () => {
  const result = evaluateMiningEconomics({
    grossRevenuePerDayUsd: 10,
    powerWatts: 1000,
    poolFeePercent: 2,
    hostingCostPerDayUsd: 0,
    otherCostPerDayUsd: 0
  });

  assert.equal(result.status, "BLOCKED_MISSING_INPUT");
  assert.equal(result.netProfitPerDayUsd, null);
  assert.ok(result.missingInputs.includes("electricityPricePerKwhUsd"));
});

test("rejects negative and non-finite financial or power inputs", () => {
  assert.throws(() => evaluateMiningEconomics({
    grossRevenuePerDayUsd: 10,
    powerWatts: -1,
    electricityPricePerKwhUsd: 0.1,
    poolFeePercent: 1,
    hostingCostPerDayUsd: 0,
    otherCostPerDayUsd: 0
  }), /powerWatts/);

  assert.throws(() => evaluateMiningEconomics({
    grossRevenuePerDayUsd: Infinity,
    powerWatts: 100,
    electricityPricePerKwhUsd: 0.1,
    poolFeePercent: 1,
    hostingCostPerDayUsd: 0,
    otherCostPerDayUsd: 0
  }), /grossRevenuePerDayUsd/);
});

test("does not recommend mining when another compute workload has higher net value", () => {
  const mining = evaluateMiningEconomics({
    grossRevenuePerDayUsd: 10,
    powerWatts: 1000,
    electricityPricePerKwhUsd: 0.1,
    poolFeePercent: 2,
    hostingCostPerDayUsd: 1,
    otherCostPerDayUsd: 0.25
  });

  const decision = rankResourceUse({
    miningNetPerDayUsd: mining.netProfitPerDayUsd,
    computeTaskNetPerDayUsd: 8,
    virtualPcUtilityPerDayUsd: 0
  });

  assert.equal(decision.recommendedUse, "COMPUTE_TASK");
  assert.equal(decision.status, "VERIFIED_COMPARISON");
});

test("blocks resource allocation when mining economics are not verified", () => {
  const decision = rankResourceUse({
    miningNetPerDayUsd: null,
    computeTaskNetPerDayUsd: 8,
    virtualPcUtilityPerDayUsd: 0
  });

  assert.equal(decision.recommendedUse, "NO_AUTOMATIC_ALLOCATION");
  assert.equal(decision.status, "BLOCKED_UNVERIFIED_INPUT");
});

test("allows negative net value candidates and prefers a non-negative alternative", () => {
  const decision = rankResourceUse({
    miningNetPerDayUsd: -4,
    computeTaskNetPerDayUsd: -1,
    virtualPcUtilityPerDayUsd: 0
  });
  assert.equal(decision.recommendedUse, "VIRTUAL_PC");
});
