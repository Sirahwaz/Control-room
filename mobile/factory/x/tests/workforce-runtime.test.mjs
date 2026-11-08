import test from "node:test";
import assert from "node:assert/strict";
import { compileWorkforcePlan } from "../workforce-runtime.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const agents = JSON.parse(readFileSync(new URL("agents.registry.json", root), "utf8")).agents;
const bindings = JSON.parse(readFileSync(new URL("agent-bindings.registry.json", root), "utf8")).bindings;
const adapters = JSON.parse(readFileSync(new URL("adapters.registry.json", root), "utf8")).adapters;
const payloads = {
  "wallet-behavior-agent": {
    public_wallet_transactions: [{hash:"0x"+ "1".repeat(64)}],
    chain_id: "1",
    observation_window: "30d",
    risk_policy: {minimum_sample: 10, paper_only: true}
  },
  "offer-negotiation-agent": {
    client_requirements: {language:"ar",scope:"landing page"},
    delivery_scope: ["single-page website"],
    pricing_policy: {currency:"USD",floor:50},
    commercial_constraints: {non_binding:true}
  },
  "media-production-agent": {
    content_brief: {objective:"explain a product",script:"original script"},
    voice_profile: {style:"professional Arabic",source:"licensed catalog voice"},
    language: "ar",
    delivery_format: "short-video",
    credit_budget: 25
  }
};

function plan(agentIds, overrides={}) {
  return compileWorkforcePlan({
    agentIds, agents, bindings, adapters, payloads,
    maxParallelAgents: 32,
    ...overrides
  });
}

test("wallet role produces public-data-only plan and never dispatches financial actions", () => {
  const result=plan(["wallet-behavior-agent"]);
  assert.equal(result.ok,true);
  const task=result.tasks[0];
  assert.equal(task.state,"READY_READ_ONLY_ANALYSIS_PLAN");
  assert.equal(task.executionAllowed,false);
  assert.equal(task.walletSigningAllowed,false);
  assert.equal(task.liveOrdersAllowed,false);
  assert.equal(task.adapterInvoked,false);
  assert.deepEqual(task.missingInputs,[]);
});

test("offer negotiation remains non-binding and human-gated", () => {
  const result=plan(["offer-negotiation-agent"]);
  const task=result.tasks[0];
  assert.equal(task.state,"READY_NON_BINDING_DRAFT_PLAN");
  assert.equal(task.bindingAuthority,false);
  assert.equal(task.customerSendAllowed,false);
  assert.equal(task.humanApprovalRequired,true);
});

test("media work blocks until cost, rights and spend approval are all verified", () => {
  const result=plan(["media-production-agent"]);
  const task=result.tasks[0];
  assert.equal(task.state,"BLOCKED_APPROVAL_GATES");
  assert.deepEqual(task.requiredApprovals,["verified_cost_quote","rights_confirmed","spend_approved"]);
  assert.equal(task.providerInvoked,false);
  assert.equal(result.dispatchAllowed,false);
});

const verifiedImagePlan = () => ({
  status:"PENDING_SPEND_APPROVAL",
  mediaType:"image",
  selected:{modelId:"nano-banana-2",creditsRequired:20,affordable:true},
  spendLimit:25,
  rightsConfirmed:true,
  executionAllowed:false
});

test("verified Media Studio plan remains pending a separate spend approval", () => {
  const result=plan(["media-production-agent"],{
    approvals:{"media-production-agent":{mediaPlan:verifiedImagePlan(),spend_approved:false}}
  });
  assert.equal(result.tasks[0].state,"PENDING_SPEND_APPROVAL");
  assert.deepEqual(result.tasks[0].requiredApprovals,["spend_approved"]);
  assert.equal(result.tasks[0].providerInvoked,false);
  assert.equal(result.dispatchAllowed,false);
});

test("approved media plan becomes review-ready but never invokes a provider", () => {
  const result=plan(["media-production-agent"],{
    approvals:{"media-production-agent":{mediaPlan:verifiedImagePlan(),spend_approved:true}}
  });
  assert.equal(result.tasks[0].state,"READY_FOR_HUMAN_REVIEW");
  assert.equal(result.tasks[0].providerInvoked,false);
  assert.equal(result.dispatchAllowed,false);
});

test("rejects a media quote whose cost exceeds its verified spend limit", () => {
  const result=plan(["media-production-agent"],{
    approvals:{"media-production-agent":{
      mediaPlan:{...verifiedImagePlan(),selected:{modelId:"video",creditsRequired:50,affordable:false}},
      spend_approved:true
    }}
  });
  assert.equal(result.tasks[0].state,"BLOCKED_APPROVAL_GATES");
  assert.ok(result.tasks[0].requiredApprovals.includes("verified_cost_quote"));
});

test("missing required inputs fail closed", () => {
  const result=plan(["wallet-behavior-agent"],{payloads:{"wallet-behavior-agent":{chain_id:"1"}}});
  assert.equal(result.ok,false);
  assert.equal(result.tasks[0].state,"BLOCKED_MISSING_INPUTS");
  assert.ok(result.tasks[0].missingInputs.includes("public_wallet_transactions"));
});

test("secret-bearing inputs are rejected and never copied to the plan", () => {
  const secret="sk-secret-value-0123456789";
  const result=plan(["offer-negotiation-agent"],{
    payloads:{"offer-negotiation-agent":{
      ...payloads["offer-negotiation-agent"],
      metadata:{api_key:secret}
    }}
  });
  assert.equal(result.ok,false);
  assert.equal(result.tasks[0].state,"BLOCKED_SENSITIVE_INPUT");
  assert.equal(JSON.stringify(result).includes(secret),false);
});

test("unknown role IDs block rather than selecting a fallback worker", () => {
  const result=plan(["unregistered-autonomous-worker"]);
  assert.equal(result.ok,false);
  assert.equal(result.blockers[0].reason,"unknown_agent");
  assert.equal(result.dispatchAllowed,false);
});

test("parallel planning respects configured cap and reports non-executable state", () => {
  const result=plan(["wallet-behavior-agent","offer-negotiation-agent","media-production-agent"],{maxParallelAgents:2});
  assert.equal(result.parallelism.maxConcurrentPlans,2);
  assert.equal(result.waves.length,2);
  assert.equal(result.dispatchAllowed,false);
  assert.equal(result.executionMode,"PLAN_ONLY_NO_DISPATCH");
});

test("rejects a media quote with null or nonnumeric cost data", () => {
  const result=plan(["media-production-agent"],{
    approvals:{"media-production-agent":{
      mediaPlan:{...verifiedImagePlan(),selected:{modelId:"bad",creditsRequired:null,affordable:true}},
      spend_approved:true
    }}
  });
  assert.equal(result.tasks[0].state,"BLOCKED_APPROVAL_GATES");
  assert.ok(result.tasks[0].requiredApprovals.includes("verified_cost_quote"));
});
