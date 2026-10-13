import fs from "node:fs";
import assert from "node:assert/strict";

const checkout = fs.readFileSync("supabase/functions/midad_public_checkout/index.ts", "utf8");
const verifier = fs.readFileSync("supabase/functions/midad_payment_verifier/index.ts", "utf8");
const migration = fs.readFileSync("supabase/migrations/20261013000100_public_checkout_idempotency.sql", "utf8");
const forge = fs.readFileSync("revenue-forge.html", "utf8");
const radar = fs.readFileSync("supabase/functions/midad_fast_cash_radar/index.ts", "utf8");
const baseMonitor = fs.readFileSync("supabase/functions/midad_base_usdc_monitor/index.ts", "utf8");
const securityMigration = fs.readFileSync("supabase/migrations/20261013000200_security_perf_hardening.sql", "utf8");
const ugigLifecycle = fs.readFileSync("supabase/functions/midad_ugig_lifecycle/index.ts", "utf8");

assert.match(checkout, /function publicPayment\(intent:any\)/, "public payment projection must exist");
for (const field of ["id:intent.id", "status:intent.status", "reconciliation_status:intent.reconciliation_status", "quoted_crypto_amount:intent.quoted_crypto_amount", "wallet_address:intent.wallet_address"]) {
  assert.ok(checkout.includes(field), "public payment projection missing " + field);
}
assert.match(checkout, /const payment=publicPayment\(existing\);[\s\S]*return json\(\{ok:true,reused:true,payment,payment_intent:payment,product:p,receiving,instructions:reuseInstructions\(payment\)\}\)/, "reused invoice must satisfy UI contract without raw metadata");
assert.match(checkout, /monitor\?\.status===["']VERIFIED["']/, "checkout must require VERIFIED monitor state");
assert.match(checkout, /Number\(monitor\?\.error_count\|\|0\)===0/, "checkout must reject monitor errors");
assert.match(checkout, /tokenAccounts>0/, "checkout must require a token account");
assert.match(checkout, /scanAgeMs<=10\*60_000/, "checkout must require a fresh monitor scan");
assert.match(checkout, /reason:["']RECEIVING_ROUTE_NOT_READY["']/, "unready route must fail closed");
const gate = checkout.indexOf("const target=await chooseWallet()");
const intentInsert = checkout.indexOf('db.from("midad_payment_intents").insert');
assert.ok(gate >= 0 && intentInsert > gate, "receive readiness gate must precede Payment Intent creation");
assert.match(forge, /if\(!r\.ok\|\|!d\.ok\) throw new Error\(d\.message\|\|d\.error\|\|"checkout_failed"\);/, "UI must prefer actionable server message");
assert.match(forge, /لا ترسل دفعة ثانية/, "UI must warn against duplicate payment during reconciliation");
assert.match(verifier, /const amountOk=expectedAmount!==null&&expectedAmount>0&&observedAmount!==null&&observedAmount>=expectedAmount;/, "verification must reject missing/underpaid amounts and remove 0.1% tolerance");
assert.match(verifier, /const assetOk=Boolean\(intent\.settlement_asset&&latest\.asset&&/, "verification must require explicit matching asset");
assert.match(verifier, /const networkOk=Boolean\(intent\.network&&latest\.network&&/, "verification must require explicit matching network");
assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS midad_payment_intents_public_order_key_active_uidx/, "active order-key idempotency index must exist");
assert.match(migration, /status IN \('created','quoted','detected','verified','paid','reconciled'\)/, "idempotency index must cover active payment states only");

assert.match(radar, /version:9/, "revenue radar version 9 must be present");
for (const provider of ["basebounty", "superteam", "laborx", "airdropalert"]) {
  assert.ok(radar.includes('"'+provider+'"'), "new revenue source missing: "+provider);
}
assert.match(radar, /workerPayoutUsdc/, "BaseBounty must use explicit after-fee USDC reward field");
assert.match(radar, /reward_units_verified:false/, "Superteam raw token reward units must not be converted to USD without evidence");
assert.match(radar, /individual_gig_crypto_terms_verified:false/, "LaborX listing discovery must not presume each gig accepts crypto");
assert.match(radar, /research_only:true/, "airdrop observations must be research-only");
assert.ok(radar.includes("Boolean(c.crypto_payout_verified)&&Boolean(c.payout_evidence_verified)"), "automation must require payout and crypto evidence");
assert.ok(radar.includes('c.claim_mode!=="wallet_signature"'), "wallet-signature claims must remain outside autonomous execution");
assert.ok(radar.includes('const status=automationAllowed?"money_candidate":"human_review"'), "unverified payout opportunities must be held for review");

assert.ok(baseMonitor.includes('const RPC_POOL=[BASE_RPC,"https://base-rpc.publicnode.com","https://public.1rpc.io/base"]'), "Base monitor must have public RPC fallbacks");
assert.ok(baseMonitor.includes('rpc("eth_chainId",[])'), "Base monitor must verify network identity before scanning");
assert.ok(baseMonitor.includes("actualChainId!==CHAIN_ID"), "Base monitor must fail closed on wrong chain");
assert.ok(baseMonitor.includes('status:"DEGRADED"'), "Base monitor must persist degraded state after scan failures");
assert.ok(baseMonitor.includes("base_rpc_all_providers_failed"), "Base monitor must expose aggregate provider failure without secrets");
assert.ok(baseMonitor.includes("failure_stage:\"base_usdc_monitor\""), "Base monitor must store durable error context");
assert.ok(securityMigration.includes("SET search_path = pg_catalog, public"), "wallet monitor trigger must have a pinned search_path");
for (const indexName of ["midad_factory_artifacts_project_id_idx", "midad_factory_artifacts_run_id_idx", "midad_factory_projects_owner_user_id_idx", "midad_factory_runs_project_id_idx", "midad_platform_account_events_run_id_idx"]) {
  assert.ok(securityMigration.includes(indexName), "missing staged foreign-key performance index: "+indexName);
}
assert.ok(ugigLifecycle.includes("version:7"), "uGig lifecycle should use guarded version 7");
assert.ok(ugigLifecycle.includes("const cryptoOnlyReceiveBridgeAvailable=false"), "uGig USD invoices must remain blocked until a crypto receipt bridge exists");
assert.ok(ugigLifecycle.includes("crypto_only_onchain_invoice_bridge_not_implemented"), "uGig block reason must identify missing on-chain invoice bridge");
assert.ok(ugigLifecycle.indexOf("cryptoOnlyReceiveBridgeAvailable") < ugigLifecycle.indexOf('action:"invoice_create"'), "uGig crypto-only gate must execute before invoice creation");
assert.ok(ugigLifecycle.includes("USD/CoinPay invoice status is not accepted as on-chain income"), "uGig must not treat off-chain invoice status as wallet receipt proof");
assert.ok(ugigLifecycle.includes('state:j.state,blocker_code:"CRYPTO_PAYOUT_NOT_VERIFIED"'), "uGig guard must preserve current job state rather than orphaning a live job");
assert.ok(ugigLifecycle.includes("const alreadyGated=j.blocker_code"), "uGig guard must avoid repeated blocker writes every cron cycle");

assert.ok(checkout.includes('.eq("asset","USDC").in("network",["solana","base"])'), "checkout should consider only crypto receive routes that support verified Solana/Base networks");
assert.ok(checkout.includes('chainId===8453&&tokenContract===BASE_USDC_CONTRACT.toLowerCase()'), "Base route must be verified against mainnet chain ID and official USDC contract");
assert.ok(checkout.includes('const BASE_USDC_CONTRACT="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"'), "Base USDC contract must be canonical");
assert.ok(checkout.includes("network:target.route.network"), "intent/order receiving network must follow verified route");
assert.ok(checkout.includes('checkoutNetwork==="base"?"Base mainnet":"Solana"'), "instructions must name the selected verified network");
assert.ok(forge.includes("USDC على شبكة استقبال موثّقة"), "Revenue Forge should not advertise Solana-only checkout");
assert.ok(forge.includes('String(d.payment.network||"").toLowerCase()'), "Revenue Forge must display the chosen verified network");
console.log("REVENUE_FORGE_CHECKOUT_CONTRACT_OK");
