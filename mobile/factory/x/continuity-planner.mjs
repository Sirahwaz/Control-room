import { createHash } from 'node:crypto';

const WORKLOADS = new Set(['CPU_BATCH', 'WEBGPU_BATCH', 'BROWSER_SESSION', 'SINGLE']);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);

function blocked(reason, taskId = null, details = {}) {
  return {
    status: 'BLOCKED',
    reason,
    task_id: taskId,
    assignments: [],
    estimated_cost_usd: 0,
    dispatch_allowed: false,
    execution_performed: false,
    ...details,
  };
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function requiredCapabilities(task) {
  const supplied = Array.isArray(task.required_capabilities)
    ? task.required_capabilities.map(value => String(value).trim()).filter(Boolean)
    : [];
  const workloadCapability = {
    CPU_BATCH: 'cpu-batch',
    WEBGPU_BATCH: 'webgpu-compute',
    BROWSER_SESSION: 'interactive-browser-execution',
    SINGLE: 'generic-execution',
  }[task.workload];
  const defaults = task.workload === 'BROWSER_SESSION'
    ? ['persistent-browser-session', 'encrypted-session-store']
    : [];
  return [...new Set([workloadCapability, ...defaults, ...supplied])];
}

function heartbeatLimit(node, defaults) {
  const classDefault = node.runtime_class === 'github_actions' || node.runtime_class === 'ephemeral_runner'
    ? defaults.maxEphemeralHeartbeatSeconds
    : defaults.maxPersistentHeartbeatSeconds;
  if (finite(node.heartbeat_max_age_seconds) && node.heartbeat_max_age_seconds > 0) {
    return Math.min(classDefault, node.heartbeat_max_age_seconds);
  }
  return classDefault;
}

function assessNode(node, task, now, defaults) {
  if (!isRecord(node) || !validId(node.id)) return { eligible: false, reason: 'NODE_ID_INVALID' };
  if (node.enrolled !== true || node.consent !== true) return { eligible: false, reason: 'EXPLICIT_ENROLLMENT_REQUIRED' };
  if (node.authenticated !== true) return { eligible: false, reason: 'NODE_AUTHENTICATION_REQUIRED' };
  if (String(node.state || '').toUpperCase() !== 'READY') return { eligible: false, reason: 'NODE_NOT_READY' };
  if (!Array.isArray(node.capabilities)) return { eligible: false, reason: 'NODE_CAPABILITIES_INVALID' };

  const heartbeat = Date.parse(node.heartbeat_at);
  if (!Number.isFinite(heartbeat) || heartbeat > now) return { eligible: false, reason: 'HEARTBEAT_INVALID' };
  const ageSeconds = (now - heartbeat) / 1000;
  const maxAge = heartbeatLimit(node, defaults);
  if (ageSeconds > maxAge) return { eligible: false, reason: 'HEARTBEAT_STALE', age_seconds: ageSeconds, max_age_seconds: maxAge };

  if (!finite(node.cpu_cores) || node.cpu_cores < task.min_cpu_cores) return { eligible: false, reason: 'INSUFFICIENT_CPU' };
  if (!finite(node.memory_mb) || node.memory_mb < task.min_memory_mb) return { eligible: false, reason: 'INSUFFICIENT_MEMORY' };
  if (!Number.isInteger(node.available_slots) || node.available_slots < 1) return { eligible: false, reason: 'NO_FREE_EXECUTION_SLOT' };
  if (!finite(node.cost_per_hour_usd) || node.cost_per_hour_usd < 0) return { eligible: false, reason: 'COST_UNVERIFIED' };

  const missing = requiredCapabilities(task).filter(capability => !node.capabilities.includes(capability));
  if (missing.length) return { eligible: false, reason: 'CAPABILITY_NOT_CONFIRMED', missing_capabilities: missing };
  if (task.workload === 'BROWSER_SESSION' && node.encrypted_session_store !== true) {
    return { eligible: false, reason: 'ENCRYPTED_SESSION_STORE_REQUIRED' };
  }

  const reliability = finite(node.reliability_score)
    ? Math.max(0, Math.min(1, node.reliability_score))
    : 0.5;
  return {
    eligible: true,
    node,
    heartbeat_age_seconds: ageSeconds,
    capacity_weight: node.cpu_cores * node.available_slots,
    reliability_score: reliability,
    cost_per_hour_usd: node.cost_per_hour_usd,
  };
}

function stableShardKey(base, index) {
  return `midad-shard:${hash(`${base}:${index}`).slice(0, 40)}`;
}

/**
 * Compile a zero-trust, zero-default-spend execution plan. This function is
 * deliberately a planner only: a separate trusted dispatcher must re-check
 * live readiness and acquire an atomic lease before performing any work.
 */
export function planContinuityTask(task, nodes, options = {}) {
  const taskId = isRecord(task) && validId(task.task_id) ? task.task_id : null;
  if (!isRecord(task)) return blocked('TASK_CONTRACT_INVALID');
  if (!taskId) return blocked('TASK_ID_REQUIRED');
  if (!validId(task.idempotency_key) || task.idempotency_key.length < 8) {
    return blocked('IDEMPOTENCY_KEY_REQUIRED', taskId);
  }
  if (!WORKLOADS.has(task.workload)) return blocked('WORKLOAD_UNSUPPORTED', taskId);
  if (!Array.isArray(nodes)) return blocked('NODE_REGISTRY_INVALID', taskId);

  const units = Number.isInteger(task.units) && task.units > 0 && task.units <= 1_000_000
    ? task.units
    : null;
  const secondsPerUnit = finite(task.estimated_seconds_per_unit) && task.estimated_seconds_per_unit > 0
    ? task.estimated_seconds_per_unit
    : null;
  const maxCost = finite(task.max_cost_usd) && task.max_cost_usd >= 0 ? task.max_cost_usd : 0;
  const minMemory = finite(task.min_memory_mb) && task.min_memory_mb >= 0 ? task.min_memory_mb : 0;
  const minCpu = finite(task.min_cpu_cores) && task.min_cpu_cores >= 0 ? task.min_cpu_cores : 0;
  if (units === null || secondsPerUnit === null) return blocked('TASK_RESOURCE_ESTIMATE_INVALID', taskId);

  const now = options.now === undefined ? Date.now() : Date.parse(options.now) || Number(options.now);
  if (!Number.isFinite(now)) return blocked('PLANNER_CLOCK_INVALID', taskId);
  const defaults = {
    maxPersistentHeartbeatSeconds: 45,
    maxEphemeralHeartbeatSeconds: 300,
  };
  const preparedTask = { ...task, units, min_memory_mb: minMemory, min_cpu_cores: minCpu };
  const assessed = nodes.map(node => assessNode(node, preparedTask, now, defaults));
  const eligible = assessed.filter(result => result.eligible);
  if (!eligible.length) {
    const reasons = [...new Set(assessed.map(result => result.reason).filter(Boolean))];
    return blocked('NO_ELIGIBLE_EXECUTOR', taskId, { rejected_node_reasons: reasons });
  }

  const allowSharding = task.workload === 'CPU_BATCH' || task.workload === 'WEBGPU_BATCH'
    ? task.allow_sharding === true
    : false;
  const shardSize = Number.isInteger(task.shard_size) && task.shard_size > 0 ? task.shard_size : 1;
  const maxShards = Number.isInteger(task.max_shards) && task.max_shards > 0
    ? Math.min(256, task.max_shards)
    : 64;
  const shardCount = allowSharding ? Math.min(maxShards, Math.ceil(units / shardSize)) : 1;

  // Metered nodes are never used as an implicit fallback: each candidate must
  // fit the caller's total-task ceiling before it can receive any shard.
  const costEligible = eligible.filter(candidate => {
    const wholeTaskCost = candidate.cost_per_hour_usd * units * secondsPerUnit / 3600;
    return wholeTaskCost <= maxCost;
  });
  if (!costEligible.length) return blocked('COST_CEILING_EXCEEDED', taskId, {
    max_cost_usd: maxCost,
    dispatch_allowed: false,
  });

  const assignedUnits = new Map(costEligible.map(candidate => [candidate.node.id, 0]));
  const sorted = [...costEligible].sort((a, b) =>
    a.cost_per_hour_usd - b.cost_per_hour_usd ||
    b.reliability_score - a.reliability_score ||
    b.capacity_weight - a.capacity_weight ||
    a.node.id.localeCompare(b.node.id)
  );

  const ranges = [];
  if (shardCount === 1) {
    ranges.push({ start: 0, end: units });
  } else {
    const base = Math.floor(units / shardCount);
    const remainder = units % shardCount;
    let cursor = 0;
    for (let index = 0; index < shardCount; index += 1) {
      const size = base + (index < remainder ? 1 : 0);
      ranges.push({ start: cursor, end: cursor + size });
      cursor += size;
    }
  }

  const assignments = ranges.map((range, index) => {
    const candidates = [...sorted].sort((a, b) => {
      const loadA = assignedUnits.get(a.node.id) / a.capacity_weight;
      const loadB = assignedUnits.get(b.node.id) / b.capacity_weight;
      return a.cost_per_hour_usd - b.cost_per_hour_usd ||
        loadA - loadB ||
        b.reliability_score - a.reliability_score ||
        a.node.id.localeCompare(b.node.id);
    });
    const selected = candidates[0];
    const assigned = range.end - range.start;
    assignedUnits.set(selected.node.id, assignedUnits.get(selected.node.id) + assigned);
    return {
      shard_id: `${taskId}:shard:${index}`,
      idempotency_key: stableShardKey(task.idempotency_key, index),
      node_id: selected.node.id,
      unit_start: range.start,
      unit_end: range.end,
      checkpoint_key: `${taskId}:checkpoint:${index}`,
      estimated_cost_usd: Number((selected.cost_per_hour_usd * assigned * secondsPerUnit / 3600).toFixed(8)),
    };
  });

  const totalCost = Number(assignments.reduce((sum, assignment) => sum + assignment.estimated_cost_usd, 0).toFixed(8));
  if (totalCost > maxCost) return blocked('COST_CEILING_EXCEEDED', taskId, { max_cost_usd: maxCost });

  const ttl = Number.isInteger(options.leaseTtlSeconds)
    ? Math.max(15, Math.min(300, options.leaseTtlSeconds))
    : 90;
  return {
    status: 'PLAN_READY',
    reason: 'CONSENTED_CAPABILITY_MATCH_WITHIN_BUDGET',
    task_id: taskId,
    workload: task.workload,
    shardable: allowSharding,
    assignments,
    selected_nodes: [...new Set(assignments.map(item => item.node_id))],
    estimated_cost_usd: totalCost,
    recovery: {
      retry_mode: 'AT_LEAST_ONCE_IDEMPOTENT',
      max_attempts: 3,
      checkpointing: {
        enabled: true,
        checkpoint_after_each_shard: true,
        store: 'EXTERNAL_DURABLE_LEDGER_REQUIRED',
      },
      lease: {
        ttl_seconds: ttl,
        renew_before_seconds: Math.max(5, Math.floor(ttl / 3)),
        reclaim_after_expiry: true,
      },
      on_worker_loss: 'REQUEUE_UNFINISHED_SHARDS_AFTER_LEASE_EXPIRY',
      unknown_external_side_effect: 'HUMAN_RECONCILIATION_REQUIRED',
    },
    dispatch_allowed: false,
    execution_performed: false,
  };
}
