export function normalizeTicker(raw, receivedAt = Date.now()) {
  if (!raw || typeof raw !== "object") return null;
  const symbol = String(raw.s || raw.symbol || "").toUpperCase();
  const last = Number(raw.c ?? raw.lastPrice ?? raw.last);
  const changePct = Number(raw.P ?? raw.priceChangePercent ?? raw.changePct);
  const quoteVolume = Number(raw.q ?? raw.quoteVolume ?? raw.turnover24h ?? 0);
  const timestamp = Number(raw.E ?? raw.ts);
  if (!/^[A-Z0-9]{4,24}$/.test(symbol) || !Number.isFinite(last) || last <= 0 || !Number.isFinite(changePct) || !Number.isFinite(timestamp) || timestamp <= 0 || !Number.isFinite(receivedAt) || receivedAt <= 0) return null;
  return { symbol, last, changePct, quoteVolume: Number.isFinite(quoteVolume) && quoteVolume >= 0 ? quoteVolume : 0, timestamp, observedAt: receivedAt, timestampQuality: "SOURCE_EVENT", provider: "binance" };
}

export function normalizeCoinExTicker(raw, expectedMarket = null, receivedAt = Date.now()) {
  if (!raw || typeof raw !== "object") return null;
  const symbol = String(raw.market || "").toUpperCase();
  const expected = expectedMarket == null ? null : String(expectedMarket).toUpperCase();
  const last = Number(raw.last), open = Number(raw.open);
  const quoteVolume = Number(raw.value ?? 0);
  const hasSourceTimestamp = raw.ts != null;
  const timestamp = Number(hasSourceTimestamp ? raw.ts : receivedAt);
  if (!/^[A-Z0-9]{4,24}$/.test(symbol) || (expected && symbol !== expected) || !Number.isFinite(last) || last <= 0 || !Number.isFinite(open) || open <= 0 || !Number.isFinite(quoteVolume) || quoteVolume < 0 || !Number.isFinite(timestamp) || timestamp <= 0) return null;
  return { symbol, last, changePct: ((last / open) - 1) * 100, quoteVolume, timestamp, observedAt: receivedAt, timestampQuality: hasSourceTimestamp ? "SOURCE_EVENT" : "RETRIEVED_AT", provider: "coinex" };
}

export function isFresh(timestamp, maxAgeMs = 5000, now = Date.now()) {
  const ts = Number(timestamp);
  return Number.isFinite(ts) && ts > 0 && now >= ts && now - ts <= maxAgeMs;
}

export function computeTradePreview({ side, price, quoteBudget, feePct = 0, slippagePct = 0, stopPct = 1 } = {}) {
  const p = Number(price), budget = Number(quoteBudget), fee = Number(feePct), slip = Number(slippagePct), stop = Number(stopPct);
  if (!["buy", "sell"].includes(String(side)) || ![p,budget,fee,slip,stop].every(Number.isFinite) || p <= 0 || budget <= 0 || fee < 0 || slip < 0 || stop <= 0 || fee > 5 || slip > 20 || stop > 100) {
    throw new TypeError("INVALID_TRADE_PREVIEW_INPUT");
  }
  const quantity = budget / p;
  const feeCost = budget * fee / 100;
  const slippageCost = budget * slip / 100;
  const estimatedCost = feeCost + slippageCost;
  return {
    side, price: p, quoteBudget: budget, quantity,
    grossNotional: budget, feeCost, slippageCost, estimatedCost,
    estimatedStopLoss: budget * stop / 100 + estimatedCost,
    executionAllowed: false,
    mode: "PREVIEW_ONLY"
  };
}

export function classifyPumpSignal({ change5mPct, volumeRatio, liquidityUsd, sourceCount, holderConcentrationPct } = {}) {
  const change = Number(change5mPct), volume = Number(volumeRatio), liquidity = Number(liquidityUsd);
  const sources = Number(sourceCount), concentration = Number(holderConcentrationPct);
  const valid = [change,volume,liquidity,sources,concentration].every(Number.isFinite);
  const flags = [];
  if (!valid) return { state: "REJECT", riskFlags: ["INSUFFICIENT_EVIDENCE"], executionAllowed: false };
  if (change < 5) flags.push("MOMENTUM_BELOW_THRESHOLD");
  if (volume < 2) flags.push("VOLUME_NOT_CONFIRMED");
  if (liquidity < 10000) flags.push("THIN_LIQUIDITY");
  if (sources < 2) flags.push("SINGLE_SOURCE_ONLY");
  if (concentration >= 80) flags.push("EXTREME_HOLDER_CONCENTRATION");
  else if (concentration >= 35) flags.push("HIGH_HOLDER_CONCENTRATION");
  const hardReject = change < 5 || volume < 2 || liquidity < 10000 || sources < 2 || concentration >= 80;
  return {
    state: hardReject ? "REJECT" : "WATCH",
    riskFlags: flags,
    executionAllowed: false,
    note: "A pump alert is not a buy signal; verify liquidity, exits, ownership and source integrity."
  };
}


export function createPaperPosition({ id, symbol, side, quantity, entryPrice, feePct = 0.1, slippagePct = 0.05, stopPrice = null, targetPrice = null, bucket = null, openedAt = Date.now() } = {}) {
 const q=Number(quantity),p=Number(entryPrice),fee=Number(feePct),slip=Number(slippagePct),opened=Number(openedAt),pair=String(symbol||"").toUpperCase(),stop=stopPrice==null?null:Number(stopPrice),target=targetPrice==null?null:Number(targetPrice);
 const levels=(stop===null&&target===null)||(Number.isFinite(stop)&&Number.isFinite(target)&&stop>0&&target>0&&(side==="buy"?stop<p&&target>p:target<p&&stop>p));
 if(!id||!/^[A-Z0-9]{4,24}$/.test(pair)||!["buy","sell"].includes(String(side))||![q,p,fee,slip,opened].every(Number.isFinite)||q<=0||p<=0||fee<0||fee>5||slip<0||slip>20||opened<=0||!levels||(bucket!==null&&!["core","tactical","experimental"].includes(bucket)))throw new TypeError("INVALID_PAPER_POSITION");
 return {id:String(id),symbol:pair,side,quantity:q,entryPrice:p,feePct:fee,slippagePct:slip,stopPrice:stop,targetPrice:target,bucket,openedAt:opened,status:"OPEN",mode:"PAPER_ONLY"};
}

export function markPaperPosition(position, markPrice) {
  if (!position || position.mode!=="PAPER_ONLY" || position.status!=="OPEN") throw new TypeError("INVALID_PAPER_POSITION");
  const mark=Number(markPrice), q=Number(position.quantity), entry=Number(position.entryPrice);
  if (![mark,q,entry].every(Number.isFinite) || mark<=0 || q<=0 || entry<=0) throw new TypeError("INVALID_PAPER_MARK");
  const direction=position.side==="buy"?1:-1;
  const grossPnl=(mark-entry)*q*direction;
  const turnover=(entry+mark)*q;
  const totalCosts=turnover*(Number(position.feePct)+Number(position.slippagePct))/100;
  const netPnl=grossPnl-totalCosts;
  return { markPrice:mark, markValue:mark*q, grossPnl, totalCosts, netPnl, returnPct:(netPnl/(entry*q))*100 };
}

export function closePaperPosition(position, exitPrice, closedAt = Date.now()) {
  const mark=markPaperPosition(position,exitPrice), timestamp=Number(closedAt);
  if (!Number.isFinite(timestamp) || timestamp<=0) throw new TypeError("INVALID_PAPER_CLOSE_TIME");
  return { ...position, status:"CLOSED", closedAt:timestamp, exitPrice:Number(exitPrice), ...mark, executionAllowed:false };
}

export function analyzeTrend(candles, { now = Date.now(), maxAgeMs = 120000 } = {}) {
  if (!Array.isArray(candles) || candles.length < 60) return { state: "INSUFFICIENT_HISTORY", horizons: {} };
  const rows = candles.map(c => ({
    openTime: Number(c?.openTime), closeTime: Number(c?.closeTime),
    open: Number(c?.open), high: Number(c?.high), low: Number(c?.low),
    close: Number(c?.close), volume: Number(c?.volume), quoteVolume: Number(c?.quoteVolume)
  }));
  if (rows.some(c => ![c.openTime,c.closeTime,c.open,c.high,c.low,c.close,c.volume,c.quoteVolume].every(Number.isFinite) || c.close <= 0 || c.open <= 0 || c.high <= 0 || c.low <= 0 || c.volume < 0 || c.quoteVolume < 0 || c.closeTime < c.openTime)) return { state: "INVALID_DATA", horizons: {} };
  for (let i=1;i<rows.length;i++) if (rows[i].closeTime <= rows[i-1].closeTime) return { state: "INVALID_DATA", horizons: {} };
  const latest = rows[rows.length-1];
  if (latest.closeTime > now || now - latest.closeTime > maxAgeMs) return { state: "STALE", horizons: {} };
  const horizons = {};
  for (const [label,count] of [["5m",5],["15m",15],["1h",60]]) {
    if (rows.length < count + 1) return { state: "INSUFFICIENT_HISTORY", horizons: {} };
    const recent = rows.slice(-count), baseline = rows.slice(0,-count);
    const start = recent[0].open, end = latest.close;
    const recentVolume = recent.reduce((sum,c)=>sum+c.quoteVolume,0)/recent.length;
    const baselineVolume = baseline.reduce((sum,c)=>sum+c.quoteVolume,0)/baseline.length;
    const rangePct = ((Math.max(...recent.map(c=>c.high))-Math.min(...recent.map(c=>c.low)))/start)*100;
    horizons[label] = { returnPct: ((end/start)-1)*100, relativeVolume: baselineVolume > 0 ? recentVolume/baselineVolume : 0, rangePct, sampleCount: recent.length };
  }
  return { state: "VALID", latestClose: latest.close, latestTimestamp: latest.closeTime, horizons };
}

export function evaluateCandidate({ trend, sourceCount, liquidityUsd, spreadPct, holderConcentrationPct, contractRisk, exitSimulationPassed } = {}) {
  const sources=Number(sourceCount), liquidity=Number(liquidityUsd), spread=Number(spreadPct), holders=Number(holderConcentrationPct), flags=[];
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
  const total=Number(capital), entries=Object.entries(allocation||{}), pct=entries.reduce((sum,[,v])=>sum+Number(v),0);
  if (!Number.isFinite(total) || total < 0 || !entries.length || entries.some(([k,v])=>!["reserve","core","tactical","experimental"].includes(k)||!Number.isFinite(Number(v))||Number(v)<0) || Math.abs(pct-100)>1e-9) throw new TypeError("INVALID_CAPITAL_ALLOCATION");
  const buckets={}; for (const [key,value] of entries) buckets[key]=total*Number(value)/100;
  const reserve=buckets.reserve||0;
  return { ...buckets, total, reserve, deployable: total-reserve, protectedReservePct: Number(allocation.reserve||0), executionAllowed:false, mode:"VIRTUAL_LEDGER_ONLY" };
}

export function calculatePositionBudget({capital,bucket,stopPct,maxRiskPct=1,feePct=0,slippagePct=0,allocation}={}) {
 const ledger=allocateCapitalBuckets(capital,allocation);if(bucket==="reserve")throw new TypeError("PROTECTED_BUCKET");if(!Object.hasOwn(ledger,bucket)||!["core","tactical","experimental"].includes(bucket))throw new TypeError("INVALID_CAPITAL_BUCKET");
 const stop=Number(stopPct),risk=Number(maxRiskPct),fee=Number(feePct),slip=Number(slippagePct),base=Number(capital);
 if(![stop,risk,fee,slip].every(Number.isFinite)||stop<=0||stop>100||risk<=0||risk>5||fee<0||fee>5||slip<0||slip>20)throw new TypeError("INVALID_POSITION_RISK");
 const riskBudget=base*risk/100,riskRate=stop/100+(2+stop/100)*(fee+slip)/100,positionNotional=Math.min(ledger[bucket],riskBudget/riskRate);
 return {bucket,bucketAvailable:ledger[bucket],riskBudget,riskRate,positionNotional,maxLossAtStop:positionNotional*riskRate,executionAllowed:false,mode:"PAPER_BUDGET_ONLY"};
}
export function planPaperEntry({symbol,side,price,quoteBudget,feePct=.1,slippagePct=.05,stopPct=1,targetR=2,capital=1000,bucket="tactical",maxRiskPct=1,existingExposure=0}={}) {
 const preview=computeTradePreview({side,price,quoteBudget,feePct,slippagePct,stopPct}),stop=Number(stopPct),reward=Number(targetR),exposure=Number(existingExposure);
 if(!Number.isFinite(reward)||reward<=0||reward>10||!Number.isFinite(exposure)||exposure<0)throw new TypeError("INVALID_PAPER_RISK_PLAN");
 const budget=calculatePositionBudget({capital,bucket,stopPct:stop,feePct,slippagePct,maxRiskPct}),remaining=Math.max(0,budget.positionNotional-exposure),direction=side==="buy"?1:-1,allowed=preview.grossNotional<=remaining+1e-9;
 return {symbol:String(symbol||"").toUpperCase(),side,allowed,reason:allowed?"WITHIN_VIRTUAL_RISK_BUDGET":"EXCEEDS_REMAINING_BUCKET_OR_RISK_BUDGET",preview,budget,existingExposure:exposure,remainingNotional:remaining,stopPrice:Number(price)*(1-direction*stop/100),targetPrice:Number(price)*(1+direction*stop*reward/100),executionAllowed:false,mode:"PAPER_ONLY"};
}
export function summarizePaperJournal(positions=[]) {
 if(!Array.isArray(positions))throw new TypeError("INVALID_PAPER_JOURNAL");
 const closed=positions.filter(p=>p&&p.mode==="PAPER_ONLY"&&p.status==="CLOSED"&&Number.isFinite(Number(p.netPnl))&&Number.isFinite(Number(p.closedAt))).sort((a,b)=>Number(a.closedAt)-Number(b.closedAt)),open=positions.filter(p=>p&&p.mode==="PAPER_ONLY"&&p.status==="OPEN");
 let realizedNetPnl=0,peak=0,maxDrawdownUsd=0,grossProfit=0,grossLoss=0,wins=0,losses=0;
 for(const p of closed){const pnl=Number(p.netPnl);realizedNetPnl+=pnl;if(pnl>0){wins++;grossProfit+=pnl}else if(pnl<0){losses++;grossLoss+=Math.abs(pnl)}peak=Math.max(peak,realizedNetPnl);maxDrawdownUsd=Math.max(maxDrawdownUsd,peak-realizedNetPnl)}
 return {closedTrades:closed.length,openTrades:open.length,wins,losses,realizedNetPnl,winRatePct:closed.length?wins/closed.length*100:null,expectancy:closed.length?realizedNetPnl/closed.length:null,profitFactor:grossLoss>0?grossProfit/grossLoss:null,maxDrawdownUsd,mode:"PAPER_ONLY"};
}
