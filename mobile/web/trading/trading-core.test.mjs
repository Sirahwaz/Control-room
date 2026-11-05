import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTicker, isFresh, computeTradePreview, classifyPumpSignal, createPaperPosition, markPaperPosition, closePaperPosition } from "./trading-core.mjs";

test("normalizes a valid Binance ticker and rejects malformed values",()=>{
  const x=normalizeTicker({s:"BTCUSDT",c:"67000",P:"2.5",q:"1000000",E:Date.now()});
  assert.equal(x.symbol,"BTCUSDT");
  assert.equal(x.last,67000);
  assert.equal(x.changePct,2.5);
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
