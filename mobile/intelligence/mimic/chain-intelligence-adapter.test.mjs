import test from "node:test";
import assert from "node:assert/strict";
import { adaptChainIntelligenceProfile } from "./chain-intelligence-adapter.mjs";

const WALLET = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const CONTRACT = "0x3333333333333333333333333333333333333333";
const HASH = n => "0x" + String(n).padStart(64, "0");
const NOW = Date.parse("2026-11-08T12:00:00.000Z");
const tx = (n, extra={}) => ({hash:HASH(n),from:WALLET,to:OTHER,timeStamp:"1794130000",input:"0x",isError:"0",...extra});
function payload(overrides={}) {
  return {
    provider:"etherscan",
    api_version:"v2",
    action:"profile",
    chainid:"1",
    address:WALLET,
    ok:true,
    upstream:{balance_ok:true,txlist_ok:true,tokentx_ok:true},
    profile:{recent_transactions:[tx(1),tx(2,{from:OTHER,to:WALLET}),tx(3,{to:CONTRACT,input:"0x1234"})],token_transfers:[]},
    ...overrides
  };
}

test("adapts the existing Etherscan V2 profile response into a bounded fingerprint", () => {
  const result = adaptChainIntelligenceProfile(payload(),{walletAddress:WALLET,chainId:"1",observedAt:NOW});
  assert.equal(result.status,"VERIFIED");
  assert.equal(result.source,"midad_chain_intelligence_v42");
  assert.equal(result.fingerprint.sample.validUniqueTransactions,3);
  assert.equal(result.fingerprint.metrics.incomingTransactions,1);
  assert.equal(result.fingerprint.metrics.outgoingTransactions,2);
  assert.equal(result.fingerprint.execution.executionAllowed,false);
  assert.equal("recent_transactions" in result,false);
});

test("rejects a mismatched address or chain identifier", () => {
  assert.throws(()=>adaptChainIntelligenceProfile(payload(),{walletAddress:OTHER,chainId:"1"}),/WALLET_ADDRESS_MISMATCH/);
  assert.throws(()=>adaptChainIntelligenceProfile(payload(),{walletAddress:WALLET,chainId:"137"}),/CHAIN_ID_MISMATCH/);
});

test("rejects unsupported provider or non-profile action", () => {
  assert.throws(()=>adaptChainIntelligenceProfile(payload({provider:"unknown"}),{walletAddress:WALLET,chainId:"1"}),/UNSUPPORTED_CHAIN/);
  assert.throws(()=>adaptChainIntelligenceProfile(payload({action:"txlist"}),{walletAddress:WALLET,chainId:"1"}),/PROFILE_REQUIRED/);
});

test("blocks partial or failed transaction feed while accepting no balance dependency", () => {
  assert.throws(()=>adaptChainIntelligenceProfile(payload({upstream:{balance_ok:false,txlist_ok:false,tokentx_ok:true}}),{walletAddress:WALLET,chainId:"1"}),/PUBLIC_TRANSACTION_FEED/);
});

test("preserves partial token-feed failure as a warning, not a false positive", () => {
  const result = adaptChainIntelligenceProfile(payload({upstream:{balance_ok:true,txlist_ok:true,tokentx_ok:false}}),{walletAddress:WALLET,chainId:"1",observedAt:NOW});
  assert.ok(result.warnings.includes("TOKEN_TRANSFER_FEED_UNAVAILABLE"));
  assert.equal(result.fingerprint.sample.uniqueTokenContracts,0);
});

test("rejects incomplete public profile payload", () => {
  assert.throws(()=>adaptChainIntelligenceProfile(payload({profile:{}}),{walletAddress:WALLET,chainId:"1"}),/RECENT_TRANSACTIONS_MISSING/);
  assert.throws(()=>adaptChainIntelligenceProfile(null,{walletAddress:WALLET,chainId:"1"}),/INVALID_CHAIN_INTELLIGENCE/);
});
