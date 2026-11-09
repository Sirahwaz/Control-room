import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const NODE_ID = 'github-actions-linux';
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
  const ledgerUrl = new URL(env.MIDAD_CONTINUITY_LEDGER_URL || '');
  if (ledgerUrl.protocol !== 'https:' || ledgerUrl.username || ledgerUrl.password ||
      ledgerUrl.search || ledgerUrl.hash) {
    throw new Error('LEDGER_URL_MUST_BE_HTTPS');
  }
  const token = env.MIDAD_CONTINUITY_RUNNER_NODE_TOKEN;
  if (typeof token !== 'string' || token.length < 32 || token.length > 256) {
    throw new Error('RUNNER_NODE_TOKEN_MISSING');
  }
  return {
    ledgerOrigin: ledgerUrl.origin,
    ownerId: requireId(env.MIDAD_CONTINUITY_OWNER_ID, 'OWNER_ID'),
    taskId: requireId(env.MIDAD_TASK_ID, 'TASK_ID'),
    eventId: requireId(env.MIDAD_EVENT_ID, 'EVENT_ID'),
    token,
  };
}

function jsonResponseShape(body, status) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('LEDGER_RESPONSE_INVALID_' + status);
  }
  return body;
}

async function ledgerPost(config, pathName, body, fetchImpl) {
  const response = await fetchImpl(config.ledgerOrigin + pathName, {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + config.token,
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
    if (payload.input !== undefined && (payload.input === null || typeof payload.input !== 'object' || Array.isArray(payload.input))) {
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
    const values = payload.input?.values;
    if (!Array.isArray(values) || values.length < 1 || values.length > MAX_SUM_ITEMS ||
        values.some(value => !Number.isSafeInteger(value))) {
      throw new Error('SUM_INPUT_INVALID');
    }
    const sum = values.reduce((total, value) => total + value, 0);
    if (!Number.isSafeInteger(sum)) throw new Error('SUM_OVERFLOW');
    return { operation: 'SUM_INTEGERS', count: values.length, sum };
  }
  if (payload.operation === 'HASH_TEXT') {
    const value = payload.input?.text;
    if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_TEXT_BYTES) {
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
  await ledgerPost(config, '/v1/nodes/heartbeat', {
    cpu_cores: Math.max(1, os.cpus().length),
    memory_mb: Math.max(512, Math.floor(os.totalmem() / 1024 / 1024)),
    available_slots: 1,
    cost_per_hour_usd: 0,
    cost_estimate_verified: true,
    capabilities: ['cpu-batch'],
    agent_version: AGENT_VERSION,
    encrypted_session_store: false,
  }, fetchImpl);

  const claimed = await ledgerPost(config, '/v1/tasks/claim', {
    task_id: config.taskId,
    lease_ttl_seconds: 180,
  }, fetchImpl);
  if (claimed.task === null) return { status: 'NO_ELIGIBLE_TASK', task_id: config.taskId };
  const task = claimed.task;
  if (!task || task.task_id !== config.taskId || task.owner_id !== config.ownerId ||
      task.workload !== 'CPU_BATCH' || typeof task.lease_token !== 'string' ||
      task.lease_token.length !== 64) {
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
    }, fetchImpl);
    return { status: 'FAILED_RETRYABLE', task_id: task.task_id };
  }

  const evidence = {
    schema: 'midad-ephemeral-runner-evidence-v1',
    event_id: config.eventId,
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
  }, fetchImpl);
  await ledgerPost(config, '/v1/tasks/complete', {
    task_id: task.task_id,
    lease_token: task.lease_token,
    result: { ...evidence, summary: result },
  }, fetchImpl);

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
