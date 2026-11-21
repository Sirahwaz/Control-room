import test from "node:test";
import assert from "node:assert/strict";
import { resolveMemoryPrincipal } from "../supabase/functions/_shared/midad-memory-principal.mjs";

const owner = "123e4567-e89b-42d3-a456-426614174000";
const project = { id: "223e4567-e89b-42d3-a456-426614174000", project_key: "midad-mobile", owner_user_id: owner };
const grant = { owner_user_id: owner, project_id: project.id, agent_key: "factory-agent", capabilities: ["search", "create"], active: true };
const run = { id: "323e4567-e89b-42d3-a456-426614174000", project_id: project.id, project_key: project.project_key, agent_key: "factory-agent", state: "RUNNING" };
const resolve = overrides => resolveMemoryPrincipal({ ownerUserId: owner, project, grant, run, agentKey: "factory-agent", operation: "search", ...overrides });

test("resolves principal from owner-bound project, active agent grant and running project run", () => {
  const result = resolve({});
  assert.equal(result.ok, true);
  assert.equal(result.principal.owner_scope, "midad-owner:" + owner);
  assert.deepEqual(result.principal.allowed_projects, ["midad-mobile"]);
  assert.equal(result.principal.agent_id, "factory-agent");
  assert.equal(result.principal.run_id, run.id);
});

test("rejects project owned by another MIDAD user", () => {
  assert.equal(resolve({ project: { ...project, owner_user_id: "423e4567-e89b-42d3-a456-426614174000" } }).error, "project_scope_denied");
});

test("rejects inactive or cross-project agent grants", () => {
  assert.equal(resolve({ grant: { ...grant, active: false } }).error, "agent_grant_denied");
  assert.equal(resolve({ grant: { ...grant, project_id: "423e4567-e89b-42d3-a456-426614174000" } }).error, "agent_grant_denied");
});

test("rejects run not bound to this project, agent, or running state", () => {
  assert.equal(resolve({ run: { ...run, project_id: "423e4567-e89b-42d3-a456-426614174000" } }).error, "execution_run_invalid");
  assert.equal(resolve({ run: { ...run, agent_key: "other-agent" } }).error, "execution_run_invalid");
  assert.equal(resolve({ run: { ...run, state: "COMPLETED" } }).error, "execution_run_invalid");
});

test("rejects operation not explicitly granted", () => {
  assert.equal(resolve({ grant: { ...grant, capabilities: ["search"] }, operation: "create" }).error, "memory_capability_denied");
});

test("does not accept unsupported capabilities into the principal", () => {
  const result = resolve({ grant: { ...grant, capabilities: ["search", "restore", "export"] } });
  assert.deepEqual(result.principal.capabilities, ["search"]);
});
