export function normalizeTicker(raw) {
  if (!raw || typeof raw !== "object") return null;
  const symbol = String(raw.s || raw.symbol || "").toUpperCase();
  const last = Number(raw.c ?? raw.lastPrice ?? raw.last);
  const changePct = Number(raw.P ?? raw.priceChangePercent ?? raw.changePct);
  const quoteVolume = Number(raw.q ?? raw.quoteVolume ?? raw.turnover24h ?? 0);
  const timestamp = Number(raw.E ?? raw.ts ?? Date.now());
  if (!/^[A-Z0-9]{4,24}$/.test(symbol) || !Number.isFinite(last) || last <= 0 || !Number.isFinite(changePct)) return null;
  return { symbol, last, changePct, quoteVolume: Number.isFinite(quoteVolume) && quoteVolume >= 0 ? quoteVolume : 0, timestamp, provider: "binance" };
}

export function normalizeCoinExTicker(raw, expectedMarket = null, receivedAt = Date.now()) {
  if (!raw || typeof raw !== "object") return null;
  const symbol = String(raw.market || "").toUpperCase();
  const expected = expectedMarket == null ? null : String(expectedMarket).toUpperCase();
  const last = Number(raw.last), open = Number(raw.open);
  const quoteVolume = Number(raw.value ?? 0);
  const timestamp = Number(raw.ts ?? receivedAt);
  if (!/^[A-Z0-9]{4,24}$/.test(symbol) || (expected && symbol !== expected) || !Number.isFinite(last) || last <= 0 || !Number.isFinite(open) || open <= 0 || !Number.isFinite(quoteVolume) || quoteVolume < 0 || !Number.isFinite(timestamp) || timestamp <= 0) return null;
  return { symbol, last, changePct: ((last / open) - 1) * 100, quoteVolume, timestamp, provider: "coinex" };
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


export function createPaperPosition({ id, symbol, side, quantity, entryPrice, feePct = 0.1, slippagePct = 0.05, openedAt = Date.now() } = {}) {
  const q=Number(quantity), p=Number(entryPrice), fee=Number(feePct), slip=Number(slippagePct), opened=Number(openedAt);
  const pair=String(symbol||"").toUpperCase();
  if (!id || !/^[A-Z0-9]{4,24}$/.test(pair) || !["buy","sell"].includes(String(side)) || ![q,p,fee,slip,opened].every(Number.isFinite) || q<=0 || p<=0 || fee<0 || fee>5 || slip<0 || slip>20 || opened<=0) throw new TypeError("INVALID_PAPER_POSITION");
  return { id:String(id), symbol:pair, side, quantity:q, entryPrice:p, feePct:fee, slippagePct:slip, openedAt:opened, status:"OPEN", mode:"PAPER_ONLY" };
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
