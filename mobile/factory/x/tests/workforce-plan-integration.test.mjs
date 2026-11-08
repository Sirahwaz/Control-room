import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

test("Factory X planner compiles the three Neural++ workforce roles without dispatch", () => {
  execFileSync(process.execPath, [
    "mobile/factory/x/plan.mjs",
    "mobile/factory/x/examples/workforce-roles.request.json"
  ], {stdio:"pipe"});
  const plan = JSON.parse(readFileSync("mobile/factory/x/runtime-plan.json","utf8"));
  const workforce = plan.workforce;
  assert.equal(workforce.ok,true);
  assert.equal(workforce.state,"PLAN_COMPILED");
  assert.equal(workforce.executionMode,"PLAN_ONLY_NO_DISPATCH");
  assert.equal(workforce.dispatchAllowed,false);
  assert.deepEqual(
    workforce.tasks.map(task=>[task.agentId,task.state]),
    [
      ["wallet-behavior-agent","READY_READ_ONLY_ANALYSIS_PLAN"],
      ["offer-negotiation-agent","READY_NON_BINDING_DRAFT_PLAN"],
      ["media-production-agent","PENDING_SPEND_APPROVAL"]
    ]
  );
  assert.equal(workforce.tasks.every(task=>task.adapterInvoked===false && task.providerInvoked===false),true);
  assert.deepEqual(workforce.tasks[0].walletSigningAllowed,false);
  assert.deepEqual(workforce.tasks[0].liveOrdersAllowed,false);
  assert.equal(workforce.tasks[1].customerSendAllowed,false);
  assert.deepEqual(workforce.tasks[2].requiredApprovals,["spend_approved"]);
});
