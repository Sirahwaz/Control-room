#!/usr/bin/env node
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const source=fs.readFileSync(new URL("../web/morph-engine.js", import.meta.url),"utf8");
const sandbox={
  window:{},
  document:{querySelector(){return null;},addEventListener(){}},
  localStorage:{setItem(){}},
  CustomEvent: class { constructor(type,init){this.type=type;this.detail=init?.detail;} },
  fetch: async()=>({ok:false,status:503})
};
vm.runInNewContext(source,sandbox,{filename:"morph-engine.js"});
const engine=sandbox.window.MidadMorph;
assert.ok(engine && typeof engine.planMission==="function");

const revenue=engine.planMission("اريد طريقة لزيادة الدخل وبناء فرصة ربح من MIDAD");
assert.equal(revenue.primary,"revenue");
assert.ok(revenue.stations.some(x=>x.id==="revenue"));

const mining=engine.planMission("افحص هشريت الماينرات وحالة ViaBTC worker");
assert.equal(mining.primary,"mining");
assert.ok(mining.stations.some(x=>x.id==="mining"));

const trading=engine.planMission("حلل BTC market risk قبل أي تداول");
assert.equal(trading.primary,"trading");
assert.equal(trading.risk,"HIGH");

const generic=engine.planMission("شيء جديد غير معروف");
assert.equal(generic.primary,"general");
assert.equal(generic.mode,"MISSION_CAPSULE");

console.log("MIDAD Neural Morph smoke: PASS");
