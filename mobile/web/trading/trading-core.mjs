export function analyzeTrend(candles, { now = Date.now(), maxAgeMs = 120000 } = {}) {
  if (!Array.isArray(candles) || candles.length < 60) return { state: "INSUFFICIENT_HISTORY", horizons: {} };
  const rows = candles.map(c => ({
    openTime: Number(c?.openTime), closeTime: Number(c?.closeTime),
    open: Number(c?.open), high: Number(c?.high), low: Number(c?.low),
    close: Number(c?.close), volume: Number(c?.volume), quoteVolume: Number(c?.quoteVolume)
  }));
  if (rows.some(c => ![c.openTime,c.closeTime,c.open,c.high,c.low,c.close,c.volume,c.quoteVolume].every(Number.isFinite) || c.close <= 0 || c.open <= 0 || c.high <= 0 || c.low <= 0 || c.volume < 0 || c.quoteVolume < 0 || c.closeTime < c.openTime)) {
    return { state: "INVALID_DATA", horizons: {} };
  }
  for (let i=1;i<rows.length;i++) if (rows[i].closeTime <= rows[i-1].closeTime) return { state: "INVALID_DATA", horizons: {} };
  const latest = rows[rows.length-1];
  if (latest.closeTime > now || now - latest.closeTime > maxAgeMs) return { state: "STALE", horizons: {} };
  const horizons = {};
  for (const [label,count] of [["5m",5],["15m",15],["1h",60]]) {
    if (rows.length < count + 1) return { state: "INSUFFICIENT_HISTORY", horizons: {} };
    const recent = rows.slice(-count);
    const baseline = rows.slice(0,-count);
    const start = recent[0].open;
    const end = latest.close;
    const recentVolume = recent.reduce((sum,c)=>sum+c.quoteVolume,0)/recent.length;
    const baselineVolume = baseline.reduce((sum,c)=>sum+c.quoteVolume,0)/baseline.length;
    const rangePct = ((Math.max(...recent.map(c=>c.high))-Math.min(...recent.map(c=>c.low)))/start)*100;
    horizons[label] = {
      returnPct: ((end/start)-1)*100,
      relativeVolume: baselineVolume > 0 ? recentVolume/baselineVolume : 0,
      rangePct,
      sampleCount: recent.length
    };
  }
  return { state: "VALID", latestClose: latest.close, latestTimestamp: latest.closeTime, horizons };
}

export function evaluateCandidate({ trend, sourceCount, liquidityUsd, spreadPct, holderConcentrationPct, contractRisk, exitSimulationPassed } = {}) {
  const sources=Number(sourceCount), liquidity=Number(liquidityUsd), spread=Number(spreadPct), holders=Number(holderConcentrationPct);
  const flags=[];
  if (!trend || trend.state !== "VALID" || !trend.horizons) flags.push("TREND_EVIDENCE_MISSING");
  if (![sources,liquidity,spread,holders].every(Number.isFinite)) flags.push("METRICS_MISSING");
  if (Number.isFinite(sources) && sources < 2) flags.push("INSUFFICIENT_INDEPENDENT_SOURCES");
  if (Number.isFinite(liquidity) && liquidity < 10000) flags.push("THIN_LIQUIDITY");
  if (Number.isFinite(spread) && spread > 1.5) flags.push("WIDE_SPREAD");
  if (Number.isFinite(holders) && holders >= 80) flags.push("EXTREME_HOLDER_CONCENTRATION");
  else if (Number.isFinite(holders) && holders >= 35) flags.push("HIGH_HOLDER_CONCENTRATION");
  if (contractRisk !== "LOW") flags.push("CONTRACT_RISK_NOT_CLEARED");
  if (exitSimulationPassed !== true) flags.push("EXIT_SIMULATION_NOT_PASSED");
  if (trend?.state === "VALID" && trend.horizons) {
    const m5=trend.horizons["5m"],m15=trend.horizons["15m"],h1=trend.horizons["1h"];
    if (![m5?.returnPct,m5?.relativeVolume,m15?.returnPct,m15?.relativeVolume,h1?.returnPct,h1?.relativeVolume].every(Number.isFinite)) flags.push("MULTI_HORIZON_DATA_INCOMPLETE");
    else {
      if (m5.returnPct < 5 || m15.returnPct <= 0 || h1.returnPct <= 0) flags.push("MOMENTUM_NOT_ALIGNED");
      if (m5.relativeVolume < 2) flags.push("RELATIVE_VOLUME_NOT_CONFIRMED");
    }
  }
  const hardRisk = flags.some(x=>["TREND_EVIDENCE_MISSING","METRICS_MISSING","INSUFFICIENT_INDEPENDENT_SOURCES","THIN_LIQUIDITY","WIDE_SPREAD","EXTREME_HOLDER_CONCENTRATION","CONTRACT_RISK_NOT_CLEARED","EXIT_SIMULATION_NOT_PASSED","MULTI_HORIZON_DATA_INCOMPLETE","MOMENTUM_NOT_ALIGNED","RELATIVE_VOLUME_NOT_CONFIRMED"].includes(x));
  return { state: hardRisk ? "REJECT" : flags.length ? "WATCH" : "QUALIFIED_FOR_PAPER", riskFlags: flags, executionAllowed: false, action: flags.length ? "OBSERVE_OR_REJECT" : "PAPER_ONLY", note: "Qualification is not a buy signal and never authorizes live execution." };
}

export function allocateCapitalBuckets(capital, allocation = { reserve: 45, core: 25, tactical: 20, experimental: 10 }) {
  const total=Number(capital), entries=Object.entries(allocation||{});
  const pct=entries.reduce((sum,[,v])=>sum+Number(v),0);
  if (!Number.isFinite(total) || total < 0 || !entries.length || entries.some(([k,v])=>!["reserve","core","tactical","experimental"].includes(k)||!Number.isFinite(Number(v))||Number(v)<0) || Math.abs(pct-100)>1e-9) throw new TypeError("INVALID_CAPITAL_ALLOCATION");
  const buckets={};
  for (const [key,value] of entries) buckets[key]=total*Number(value)/100;
  const reserve=buckets.reserve||0;
  return { ...buckets, total, reserve, deployable: total-reserve, protectedReservePct: Number(allocation.reserve||0), executionAllowed:false, mode:"VIRTUAL_LEDGER_ONLY" };
}

export function calculatePositionBudget({ capital, bucket, stopPct, maxRiskPct = 1, allocation } = {}) {
  const ledger=allocateCapitalBuckets(capital,allocation);
  if (bucket === "reserve") throw new TypeError("PROTECTED_BUCKET");
  if (!Object.hasOwn(ledger,bucket) || !["core","tactical","experimental"].includes(bucket)) throw new TypeError("INVALID_CAPITAL_BUCKET");
  const stop=Number(stopPct), risk=Number(maxRiskPct), base=Number(capital);
  if (![stop,risk].every(Number.isFinite) || stop<=0 || risk<=0 || risk>5) throw new TypeError("INVALID_POSITION_RISK");
  const riskBudget=base*risk/100;
  const positionNotional=Math.min(ledger[bucket],riskBudget/(stop/100));
  return { bucket, bucketAvailable:ledger[bucket], riskBudget, positionNotional, maxLossAtStop:positionNotional*stop/100, executionAllowed:false, mode:"PAPER_BUDGET_ONLY" };
}
