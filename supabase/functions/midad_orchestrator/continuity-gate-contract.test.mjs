import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const orchestrator = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const omni = readFileSync(new URL("../midad_omni_agent_gateway/index.ts", import.meta.url), "utf8");

test("orchestrator rejects missing or invalid bootstrap before any model dispatch", () => {
  const gate = orchestrator.indexOf("loadRuntimeContext({");
  const modelDispatch = orchestrator.indexOf("callModel(model,task");
  assert.ok(gate >= 0 && modelDispatch > gate);
  assert.match(orchestrator, /continuity_bootstrap_blocked/);
  assert.match(orchestrator, /status:503/);
});

test("orchestrator binds the verified context into the model system instruction", () => {
  assert.match(orchestrator, /continuitySystemInstruction\(continuityContext\)/);
  assert.match(orchestrator, /expectedSha256:/);
});

test("Omni gateway gates every model and live-token action after bridge authentication", () => {
  const auth = omni.indexOf("bridge_session_invalid_or_expired");
  const gate = omni.indexOf("continuityResult=AI_ACTIONS.has(action)");
  const directProvider = omni.indexOf('if(action==="live_token")');
  assert.ok(auth >= 0 && gate > auth);
  assert.ok(directProvider > gate);
  assert.match(omni, /"live_token"/);
  assert.match(omni, /continuity_bootstrap_blocked/);
});

test("Omni direct Gemini routes receive the verified continuity system instruction", () => {
  const calls = omni.match(/continuityInstruction/g) || [];
  assert.ok(calls.length >= 6, "expected every direct Gemini fallback to include continuity context");
  assert.match(omni, /const continuityInstruction=continuity\?continuitySystemInstruction\(continuity\):"";/);
  assert.match(omni, /expectedSha256:CONTINUITY_SHA256/);
});


test("orchestrator tries the verified universal model gateway before BluesMinds for generic roles", () => {
  assert.match(orchestrator, /GATEWAY_ELIGIBLE_ROLES\\s*=\\s*new Set\\(\\[["']economy["'],["']general["'],["']reasoning["']\\]\\)/);
  const gatewayDispatch = orchestrator.indexOf("callModelGateway(");
  const bluesMindsFallback = orchestrator.indexOf("for(const model of routes)");
  assert.ok(gatewayDispatch >= 0, "expected a universal model gateway dispatch path");
  assert.ok(bluesMindsFallback > gatewayDispatch, "BluesMinds must remain after the gateway as fallback");
  assert.match(orchestrator, /task_class:\\s*["']generic["']/);
  assert.match(orchestrator, /data_class:\\s*["']sensitive["']/);
  assert.match(orchestrator, /model_gateway_fallback/);
});
