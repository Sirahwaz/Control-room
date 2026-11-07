import test from "node:test";
import assert from "node:assert/strict";
import { fingerprintPublicWalletActivity, compareWalletBehaviorFingerprints } from "./mimic-intelligence.mjs";

const WALLET = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const CONTRACT = "0x3333333333333333333333333333333333333333";
const HASH = n => "0x" + String(n).padStart(64, "0");
const NOW = Date.parse("2026-11-08T12:00:00.000Z");

function tx(n, {from=WALLET,to=OTHER,timeStamp=1794139200,input="0x",isError="0"}={}) {
  return {hash:HASH(n),from,to,timeStamp:String(timeStamp),input,isError};
}

test("requires valid public EVM wallet and numeric chain ID", () => {
  assert.throws(() => fingerprintPublicWalletActivity({walletAddress:"not-an-address",chainId:"1"}), /INVALID_EVM/);
  assert.throws(() => fingerprintPublicWalletActivity({walletAddress:WALLET,chainId:"solana"}), /INVALID_CHAIN/);
});

test("computes directional, cadence and counterpart metrics from successful transactions", () => {
  const rows = [
    tx(1,{from:WALLET,to:OTHER,timeStamp:1794130000,input:"0x1234"}),
    tx(2,{from:OTHER,to:WALLET,timeStamp:1794130300}),
    tx(3,{from:WALLET,to:CONTRACT,timeStamp:1794130600,input:"0xabcdef"})
  ];
  const fp = fingerprintPublicWalletActivity({walletAddress:WALLET,chainId:"1",transactions:rows,observedAt:NOW});
  assert.equal(fp.metrics.outgoingTransactions,2);
  assert.equal(fp.metrics.incomingTransactions,1);
  assert.equal(fp.metrics.uniqueCounterparties,2);
  assert.ok(Math.abs(fp.metrics.contractInteractionRate-(2/3))<0.000001);
  assert.equal(fp.metrics.medianIntertransactionSeconds,300);
  assert.equal(fp.execution.executionAllowed,false);
});

test("deduplicates hashes and separates failed transactions from successful activity", () => {
  const good = tx(4,{timeStamp:1794130000});
  const failed = tx(5,{timeStamp:1794130100,isError:"1"});
  const fp = fingerprintPublicWalletActivity({walletAddress:WALLET,chainId:"1",transactions:[good,good,failed],observedAt:NOW});
  assert.equal(fp.sample.validUniqueTransactions,2);
  assert.equal(fp.sample.successfulTransactions,1);
  assert.equal(fp.sample.failedTransactions,1);
  assert.equal(fp.metrics.outgoingTransactions,1);
});

test("ignores unrelated or malformed public transactions", () => {
  const fp = fingerprintPublicWalletActivity({walletAddress:WALLET,chainId:"1",transactions:[
    tx(6,{from:OTHER,to:CONTRACT}),
    {hash:"bad",from:WALLET,to:OTHER,timeStamp:"not-time"}
  ],observedAt:NOW});
  assert.equal(fp.sample.validUniqueTransactions,0);
  assert.deepEqual(fp.observedTraits,["INSUFFICIENT_SAMPLE"]);
});

test("counts token contract diversity without disclosing token amounts", () => {
  const tokens = ["0x4444444444444444444444444444444444444444","0x5555555555555555555555555555555555555555","0x6666666666666666666666666666666666666666"];
  const transfers = tokens.map((contractAddress,i)=>({contractAddress,from:WALLET,to:OTHER,tokenSymbol:"T"+i,value:"999999999999999999999999"}));
  const fp = fingerprintPublicWalletActivity({walletAddress:WALLET,chainId:"1",tokenTransfers:transfers,observedAt:NOW});
  assert.equal(fp.sample.tokenTransfers,3);
  assert.equal(fp.sample.uniqueTokenContracts,3);
  assert.ok(fp.observedTraits.includes("TOKEN_TRANSFER_DIVERSE"));
  assert.equal(JSON.stringify(fp).includes("999999999999999999999999"),false);
});

test("caps the transaction sample and rejects invalid sample limits", () => {
  const transactions = Array.from({length:20},(_,i)=>tx(i+10,{timeStamp:1794130000+i}));
  const fp = fingerprintPublicWalletActivity({walletAddress:WALLET,chainId:"1",transactions,maxRecords:5,observedAt:NOW});
  assert.equal(fp.sample.receivedTransactions,20);
  assert.equal(fp.sample.cappedTransactions,5);
  assert.equal(fp.sample.validUniqueTransactions,5);
  assert.throws(() => fingerprintPublicWalletActivity({walletAddress:WALLET,chainId:"1",maxRecords:501}), /INVALID_SAMPLE_LIMIT/);
});

test("fingerprint comparison is bounded and explicitly not identity or return prediction", () => {
  const a = fingerprintPublicWalletActivity({walletAddress:WALLET,chainId:"1",transactions:[tx(30),tx(31,{from:OTHER,to:WALLET,timeStamp:1794130300})],observedAt:NOW});
  const b = fingerprintPublicWalletActivity({walletAddress:OTHER,chainId:"1",transactions:[tx(32,{from:OTHER,to:WALLET}),tx(33,{from:WALLET,to:OTHER,timeStamp:1794130300})],observedAt:NOW});
  const comparison = compareWalletBehaviorFingerprints(a,b);
  assert.ok(comparison.similarityIndex>=0 && comparison.similarityIndex<=100);
  assert.equal(comparison.copyTradingSuggested,false);
  assert.equal(comparison.executionAllowed,false);
  assert.throws(() => compareWalletBehaviorFingerprints(a,{...b,chainId:"137"}), /INCOMPATIBLE/);
});
