/**
 * MIDAD Mining & Compute Economy (MMCE)
 *
 * Pure, offline economics functions. This module never connects to pools,
 * wallets, miners, exchanges, cloud vendors, or external APIs.
 *
 * All monetary values are USD per day. Inputs must come from independently
 * verified provider/owner evidence; missing inputs fail closed.
 */

const REQUIRED_MINING_INPUTS = [
  "grossRevenuePerDayUsd",
  "powerWatts",
  "electricityPricePerKwhUsd",
  "poolFeePercent",
  "hostingCostPerDayUsd",
  "otherCostPerDayUsd"
];

function finiteNonNegative(value, field, { max = Number.MAX_VALUE } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max) {
    throw new TypeError(`${field} must be a finite non-negative number`);
  }
  return value;
}

function round(value, places = 10) {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function evaluateMiningEconomics(input = {}) {
  const missingInputs = REQUIRED_MINING_INPUTS.filter(
    (field) => input[field] === undefined || input[field] === null
  );

  if (missingInputs.length) {
    return {
      schemaVersion: "midad.mmce.economics.v1",
      status: "BLOCKED_MISSING_INPUT",
      currency: "USD",
      period: "DAY",
      missingInputs,
      energyKwhPerDay: null,
      electricityCostPerDayUsd: null,
      poolFeePerDayUsd: null,
      totalCostPerDayUsd: null,
      netProfitPerDayUsd: null,
      breakEvenGrossRevenuePerDayUsd: null,
      profitMarginPercent: null,
      recommendation: "DO_NOT_START_OR_SCALE_MINING"
    };
  }

  const grossRevenue = finiteNonNegative(input.grossRevenuePerDayUsd, "grossRevenuePerDayUsd");
  const powerWatts = finiteNonNegative(input.powerWatts, "powerWatts");
  const electricityRate = finiteNonNegative(input.electricityPricePerKwhUsd, "electricityPricePerKwhUsd");
  const poolFeePercent = finiteNonNegative(input.poolFeePercent, "poolFeePercent", { max: 100 });
  const hostingCost = finiteNonNegative(input.hostingCostPerDayUsd, "hostingCostPerDayUsd");
  const otherCost = finiteNonNegative(input.otherCostPerDayUsd, "otherCostPerDayUsd");

  const energyKwhPerDay = powerWatts * 24 / 1000;
  const electricityCost = energyKwhPerDay * electricityRate;
  const poolFee = grossRevenue * poolFeePercent / 100;
  const totalCost = electricityCost + poolFee + hostingCost + otherCost;
  const netProfit = grossRevenue - totalCost;
  const nonPoolCosts = electricityCost + hostingCost + otherCost;
  const breakEvenGrossRevenue = poolFeePercent === 100
    ? (nonPoolCosts === 0 ? 0 : null)
    : nonPoolCosts / (1 - poolFeePercent / 100);
  const margin = grossRevenue === 0 ? (netProfit === 0 ? 0 : -100) : netProfit / grossRevenue * 100;

  return {
    schemaVersion: "midad.mmce.economics.v1",
    status: "VERIFIED_ESTIMATE",
    currency: "USD",
    period: "DAY",
    missingInputs: [],
    inputs: {
      grossRevenuePerDayUsd: grossRevenue,
      powerWatts,
      electricityPricePerKwhUsd: electricityRate,
      poolFeePercent,
      hostingCostPerDayUsd: hostingCost,
      otherCostPerDayUsd: otherCost
    },
    energyKwhPerDay: round(energyKwhPerDay),
    electricityCostPerDayUsd: round(electricityCost),
    poolFeePerDayUsd: round(poolFee),
    totalCostPerDayUsd: round(totalCost),
    netProfitPerDayUsd: round(netProfit),
    breakEvenGrossRevenuePerDayUsd: breakEvenGrossRevenue === null ? null : round(breakEvenGrossRevenue),
    profitMarginPercent: round(margin),
    recommendation: netProfit > 0 ? "ELIGIBLE_FOR_COMPARISON_ONLY" : "DO_NOT_START_OR_SCALE_MINING"
  };
}

/**
 * Compare net daily value across eligible uses of the same resource.
 * Every candidate must be quantified. This is advisory only and does not
 * start, stop, rent, or reconfigure any resource.
 */
export function rankResourceUse({
  miningNetPerDayUsd,
  computeTaskNetPerDayUsd,
  virtualPcUtilityPerDayUsd
} = {}) {
  const candidates = {
    MINING: miningNetPerDayUsd,
    COMPUTE_TASK: computeTaskNetPerDayUsd,
    VIRTUAL_PC: virtualPcUtilityPerDayUsd
  };

  const missingInputs = Object.entries(candidates)
    .filter(([, value]) => value === undefined || value === null)
    .map(([key]) => key);

  if (missingInputs.length) {
    return {
      schemaVersion: "midad.mmce.allocation.v1",
      status: "BLOCKED_UNVERIFIED_INPUT",
      recommendedUse: "NO_AUTOMATIC_ALLOCATION",
      missingInputs,
      candidates
    };
  }

  for (const [key, value] of Object.entries(candidates)) {
    finiteNonNegative(value, `${key}NetPerDayUsd`);
  }

  const [recommendedUse] = Object.entries(candidates)
    .sort((a, b) => b[1] - a[1])[0];

  return {
    schemaVersion: "midad.mmce.allocation.v1",
    status: "VERIFIED_COMPARISON",
    recommendedUse,
    missingInputs: [],
    candidates
  };
}
