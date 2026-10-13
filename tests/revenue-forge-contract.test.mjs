import fs from "node:fs";
import assert from "node:assert/strict";

const checkout = fs.readFileSync("supabase/functions/midad_public_checkout/index.ts", "utf8");
const verifier = fs.readFileSync("supabase/functions/midad_payment_verifier/index.ts", "utf8");
const migration = fs.readFileSync("supabase/migrations/20261013000100_public_checkout_idempotency.sql", "utf8");
const forge = fs.readFileSync("revenue-forge.html", "utf8");

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
console.log("REVENUE_FORGE_CHECKOUT_CONTRACT_OK");
