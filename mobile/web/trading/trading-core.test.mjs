import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTicker, normalizeCoinExTicker, isFresh, computeTradePreview, classifyPumpSignal, createPaperPosition, markPaperPosition, closePaperPosition, analyzeTrend, evaluateCandidate, allocateCapitalBuckets, calculatePositionBudget } from "./trading-core.mjs";

test("normalizes a valid Binance ticker and rejects malformed values",()=>{
  const x=normalizeTicker({s:"BTCUSDT",c:"67000",P:"2.5",q:"1000000",E:Date.now()});
  assert.equal(x.symbol,"BTCUSDT");
  assert.equal(x.last,67000);
  assert.equal(x.changePct,2.5);
  assert.equal(x.provider,"binance");
  assert.equal(normalizeTicker({s:"BTCUSDT",c:"NaN"}),null);
});

test("marks stale market data as not live",()=>{
  assert.equal(isFresh(Date.now(),5000),true);
  assert.equal(isFresh(Date.now()-10000,5000),false);
});

test("trade preview includes fees and never authorizes execution",()=>{
  const p=computeTradePreview({side:"buy",price:100,quoteBudget:50,feePct:0.1,slippagePct:0.2,stopPct:1});
  assert.equal(p.grossNotional,50);
  assert.equal(p.executionAllowed,false);
  assert.ok(p.estimatedCost>0);
});

test("pump classifier requires independent market confirmation and labels risk",()=>{
  const p=classifyPumpSignal({change5mPct:8,volumeRatio:4,liquidityUsd:50000,sourceCount:2,holderConcentrationPct:45});
  assert.equal(p.state,"WATCH");
  assert.ok(p.riskFlags.includes("HIGH_HOLDER_CONCENTRATION"));
  const weak=classifyPumpSignal({change5mPct:8,volumeRatio:1,liquidityUsd:1000,sourceCount:1,holderConcentrationPct:90});
  assert.equal(weak.state,"REJECT");
});

test("paper position marks net PnL after round-trip fees and slippage",()=>{
  const position=createPaperPosition({id:"p1",symbol:"BTCUSDT",side:"buy",quantity:0.01,entryPrice:100000,feePct:0.1,slippagePct:0.05,openedAt:1000});
  const marked=markPaperPosition(position,101000);
  assert.equal(marked.grossPnl,10);
  assert.ok(marked.totalCosts>0);
  assert.ok(marked.netPnl<marked.grossPnl);
  const closed=closePaperPosition(position,101000,2000);
  assert.equal(closed.status,"CLOSED");
  assert.equal(closed.closedAt,2000);
  assert.equal(closed.netPnl,marked.netPnl);
});

test("paper position rejects invalid quantity, price and side",()=>{
  assert.throws(()=>createPaperPosition({id:"p2",symbol:"BTCUSDT",side:"buy",quantity:0,entryPrice:100}),/INVALID_PAPER_POSITION/);
  assert.throws(()=>createPaperPosition({id:"p3",symbol:"BTCUSDT",side:"short",quantity:1,entryPrice:100}),/INVALID_PAPER_POSITION/);
});

test("normalizes CoinEx REST ticker with explicit provider provenance",()=>{
  const x=normalizeCoinExTicker({market:"BTCUSDT",last:"101000",open:"100000",value:"2500000",ts:1700000000000});
  assert.equal(x.symbol,"BTCUSDT");
  assert.equal(x.last,101000);
  assert.ok(Math.abs(x.changePct-1)<1e-9);
  assert.equal(x.quoteVolume,2500000);
  assert.equal(x.provider,"coinex");
  assert.equal(x.timestamp,1700000000000);
});

test("rejects malformed CoinEx ticker values and market mismatches",()=>{
  assert.equal(normalizeCoinExTicker({market:"ETHUSDT",last:"100",open:"90",value:"1"},"BTCUSDT"),null);
  assert.equal(normalizeCoinExTicker({market:"BTCUSDT",last:"NaN",open:"100",value:"1"}),null);
  assert.equal(normalizeCoinExTicker({market:"BTCUSDT",last:"100",open:"0",value:"1"}),null);
});

test("analyzes timestamped candle trends and rejects stale or sparse histories",()=>{
  const now=3_600_000;
  const candles=Array.from({length:61},(_,i)=>({openTime:now-(61-i)*60_000,closeTime:now-(60-i)*60_000-1,open:100+i,high:102+i,low:99+i,close:101+i,volume:10+i,quoteVolume:1000+i*100}));
  const trend=analyzeTrend(candles,{now});
  assert.equal(trend.state,"VALID");
  assert.ok(trend.horizons["5m"].returnPct>0);
  assert.ok(trend.horizons["15m"].returnPct>0);
  assert.ok(trend.horizons["1h"].returnPct>0);
  assert.equal(analyzeTrend(candles.slice(-3),{now}).state,"INSUFFICIENT_HISTORY");
  assert.equal(analyzeTrend(candles,{now:now+600_000}).state,"STALE");
});

test("candidate intelligence requires multi-source liquidity and contract evidence",()=>{
  const good=evaluateCandidate({trend:{state:"VALID",horizons:{"5m":{returnPct:6,relativeVolume:3},"15m":{returnPct:9,relativeVolume:2.5},"1h":{returnPct:12,relativeVolume:2}}},sourceCount:3,liquidityUsd:250000,spreadPct:0.3,holderConcentrationPct:20,contractRisk:"LOW",exitSimulationPassed:true});
  assert.equal(good.state,"QUALIFIED_FOR_PAPER");
  assert.equal(good.executionAllowed,false);
  const unsafe=evaluateCandidate({trend:{state:"VALID",horizons:{"5m":{returnPct:12,relativeVolume:5},"15m":{returnPct:20,relativeVolume:4},"1h":{returnPct:30,relativeVolume:3}}},sourceCount:1,liquidityUsd:500,spreadPct:8,holderConcentrationPct:95,contractRisk:"CRITICAL",exitSimulationPassed:false});
  assert.equal(unsafe.state,"REJECT");
  assert.ok(unsafe.riskFlags.length>=4);
});

test("capital buckets isolate protected reserve and position risk budget",()=>{
  const buckets=allocateCapitalBuckets(1000);
  assert.equal(buckets.reserve,450);
  assert.equal(buckets.total,1000);
  assert.equal(buckets.deployable,550);
  assert.equal(buckets.executionAllowed,false);
  const budget=calculatePositionBudget({capital:1000,bucket:"tactical",stopPct:5,maxRiskPct:1});
  assert.equal(budget.riskBudget,10);
  assert.equal(budget.positionNotional,200);
  assert.equal(budget.executionAllowed,false);
  assert.throws(()=>calculatePositionBudget({capital:1000,bucket:"reserve",stopPct:5,maxRiskPct:1}),/PROTECTED_BUCKET/);
});
