const OWNER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_UUID = OWNER_UUID;
const ALLOWED_OPERATIONS = new Set(["create", "search"]);

/** Build the adapter principal only from rows read by the trusted service-role resolver. */
export function resolveMemoryPrincipal({ ownerUserId, project, grant, run, agentKey, operation }) {
  if (typeof ownerUserId !== "string" || !OWNER_UUID.test(ownerUserId)) {
    return { ok: false, error: "owner_identity_invalid" };
  }
  if (!project || project.owner_user_id !== ownerUserId ||
      typeof project.id !== "string" || !OWNER_UUID.test(project.id) ||
      typeof project.project_key !== "string" || !/^[A-Za-z0-9._:-]{1,100}$/.test(project.project_key)) {
    return { ok: false, error: "project_scope_denied" };
  }
  if (!grant || grant.active !== true || grant.owner_user_id !== ownerUserId ||
      grant.project_id !== project.id || grant.agent_key !== agentKey ||
      typeof agentKey !== "string" || !/^[A-Za-z0-9_.:-]{2,100}$/.test(agentKey)) {
    return { ok: false, error: "agent_grant_denied" };
  }
  if (!run || typeof run.id !== "string" || !RUN_UUID.test(run.id) ||
      run.project_id !== project.id || run.project_key !== project.project_key ||
      String(run.state || "").toUpperCase() !== "RUNNING") {
    return { ok: false, error: "execution_run_invalid" };
  }
  if (!ALLOWED_OPERATIONS.has(operation) || !Array.isArray(grant.capabilities) ||
      !grant.capabilities.includes(operation)) {
    return { ok: false, error: "memory_capability_denied" };
  }
  const capabilities = grant.capabilities.filter(value => ALLOWED_OPERATIONS.has(value));
  return {
    ok: true,
    principal: {
      principal_id: ownerUserId,
      owner_scope: "midad-owner:" + ownerUserId,
      allowed_projects: [project.project_key],
      agent_id: grant.agent_key,
      run_id: run.id,
      capabilities,
      authenticated: true,
    },
  };
}
