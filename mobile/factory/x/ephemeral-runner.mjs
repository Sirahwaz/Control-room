import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const NODE_ID = 'github-actions-cpu-batch';
const AGENT_VERSION = 'midad-actions-0.1.0';
const MAX_SUM_ITEMS = 10_000;
const MAX_TEXT_BYTES = 65_536;

function requireId(value, name) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new Error(name + '_INVALID');
  }
  return value;
}

function validateEnvironment(env) {
  let ledgerUrl;
  try {
    ledgerUrl = new URL(env.MIDAD_CONTINUITY_LEDGER_URL || '');
  } catch {
    throw new Error('LEDGER_URL_MUST_BE_HTTPS_ORIGIN');
  }
  if (ledgerUrl.protocol !== 'https:' || !ledgerUrl.hostname ||
      ledgerUrl.username || ledgerUrl.password ||
      (ledgerUrl.port && ledgerUrl.port !== '443') ||
      (ledgerUrl.pathname !== '/' && ledgerUrl.pathname !== '') ||
      ledgerUrl.search || ledgerUrl.hash) {
    throw new Error('LEDGER_URL_MUST_BE_HTTPS_ORIGIN');
  }

  const ownerId = requireId(env.MIDAD_CONTINUITY_OWNER_ID, 'OWNER_ID');
  if (ownerId !== 'github:116122510' || env.MIDAD_INPUT_OWNER_ID !== ownerId) {
    throw new Error('OWNER_ID_INPUT_MISMATCH');
  }

  let oidcRequestUrl;
  try {
    oidcRequestUrl = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL || '');
  } catch {
    throw new Error('GITHUB_OIDC_TOKEN_REQUEST_UNAVAILABLE');
  }
  const allowedOidcActionsHost =
    /^pipelines[a-z0-9-]*\.actions\.githubusercontent\.com$/.test(oidcRequestUrl.hostname) ||
    /^run-actions-[0-9]+-[a-z0-9-]+\.actions\.githubusercontent\.com$/.test(oidcRequestUrl.hostname);
  const oidcEndpointMetadata = {
    protocol: oidcRequestUrl.protocol,
    hostname: oidcRequestUrl.hostname,
    port: oidcRequestUrl.port || 'default',
    has_credentials: Boolean(oidcRequestUrl.username || oidcRequestUrl.password),
    has_fragment: Boolean(oidcRequestUrl.hash),
    allowed_github_actions_host: allowedOidcActionsHost,
  };
  if (oidcRequestUrl.protocol !== 'https:' ||
      !allowedOidcActionsHost ||
      oidcRequestUrl.username || oidcRequestUrl.password ||
      (oidcRequestUrl.port && oidcRequestUrl.port !== '443') ||
      oidcRequestUrl.hash) {
    // Host/protocol metadata only: never log the URL path, query, bootstrap credential or JWT.
    console.error('GITHUB_OIDC_ENDPOINT_REJECTED ' + JSON.stringify(oidcEndpointMetadata));
    throw new Error('GITHUB_OIDC_TOKEN_REQUEST_URL_INVALID');
  }
  const oidcRequestToken = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (typeof oidcRequestToken !== 'string' || oidcRequestToken.length < 32) {
    throw new Error('GITHUB_OIDC_TOKEN_REQUEST_UNAVAILABLE');
  }

  const taskId = typeof env.MIDAD_TASK_ID === 'string' && env.MIDAD_TASK_ID.length > 0
    ? requireId(env.MIDAD_TASK_ID, 'TASK_ID')
    : null;
  const eventId = typeof env.MIDAD_EVENT_ID === 'string' && env.MIDAD_EVENT_ID.length > 0
    ? requireId(env.MIDAD_EVENT_ID, 'EVENT_ID')
    : null;
  if (Boolean(taskId) !== Boolean(eventId)) throw new Error('DISPATCH_IDENTIFIERS_INCOMPLETE');
  return {
    ledgerOrigin: ledgerUrl.origin,
    ownerId,
    taskId,
    eventId,
    oidcRequestUrl: oidcRequestUrl.toString(),
    oidcRequestToken,
  };
}

async function requestGitHubOidcToken(config, fetchImpl) {
  const url = new URL(config.oidcRequestUrl);
  url.searchParams.set('audience', 'midad-continuity-ledger');
  const response = await fetchImpl(url.toString(), {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    headers: {
      authorization: 'Bearer ' + config.oidcRequestToken,
      accept: 'application/json',
    },
  });
  let body;
  try { body = jsonResponseShape(await response.json(), response.status); }
  catch { throw new Error('GITHUB_OIDC_TOKEN_RESPONSE_INVALID'); }
  if (!response.ok || typeof body.value !== 'string' ||
      body.value.length < 100 || body.value.length > 16384 ||
      body.value.split('.').length !== 3) {
    throw new Error('GITHUB_OIDC_TOKEN_RESPONSE_INVALID');
  }
  return body.value;
}

function jsonResponseShape(body, status) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('LEDGER_RESPONSE_INVALID_' + status);
  }
  return body;
}

async function ledgerPost(config, pathName, body, fetchImpl, oidcToken) {
  const response = await fetchImpl(config.ledgerOrigin + pathName, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    headers: {
      authorization: 'Bearer ' + oidcToken,
      'x-midad-node-id': NODE_ID,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  let parsed;
  try { parsed = jsonResponseShape(await response.json(), response.status); }
  catch { throw new Error('LEDGER_RESPONSE_INVALID_' + response.status); }
  if (!response.ok || parsed.ok !== true) {
    throw new Error(typeof parsed.error === 'string' ? parsed.error : 'LEDGER_REQUEST_FAILED_' + response.status);
  }
  return parsed;
}

export function executeTaskPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      Object.keys(payload).some(key => !['operation','input'].includes(key))) {
    throw new Error('TASK_PAYLOAD_INVALID');
  }
  if (payload.operation === 'RUNNER_SMOKE') {
    if (payload.input !== undefined && (
      payload.input === null || typeof payload.input !== 'object' ||
      Array.isArray(payload.input) || Object.keys(payload.input).length !== 0
    )) {
      throw new Error('RUNNER_SMOKE_INPUT_INVALID');
    }
    return {
      operation: 'RUNNER_SMOKE',
      node_id: NODE_ID,
      platform: os.platform(),
      node_version: process.version,
      cpu_count: os.cpus().length,
    };
  }
  if (payload.operation === 'SUM_INTEGERS') {
    const input = payload.input;
    const values = input?.values;
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        Object.keys(input).length !== 1 || !Array.isArray(values) ||
        values.length < 1 || values.length > MAX_SUM_ITEMS ||
        values.some(value => !Number.isSafeInteger(value))) {
      throw new Error('SUM_INPUT_INVALID');
    }
    const sum = values.reduce((total, value) => total + value, 0);
    if (!Number.isSafeInteger(sum)) throw new Error('SUM_OVERFLOW');
    return { operation: 'SUM_INTEGERS', count: values.length, sum };
  }
  if (payload.operation === 'HASH_TEXT') {
    const input = payload.input;
    const value = input?.text;
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        Object.keys(input).length !== 1 || typeof value !== 'string' ||
        Buffer.byteLength(value, 'utf8') > MAX_TEXT_BYTES) {
      throw new Error('HASH_INPUT_INVALID');
    }
    return {
      operation: 'HASH_TEXT',
      bytes: Buffer.byteLength(value, 'utf8'),
      sha256: createHash('sha256').update(value, 'utf8').digest('hex'),
    };
  }
  throw new Error('TASK_OPERATION_NOT_ALLOWLISTED');
}

export async function runEphemeralTask({ env = process.env, fetchImpl = fetch } = {}) {
  const config = validateEnvironment(env);
  const oidcToken = await requestGitHubOidcToken(config, fetchImpl);
  await ledgerPost(config, '/v1/nodes/heartbeat', {
    cpu_cores: Math.max(1, os.cpus().length),
    memory_mb: Math.max(512, Math.floor(os.totalmem() / 1024 / 1024)),
    available_slots: 1,
    cost_per_hour_usd: 0,
    cost_estimate_verified: true,
    capabilities: ['cpu-batch'],
    agent_version: AGENT_VERSION,
    encrypted_session_store: false,
  }, fetchImpl, oidcToken);

  const claimRequest = { workload: 'CPU_BATCH', lease_ttl_seconds: 180 };
  if (config.taskId) claimRequest.task_id = config.taskId;
  const claimed = await ledgerPost(config, '/v1/tasks/claim', claimRequest, fetchImpl, oidcToken);
  if (claimed.task === null) return { status: 'NO_ELIGIBLE_TASK', task_id: config.taskId };
  const task = claimed.task;
  if (!task || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(task.task_id || '') ||
      (config.taskId && task.task_id !== config.taskId) || task.owner_id !== config.ownerId ||
      task.workload !== 'CPU_BATCH' || typeof task.lease_token !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(task.lease_token)) {
    throw new Error('CLAIMED_TASK_IDENTITY_OR_WORKLOAD_MISMATCH');
  }

  let result;
  try {
    result = executeTaskPayload(task.payload);
  } catch (error) {
    await ledgerPost(config, '/v1/tasks/fail', {
      task_id: task.task_id,
      lease_token: task.lease_token,
      retryable: true,
      reason: error instanceof Error ? error.message.slice(0, 120) : 'TASK_EXECUTION_FAILED',
    }, fetchImpl, oidcToken);
    return { status: 'FAILED_RETRYABLE', task_id: task.task_id };
  }

  const evidence = {
    schema: 'midad-ephemeral-runner-evidence-v1',
    ...(config.eventId ? { event_id: config.eventId } : { trigger_mode: 'SCHEDULED_PULL' }),
    task_id: task.task_id,
    attempt: task.attempt,
    runner: NODE_ID,
    operation: result.operation,
    result_sha256: createHash('sha256').update(JSON.stringify(result)).digest('hex'),
  };
  await ledgerPost(config, '/v1/tasks/checkpoint', {
    task_id: task.task_id,
    lease_token: task.lease_token,
    checkpoint: evidence,
  }, fetchImpl, oidcToken);
  await ledgerPost(config, '/v1/tasks/complete', {
    task_id: task.task_id,
    lease_token: task.lease_token,
    result: { ...evidence, summary: result },
  }, fetchImpl, oidcToken);

  return { status: 'COMPLETED', task_id: task.task_id, evidence };
}

async function main() {
  const result = await runEphemeralTask();
  process.stdout.write(JSON.stringify(result) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write((error instanceof Error ? error.message : 'EPHEMERAL_RUNNER_FAILED') + '\n');
    process.exitCode = 1;
  });
}
