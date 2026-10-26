const test = require("node:test");
const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { ORDER_KEY_RE, STORAGE_KEY, createManager } = require("../revenue/checkout-order-key.js");

function makeStorage(){
  const data=new Map();
  return {
    getItem:key=>data.has(key)?data.get(key):null,
    setItem:(key,value)=>data.set(key,String(value)),
    dump:()=>Object.fromEntries(data.entries())
  };
}
const input={product:"payment-path-mini-v1",name:"MIDAD",email:"operator@example.com",requirements:"Audit one public checkout route."};

test("generates API-compatible store UUID keys",async()=>{
  const manager=createManager({storage:makeStorage(),cryptoApi:webcrypto,now:()=>1000});
  const key=await manager.getKey(input);
  assert.match(key,ORDER_KEY_RE);
  assert.ok(key.startsWith("store-"));
});

test("reuses the same key while the invoice is still valid",async()=>{
  const storage=makeStorage();
  const manager=createManager({storage,cryptoApi:webcrypto,now:()=>1000});
  const first=await manager.getKey(input);
  assert.equal(await manager.getKey(input),first);
  assert.equal(await manager.rememberExpiry(input,first,"1970-01-01T00:02:00.000Z"),true);
  assert.equal(await manager.getKey(input),first);
});

test("rotates the idempotency key after invoice expiry",async()=>{
  const storage=makeStorage();
  let now=1000;
  const manager=createManager({storage,cryptoApi:webcrypto,now:()=>now});
  const first=await manager.getKey(input);
  await manager.rememberExpiry(input,first,"1970-01-01T00:02:00.000Z");
  now=120001;
  const second=await manager.getKey(input);
  assert.match(second,ORDER_KEY_RE);
  assert.notEqual(second,first);
  assert.equal(await manager.getKey(input),second);
});

test("different briefs use different keys and persisted data does not contain customer PII",async()=>{
  const storage=makeStorage();
  const manager=createManager({storage,cryptoApi:webcrypto,now:()=>1000});
  const first=await manager.getKey(input);
  const second=await manager.getKey({...input,requirements:"A different service brief."});
  assert.notEqual(first,second);
  const serialized=JSON.stringify(storage.dump());
  assert.ok(serialized.includes(STORAGE_KEY));
  assert.ok(!serialized.includes("operator@example.com"));
  assert.ok(!serialized.includes("Audit one public checkout route."));
});

test("live Revenue Forge loads and uses the key contract helper",()=>{
  const html=fs.readFileSync(path.join(__dirname,"..","revenue-forge.html"),"utf8");
  assert.ok(html.includes('./revenue/checkout-order-key.js'));
  assert.ok(html.includes("checkoutOrderKeyManager.getKey(orderKeyInput)"));
  assert.ok(html.includes("checkoutOrderKeyManager.rememberExpiry"));
});
