import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTicker, isFresh, computeTradePreview, classifyPumpSignal } from "./trading-core.js";

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
