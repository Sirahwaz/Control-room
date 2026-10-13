const fs = require("node:fs");
const assert = require("node:assert/strict");

const checkout = fs.readFileSync("supabase/functions/midad_public_checkout/index.ts", "utf8");
const forge = fs.readFileSync("revenue-forge.html", "utf8");

assert.match(checkout, /function publicPayment\(intent:any\)/, "public payment projection must exist");
for (const field of ["id:intent.id", "status:intent.status", "reconciliation_status:intent.reconciliation_status", "quoted_crypto_amount:intent.quoted_crypto_amount", "wallet_address:intent.wallet_address"]) {
  assert.ok(checkout.includes(field), "public payment projection missing " + field);
}
assert.match(checkout, /const payment=publicPayment\(existing\);[\s\S]*return json\(\{ok:true,reused:true,payment,payment_intent:payment,product:p,receiving,instructions:reuseInstructions\(payment\)\}\)/, "reused invoice must satisfy the public UI contract without exposing raw metadata");
assert.match(checkout, /monitor\?\.status===["']VERIFIED["']/, "checkout must require VERIFIED monitor state");
assert.match(checkout, /Number\(monitor\?\.error_count\|\|0\)===0/, "checkout must reject monitor errors");
assert.match(checkout, /tokenAccounts>0/, "checkout must require a token account");
assert.match(checkout, /scanAgeMs<=10\*60_000/, "checkout must require a fresh monitor scan");
assert.match(checkout, /reason:["']RECEIVING_ROUTE_NOT_READY["']/, "unready route must fail closed with a stable reason");
const gate = checkout.indexOf("const target=await chooseWallet()");
const intentInsert = checkout.indexOf('db.from("midad_payment_intents").insert');
assert.ok(gate >= 0 && intentInsert > gate, "receive readiness gate must precede Payment Intent creation");
assert.match(forge, /if\(!r\.ok\|\|!d\.ok\) throw new Error\(d\.message\|\|d\.error\|\|"checkout_failed"\);/, "UI must prefer actionable server message over error code");
assert.match(forge, /لا ترسل دفعة ثانية/, "UI must warn against duplicate payment during reconciliation");
console.log("REVENUE_FORGE_CHECKOUT_CONTRACT_OK");
