import { createHash } from 'node:crypto';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

export const RUNNER_CAPABILITIES = Object.freeze([
  'generic-execution',
  'midad.public-read-only-probe',
]);

export const RUNNER_POLICY = Object.freeze({
  agentVersion: 'midad-gha-continuity-v1',
  leaseTtlSeconds: 120,
  maxResponseBytes: 64 * 1024,
  requestTimeoutMs: 10_000,
  operation: 'GET_EXAMPLE_DOMAIN',
  schema: 'midad-public-probe-v1',
});

const validId = value =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function safeErrorCode(error) {
  const value = String(error?.code || error?.message || 'RUNNER_OPERATION_FAILED');
  return value.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 80) || 'RUNNER_OPERATION_FAILED';
}

export function validateRunnerConfig(input) {
  if (!isRecord(input)) throw new Error('RUNNER_CONFIG_REQUIRED');
  let url;
  try { url = new URL(input.ledgerUrl); }
  catch { throw new Error('LEDGER_URL_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password ||
      (url.port && url.port !== '443') || url.search || url.hash ||
      (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('LEDGER_URL_MUST_BE_HTTPS_ORIGIN');
  }
  if (!validId(input.nodeId) || !validId(input.ownerId)) throw new Error('RUNNER_IDENTITY_INVALID');
  if (typeof input.nodeToken !== 'string' || !/^[a-f0-9]{64}$/i.test(input.nodeToken)) {
    throw new Error('RUNNER_NODE_TOKEN_INVALID');
  }
  return Object.freeze({
    ledgerUrl: url.origin,
    nodeId: input.nodeId,
    ownerId: input.ownerId,
    nodeToken: input.nodeToken,
  });
}

export function validateClaimedProbeTask(task, expectedOwnerId) {
  if (!isRecord(task) || !validId(task.task_id) || task.owner_id !== expectedOwnerId ||
      task.workload !== 'SINGLE' || !Number.isInteger(task.attempt) ||
      task.attempt < 1 || task.attempt > 3 ||
      typeof task.lease_token !== 'string' || !/^[a-f0-9]{64}$/i.test(task.lease_token)) {
    throw new Error('CLAIMED_TASK_IDENTITY_INVALID');
  }
  const payload = task.payload;
  if (!isRecord(payload) || payload.schema !== RUNNER_POLICY.schema ||
      payload.operation !== RUNNER_POLICY.operation ||
      Object.keys(payload).length !== 2) {
    throw new Error('CLAIMED_TASK_OPERATION_NOT_ALLOWED');
  }
  return Object.freeze({
    task_id: task.task_id,
    owner_id: task.owner_id,
    attempt: task.attempt,
    lease_token: task.lease_token,
    operation: payload.operation,
  });
}

async function readBoundedBody(response, maxBytes) {
  const announced = Number(response.headers?.get?.('content-length') || 0);
  if (Number.isFinite(announced) && announced > maxBytes) throw new Error('RESPONSE_LIMIT_EXCEEDED');
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        try { await reader.cancel('response limit exceeded'); } catch {}
        throw new Error('RESPONSE_LIMIT_EXCEEDED');
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function executePublicProbe({
  fetchImpl = globalThis.fetch,
  timeoutMs = RUNNER_POLICY.requestTimeoutMs,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('FETCH_UNAVAILABLE');
  const started = Date.now();
  let response;
  try {
    response = await fetchImpl('https://example.com/', {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'text/html,application/xhtml+xml' },
    });
  } catch {
    const error = new Error('PUBLIC_PROBE_NETWORK_FAILURE');
    error.retryable = true;
    throw error;
  }
  if (response.status !== 200) {
    const error = new Error('PUBLIC_PROBE_HTTP_STATUS_' + response.status);
    error.retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    throw error;
  }
  const bytes = await readBoundedBody(response, RUNNER_POLICY.maxResponseBytes);
  return {
    outcome: 'PASS',
    source_host: 'example.com',
    http_status: response.status,
    content_type: String(response.headers?.get?.('content-type') || 'unknown').slice(0, 120),
    bytes_read: bytes.byteLength,
    content_sha256: createHash('sha256').update(bytes).digest('hex'),
    duration_ms: Math.max(0, Date.now() - started),
  };
}

function runtimeResources() {
  const cpu = Math.max(1, Math.min(1024, os.cpus().length || 1));
  const memory = Math.max(512, Math.min(1_000_000_000, Math.floor(os.totalmem() / (1024 * 1024))));
  return { cpu_cores: cpu, memory_mb: memory };
}

export async function runContinuityRunner(input, {
  fetchImpl = globalThis.fetch,
  probeFetch = globalThis.fetch,
} = {}) {
  const config = validateRunnerConfig(input);
  if (typeof fetchImpl !== 'function') throw new Error('LEDGER_FETCH_UNAVAILABLE');

  const request = async (endpoint, payload) => {
    const response = await fetchImpl(config.ledgerUrl + endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(RUNNER_POLICY.requestTimeoutMs),
      headers: {
        authorization: 'Bearer ' + config.nodeToken,
        'x-midad-node-id': config.nodeId,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const rawBytes = await readBoundedBody(response, 65536);
    const raw = new TextDecoder().decode(rawBytes);
    let body;
    try { body = JSON.parse(raw); } catch { throw new Error('LEDGER_RESPONSE_INVALID_JSON'); }
    if (!response.ok || body?.ok !== true) {
      throw new Error('LEDGER_REQUEST_REJECTED_' + response.status);
    }
    return body;
  };

  const resources = runtimeResources();
  await request('/v1/nodes/heartbeat', {
    ...resources,
    available_slots: 1,
    cost_per_hour_usd: 0,
    cost_estimate_verified: true,
    encrypted_session_store: false,
    agent_version: RUNNER_POLICY.agentVersion,
    capabilities: [...RUNNER_CAPABILITIES],
  });

  const claim = await request('/v1/tasks/claim', {
    lease_ttl_seconds: RUNNER_POLICY.leaseTtlSeconds,
  });
  if (!claim.task) return { status: 'IDLE' };

  const claimed = claim.task;
  let normalized;
  try {
    normalized = validateClaimedProbeTask(claimed, config.ownerId);
  } catch {
    if (validId(claimed.task_id) && typeof claimed.lease_token === 'string' &&
        /^[a-f0-9]{64}$/i.test(claimed.lease_token)) {
      await request('/v1/tasks/fail', {
        task_id: claimed.task_id,
        lease_token: claimed.lease_token,
        retryable: false,
        reason: 'TASK_CONTRACT_REJECTED',
      });
    }
    return { status: 'REJECTED_TASK', task_id: validId(claimed.task_id) ? claimed.task_id : null };
  }

  await request('/v1/tasks/checkpoint', {
    task_id: normalized.task_id,
    lease_token: normalized.lease_token,
    checkpoint: {
      phase: 'PUBLIC_PROBE_STARTED',
      operation: normalized.operation,
      attempt: normalized.attempt,
    },
  });

  let result;
  try {
    result = await executePublicProbe({ fetchImpl: probeFetch });
  } catch (error) {
    const retryable = error?.retryable === true;
    await request('/v1/tasks/fail', {
      task_id: normalized.task_id,
      lease_token: normalized.lease_token,
      retryable,
      reason: safeErrorCode(error),
    });
    return { status: retryable ? 'RETRY_QUEUED' : 'FAILED', task_id: normalized.task_id };
  }

  await request('/v1/tasks/complete', {
    task_id: normalized.task_id,
    lease_token: normalized.lease_token,
    result,
  });
  return { status: 'COMPLETED', task_id: normalized.task_id, evidence: result };
}

async function main() {
  const config = validateRunnerConfig({
    ledgerUrl: process.env.MIDAD_CONTINUITY_LEDGER_URL,
    nodeId: process.env.MIDAD_CONTINUITY_NODE_ID,
    ownerId: process.env.MIDAD_CONTINUITY_OWNER_ID,
    nodeToken: process.env.MIDAD_CONTINUITY_NODE_TOKEN,
  });
  const result = await runContinuityRunner(config);
  process.stdout.write(JSON.stringify(result) + '\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(error => {
    process.stderr.write(JSON.stringify({
      status: 'FAILED',
      error: safeErrorCode(error),
    }) + '\n');
    process.exitCode = 1;
  });
}
