import test from 'node:test';
import assert from 'node:assert/strict';
import { providerCooldownUntil, PROVIDER_COOLDOWN_MS } from './provider_circuit_breaker.mjs';

const now = Date.parse('2026-10-28T01:00:00.000Z');

test('opens a bounded cooldown after a recent provider DNS failure', () => {
  assert.equal(providerCooldownUntil({
    sourceSlug: 'bountybook_api',
    lastFailure: { blocker: 'worker_error: DNS error: failed to lookup address information', failed_at: '2026-10-28T00:45:00.000Z' },
    nowMs: now
  }), '2026-10-28T01:15:00.000Z');
});

test('does not trip for a missing task-specific payout proof', () => {
  assert.equal(providerCooldownUntil({
    sourceSlug: 'bountybook_api',
    lastFailure: { blocker: 'task_specific_independent_payout_proof_missing', failed_at: '2026-10-28T00:45:00.000Z' },
    nowMs: now
  }), null);
});

test('lets the provider retry after the cooldown expires', () => {
  assert.equal(providerCooldownUntil({
    sourceSlug: 'bountybook_api',
    lastFailure: { blocker: 'failed to lookup address information: name or service not known', failed_at: new Date(now - PROVIDER_COOLDOWN_MS).toISOString() },
    nowMs: now
  }), null);
});

test('fails open when no source or usable timestamp is present', () => {
  assert.equal(providerCooldownUntil({ sourceSlug: '', lastFailure: { blocker: 'DNS error', failed_at: '2026-10-28T00:45:00.000Z' }, nowMs: now }), null);
  assert.equal(providerCooldownUntil({ sourceSlug: 'bountybook_api', lastFailure: { blocker: 'DNS error', failed_at: 'bad-date' }, nowMs: now }), null);
  assert.equal(providerCooldownUntil({ sourceSlug: 'bountybook_api', lastFailure: { blocker: 'DNS error', failed_at: '2026-10-28T01:01:00.000Z' }, nowMs: now }), null);
});

test('recognizes common transient network failure signatures', () => {
  for (const blocker of [
    'worker_error: DNS error',
    'failed to lookup address information',
    'connect timeout',
    'connection refused',
    'connection reset',
    'ECONNRESET'
  ]) {
    assert.ok(providerCooldownUntil({
      sourceSlug: 'provider_api',
      lastFailure: { blocker, failed_at: '2026-10-28T00:45:00.000Z' },
      nowMs: now
    }), blocker);
  }
});
