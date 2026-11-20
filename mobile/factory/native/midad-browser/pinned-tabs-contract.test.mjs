import test from "node:test";
import assert from "node:assert/strict";
import { pinTab, unpinTab, canCloseTab, orderTabIds, restorePinnedState, serializePinnedState } from "./pinned-tabs-contract.mjs";

test("pinning and unpinning is idempotent and preserves stable tab IDs",()=>{
  assert.deepEqual(pinTab(["a","b"],"b"),["a","b"]);
  assert.deepEqual(unpinTab(["a","b"],"b"),["a"]);
});
test("pinned tabs cannot be closed before unpinning",()=>{
  assert.equal(canCloseTab(["p1"],"p1"),false);
  assert.equal(canCloseTab(["p1"],"x"),true);
});
test("tab picker orders pinned tabs first while preserving their existing tab order",()=>{
  assert.deepEqual(orderTabIds(["a","b","c"],["c","a"]),["a","c","b"]);
});
test("persisted pin state survives restore and ignores invalid/duplicate IDs",()=>{
  const restored=restorePinnedState(["a","b","c"],["c","a","a","unknown"]);
  assert.deepEqual(restored,["a","c"]);
});
test("serialization uses versioned state and excludes arbitrary URL/secret fields",()=>{
  const value=serializePinnedState(["a","b"],["b"]);
  assert.deepEqual(value,{version:1,pinnedIds:["b"]});
});
