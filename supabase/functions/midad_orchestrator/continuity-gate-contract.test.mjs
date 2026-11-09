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
  const calls = omni.match(/continuitySystemInstruction\(continuity\)/g) || [];
  assert.ok(calls.length >= 5, "expected every direct Gemini fallback to include continuity context");
  assert.match(omni, /expectedSha256:CONTINUITY_SHA256/);
});
