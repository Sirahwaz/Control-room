import test from "node:test";
import assert from "node:assert/strict";
import { fetchPublicWalletFingerprint } from "./mimic-client.mjs";

const WALLET = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const HASH = n => "0x" + String(n).padStart(64, "0");
const config = {
  supabaseUrl: "https://froegigfmpmvtecztfbf.supabase.co",
  publishableKey: "sb_publishable_test_public_key",
  anonJwt: "header.eyJyb2xlIjoiYW5vbiJ9.signature"
};
const profile = (overrides={}) => ({
  provider: "etherscan",
  api_version: "v2",
  action: "profile",
  chainid: "1",
  address: WALLET,
  ok: true,
  profile: {
    recent_transactions: Array.from({length: 12}, (_,i) => ({
      hash: HASH(i+1), from: WALLET, to: OTHER, timeStamp: String(1794130000+i*60),
      input: "0x", isError: "0"
    })),
    token_transfers: []
  },
  upstream: {balance_ok:true, txlist_ok:true, tokentx_ok:true},
  ...overrides
});
const response = (body, status=200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body
});

test("rejects invalid wallet and chain before any network request", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return response(profile()); };
  await assert.rejects(() => fetchPublicWalletFingerprint({
    walletAddress:"not-an-address", chainId:"1", config, fetchImpl
  }), /INVALID_EVM_WALLET_ADDRESS/);
  await assert.rejects(() => fetchPublicWalletFingerprint({
    walletAddress:WALLET, chainId:"solana", config, fetchImpl
  }), /INVALID_EXPECTED_CHAIN_ID/);
  assert.equal(calls, 0);
});

test("uses the existing v42 profile endpoint with only public client credentials", async () => {
  let request;
  const result = await fetchPublicWalletFingerprint({
    walletAddress:WALLET, chainId:"1", config, observedAt:1794139999000,
    fetchImpl: async (url, init) => { request = {url, init}; return response(profile()); }
  });
  assert.equal(request.url, "https://froegigfmpmvtecztfbf.supabase.co/functions/v1/midad_chain_intelligence");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.headers.apikey, config.publishableKey);
  assert.equal(request.init.headers.authorization, "Bearer "+config.anonJwt);
  const body = JSON.parse(request.init.body);
  assert.deepEqual(
    {action:body.action,address:body.address,chainid:body.chainid,page:body.page,offset:body.offset},
    {action:"profile",address:WALLET,chainid:"1",page:1,offset:50}
  );
  assert.equal(result.status, "VERIFIED");
  assert.equal(result.source, "midad_chain_intelligence_v42");
  assert.equal(result.fingerprint.sample.validUniqueTransactions, 12);
  assert.equal(result.fingerprint.execution.executionAllowed, false);
  assert.equal("recent_transactions" in result.fingerprint, false);
});

test("accepts a failed token-transfer feed only as an explicit warning", async () => {
  const result = await fetchPublicWalletFingerprint({
    walletAddress:WALLET, chainId:"1", config,
    fetchImpl: async () => response(profile({upstream:{balance_ok:true,txlist_ok:true,tokentx_ok:false}}))
  });
  assert.ok(result.warnings.includes("TOKEN_TRANSFER_FEED_UNAVAILABLE"));
  assert.equal(result.fingerprint.sample.uniqueTokenContracts, 0);
});

test("fails closed when the normal transaction feed is not verified", async () => {
  await assert.rejects(() => fetchPublicWalletFingerprint({
    walletAddress:WALLET, chainId:"1", config,
    fetchImpl: async () => response(profile({upstream:{balance_ok:true,txlist_ok:false,tokentx_ok:true}}))
  }), /PUBLIC_TRANSACTION_FEED_NOT_VERIFIED/);
});

test("requires HTTPS Supabase host and both non-secret public credentials", async () => {
  await assert.rejects(() => fetchPublicWalletFingerprint({
    walletAddress:WALLET, chainId:"1", config:{...config,supabaseUrl:"http://example.com"},
    fetchImpl: async () => response(profile())
  }), /INVALID_SUPABASE_URL/);
  await assert.rejects(() => fetchPublicWalletFingerprint({
    walletAddress:WALLET, chainId:"1", config:{...config,anonJwt:""},
    fetchImpl: async () => response(profile())
  }), /PUBLIC_ANON_JWT_REQUIRED/);
  await assert.rejects(() => fetchPublicWalletFingerprint({
    walletAddress:WALLET, chainId:"1", config:{...config,publishableKey:""},
    fetchImpl: async () => response(profile())
  }), /PUBLISHABLE_KEY_REQUIRED/);
  await assert.rejects(() => fetchPublicWalletFingerprint({
    walletAddress:WALLET, chainId:"1",
    config:{...config,anonJwt:"header.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature"},
    fetchImpl: async () => response(profile())
  }), /PUBLIC_ANON_JWT_REQUIRED/);
});

test("reports HTTP failures without leaking response bodies", async () => {
  await assert.rejects(() => fetchPublicWalletFingerprint({
    walletAddress:WALLET, chainId:"1", config,
    fetchImpl: async () => response({error:"internal_secret_text"}, 429)
  }), error => {
    assert.match(error.message, /CHAIN_INTELLIGENCE_HTTP_429/);
    assert.equal(error.message.includes("internal_secret_text"), false);
    return true;
  });
});
