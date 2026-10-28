/** Pure provider cooldown decision. No network, database, or external side effects. */
export const PROVIDER_COOLDOWN_MS = 30 * 60 * 1000;

const TRANSIENT_NETWORK_FAILURE = /(?:dns error|failed to lookup address information|name or service not known|enotfound|eai_again|econnreset|econnrefused|network is unreachable|connect timeout|connection refused|connection reset)/i;

/**
 * Return the UTC time when a provider can be retried after a recent network failure.
 * A null result means no cooldown applies. The caller should pass a recent failure
 * record for the same provider; semantic/payout blockers must never open the circuit.
 */
export function providerCooldownUntil({ sourceSlug, lastFailure, nowMs = Date.now(), cooldownMs = PROVIDER_COOLDOWN_MS } = {}) {
  if (!String(sourceSlug || '').trim() || !lastFailure || !TRANSIENT_NETWORK_FAILURE.test(String(lastFailure.blocker || ''))) return null;
  const failedAt = Date.parse(String(lastFailure.failed_at ?? lastFailure.updated_at ?? ''));
  if (!Number.isFinite(failedAt) || !Number.isFinite(nowMs) || !Number.isFinite(cooldownMs) || cooldownMs <= 0) return null;
  const age = nowMs - failedAt;
  if (age < 0 || age >= cooldownMs) return null;
  return new Date(failedAt + cooldownMs).toISOString();
}
