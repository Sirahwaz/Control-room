import test from "node:test";
import assert from "node:assert/strict";
import { planMediaProduction } from "./media-planner.mjs";

const catalog = { models: [
  { id:"img-15", displayName:"Image Lite", modes:{ image:[{mode:"text2image",totalCredits:15,affordable:true}] } },
  { id:"img-20", displayName:"Image Standard", modes:{ image:[{mode:"text2image",totalCredits:20,affordable:true}] } },
  { id:"video-50", displayName:"Video Starter", modes:{ video:[{mode:"text2video",totalCredits:50,affordable:false}] } }
]};
const base = { brief:"Original Arabic product explainer visual", rightsConfirmed:true, availableCredits:25, maxCredits:25, openArtCatalog:catalog };

test("blocks jobs without an approved source brief", () => {
  const plan = planMediaProduction({...base,mediaType:"image",brief:""});
  assert.equal(plan.status,"BLOCKED_MISSING_BRIEF");
  assert.equal(plan.executionAllowed,false);
});

test("requires rights confirmation before preparing a job", () => {
  const plan = planMediaProduction({...base,mediaType:"image",rightsConfirmed:false});
  assert.equal(plan.status,"BLOCKED_RIGHTS_CONFIRMATION");
});

test("selects the lowest-cost affordable image mode without executing", () => {
  const plan = planMediaProduction({...base,mediaType:"image"});
  assert.equal(plan.status,"PENDING_SPEND_APPROVAL");
  assert.equal(plan.selected.modelId,"img-15");
  assert.equal(plan.selected.creditsRequired,15);
  assert.equal(plan.executionAllowed,false);
});

test("respects a tighter per-job spend ceiling", () => {
  const plan = planMediaProduction({...base,mediaType:"image",maxCredits:10});
  assert.equal(plan.status,"BLOCKED_INSUFFICIENT_CREDITS");
  assert.equal(plan.deficitCredits,5);
});

test("blocks video if the cheapest catalog mode exceeds the available balance", () => {
  const plan = planMediaProduction({...base,mediaType:"video"});
  assert.equal(plan.status,"BLOCKED_INSUFFICIENT_CREDITS");
  assert.equal(plan.cheapestAvailable.creditsRequired,50);
  assert.equal(plan.deficitCredits,25);
});

test("blocks HeyGen audio when usage pricing or quota cannot be verified", () => {
  const plan = planMediaProduction({...base,mediaType:"audio"});
  assert.equal(plan.status,"BLOCKED_AUDIO_COST_UNVERIFIED");
  assert.equal(plan.voiceCatalogAvailable,true);
  assert.equal(plan.executionAllowed,false);
});

test("requires spend approval even after a verified cost quote", () => {
  const plan = planMediaProduction({...base,mediaType:"audio",speechCostQuote:{amount:4,availableUnits:10,unit:"quota_units",verified:true}});
  assert.equal(plan.status,"PENDING_SPEND_APPROVAL");
  assert.equal(plan.executionAllowed,false);
});

test("rejects unsupported media types and enforces provider-specific quota units", () => {
  assert.throws(() => planMediaProduction({...base,mediaType:"stream"}), /UNSUPPORTED/);
  const plan = planMediaProduction({...base,mediaType:"audio",speechCostQuote:{amount:11,availableUnits:10,unit:"quota_units",verified:true}});
  assert.equal(plan.status,"BLOCKED_PROVIDER_QUOTA");
});
