import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Control Room public entrypoint uses the non-privileged ingest identity for generic chat", async () => {
  const src = await read("../midad_control_room/index.ts");
  assert.match(src, /"x-midad-ingest-key"\s*:\s*ik/);
  assert.match(src, /action\s*:\s*"chat"[\s\S]{0,120}task_class\s*:\s*"generic"/);
  assert.doesNotMatch(src, /task_class\s*:\s*"public_sanitized"/);
});

test("legacy PromptOS-only callers use ingest identity and remain outside public_sanitized inference routing", async () => {
  const [orchestrator, omni, campaign] = await Promise.all([
    read("../midad_orchestrator/index.ts"),
    read("../midad_omni_agent_gateway/index.ts"),
    read("../generate_campaign/index.ts"),
  ]);
  assert.match(orchestrator, /"x-midad-ingest-key"\s*:\s*ingestKey/);
  assert.match(orchestrator, /action\s*:\s*"promptos_compile"/);
  assert.match(omni, /"x-midad-ingest-key"\s*:\s*ik/);
  assert.match(omni, /action\s*:\s*"promptos_compile"/);
  assert.match(campaign, /"x-midad-ingest-key"\s*:\s*ingest/);
  assert.match(campaign, /action\s*:\s*"promptos_compile"/);
});

test("AI Router reserves public_sanitized inference for the autonomy identity", async () => {
  const src = await read("./index.ts");
  assert.match(src, /resolveAIRouterAuthMode/);
  assert.match(src, /callerAuthMode\s*!==\s*"autonomy"/);
  assert.match(src, /public_sanitized_route_requires_autonomy_identity/);
  assert.match(src, /action\s*===\s*"promptos_compile"/);
});

test("model gateway supports the same ingest and autonomy service identities", async () => {
  const src = await read("../midad_model_gateway_v3/index.ts");
  assert.match(src, /x-midad-ingest-key/);
  assert.match(src, /x-midad-autonomy-key/);
});
