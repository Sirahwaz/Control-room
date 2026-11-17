const SOURCES = new Set([
  'midad_forge',
  'midad_browser_agent_gateway',
  'midad_revenue_intel_work_queue',
  'midad_autonomy_loop',
  'midad_opportunity_engine',
  'midad_orchestrator',
  'midad_omni_agent_gateway',
  'midad_research_center',
]);
const WORKLOADS = new Set(['CPU_BATCH', 'WEBGPU_BATCH', 'BROWSER_SESSION', 'SINGLE']);
const DATA_CLASSES = new Set(['public', 'internal']);
const SENSITIVE_KEY = /(?:secret|token|password|private[_-]?key|mnemonic|seed|authorization|cookie|credential|otp|refresh)/i;
const SENSITIVE_VALUE = [
  /\b(?:sk-or-|sk-)[A-Za-z0-9_-]{20,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
const ALLOWED_FIELDS = new Set([
  'schema_version', 'task_id', 'source_system', 'source_mission_id', 'idempotency_key',
  'workload', 'required_capabilities', 'payload', 'data_class', 'policy_ref',
  'evidence_requirements', 'units', 'estimated_seconds_per_unit', 'max_cost_usd',
  'min_cpu_cores', 'min_memory_mb', 'max_attempts',
]);
const fail = error => ({ ok: false, error });
const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const validToken = value => typeof value === 'string' && /^[a-z0-9][a-z0-9._:-]{0,79}$/.test(value);
const finiteNonNegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function containsSensitive(value, depth = 0) {
  if (depth > 12) return true;
  if (Array.isArray(value)) return value.some(item => containsSensitive(item, depth + 1));
  if (typeof value === 'string') return SENSITIVE_VALUE.some(pattern => pattern.test(value));
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => SENSITIVE_KEY.test(key) || containsSensitive(child, depth + 1));
}

/**
 * Convert a source-owned mission into the existing Continuity Ledger task shape.
 * ownerId, retrySafety and costApprovalRef are trusted adapter context, never task fields.
 * This is a pure contract mapper; it does not authenticate, enqueue or execute work.
 */
export function buildContinuityTask(input, context = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('TASK_ENVELOPE_INVALID');
  if (Object.keys(input).some(key => !ALLOWED_FIELDS.has(key))) return fail('TASK_FIELD_UNKNOWN');

  const ownerId = context.ownerId;
  if (!validId(ownerId)) return fail('TRUSTED_OWNER_REQUIRED');
  if (input.schema_version !== 1) return fail('TASK_SCHEMA_UNSUPPORTED');
  if (typeof input.source_system !== 'string' || !SOURCES.has(input.source_system)) return fail('SOURCE_SYSTEM_UNSUPPORTED');
  if (!validId(input.source_mission_id)) return fail('SOURCE_MISSION_ID_INVALID');
  const sourcePrefix = input.source_system + ':' + input.source_mission_id + ':';
  if (!validId(input.task_id) || !input.task_id.startsWith(sourcePrefix)) return fail('TASK_ID_NOT_SOURCE_SCOPED');
  if (typeof input.idempotency_key !== 'string' || input.idempotency_key.length < 8 || input.idempotency_key.length > 200 ||
      !input.idempotency_key.startsWith(sourcePrefix)) return fail('IDEMPOTENCY_KEY_NOT_SOURCE_SCOPED');
  if (!WORKLOADS.has(input.workload)) return fail('WORKLOAD_UNSUPPORTED');
  if (!DATA_CLASSES.has(input.data_class)) return fail('DATA_CLASS_UNSUPPORTED');
  if (typeof input.policy_ref !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.policy_ref)) return fail('POLICY_REF_INVALID');

  if (!Array.isArray(input.required_capabilities) || input.required_capabilities.length > 32 ||
      input.required_capabilities.some(item => !validToken(item)) ||
      new Set(input.required_capabilities).size !== input.required_capabilities.length) return fail('TASK_CAPABILITIES_INVALID');
  if (!Array.isArray(input.evidence_requirements) || input.evidence_requirements.length > 16 ||
      input.evidence_requirements.some(item => !validToken(item)) ||
      new Set(input.evidence_requirements).size !== input.evidence_requirements.length) return fail('TASK_EVIDENCE_REQUIREMENTS_INVALID');
  if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) return fail('TASK_PAYLOAD_INVALID');
  if (Object.hasOwn(input.payload, '_midad_fabric')) return fail('TASK_PAYLOAD_RESERVED_FIELD');
  if (containsSensitive(input.payload)) return fail('TASK_PAYLOAD_SENSITIVE');
  let payloadBytes;
  try { payloadBytes = new TextEncoder().encode(JSON.stringify(input.payload)).byteLength; }
  catch { return fail('TASK_PAYLOAD_INVALID'); }
  if (payloadBytes > 48 * 1024) return fail('TASK_PAYLOAD_TOO_LARGE');

  const units = input.units;
  const seconds = input.estimated_seconds_per_unit;
  const cost = input.max_cost_usd;
  const cpu = input.min_cpu_cores ?? 0;
  const memory = input.min_memory_mb ?? 0;
  const attempts = input.max_attempts ?? 3;
  if (!Number.isInteger(units) || units < 1 || units > 1_000_000 ||
      !finiteNonNegative(seconds) || seconds <= 0 || seconds > 86_400 ||
      !finiteNonNegative(cost) || cost > 1_000_000 ||
      !finiteNonNegative(cpu) || cpu > 256 ||
      !Number.isInteger(memory) || memory < 0 || memory > 1_048_576 ||
      !Number.isInteger(attempts) || attempts < 1 || attempts > 3) return fail('TASK_LIMIT_INVALID');
  if (cost > 0 && (context.costApprovalVerified !== true || typeof context.costApprovalRef !== 'string' || !validId(context.costApprovalRef))) {
    return fail('TASK_COST_APPROVAL_REQUIRED');
  }

  const retrySafety = context.retrySafety === 'verified_idempotent' ? 'verified_idempotent' : 'human_reconciliation';
  const retryMode = input.workload !== 'BROWSER_SESSION' && retrySafety === 'verified_idempotent' && context.idempotencyVerified === true
    ? 'AT_LEAST_ONCE_IDEMPOTENT'
    : 'HUMAN_RECONCILIATION';
  const sourceMetadata = Object.freeze({
    schema_version: 1,
    source_system: input.source_system,
    source_mission_id: input.source_mission_id,
    data_class: input.data_class,
    policy_ref: input.policy_ref,
    evidence_requirements: Object.freeze([...input.evidence_requirements]),
  });
  const task = Object.freeze({
    task_id: input.task_id,
    owner_id: ownerId,
    idempotency_key: input.idempotency_key,
    payload: Object.freeze({ ...input.payload, _midad_fabric: sourceMetadata }),
    workload: input.workload,
    required_capabilities: Object.freeze([...input.required_capabilities]),
    min_cpu_cores: cpu,
    min_memory_mb: memory,
    units,
    estimated_seconds_per_unit: seconds,
    max_cost_usd: cost,
    retry_mode: retryMode,
    max_attempts: attempts,
  });
  return { ok: true, task, source: sourceMetadata };
}

export const FABRIC_TASK_V1 = Object.freeze({
  schemaVersion: 1,
  sources: Object.freeze([...SOURCES]),
  workloads: Object.freeze([...WORKLOADS]),
  dataClasses: Object.freeze([...DATA_CLASSES]),
  maxAttempts: 3,
  maxPayloadBytes: 48 * 1024,
});
