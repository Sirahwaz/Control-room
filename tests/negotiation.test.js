import test from 'node:test';
import assert from 'node:assert/strict';
import { selectNegotiableCryptoRoutes, classifyPaymentIntent, classifyClientFallback, buildPaymentIntentApprovalEvidence, paymentIntentCreationDecision, paymentRouteReadinessDecision } from '../supabase/functions/midad_client_gateway/negotiation.js';
const base = {
  id: 'route-base', label: 'Base USDC', asset: 'USDC', network: 'base',
  route_kind: 'receive', active: true, auto_route: true, requires_approval: false,
  metadata: { canonical: true, verification: { token_contract: '0x833589fCD6eDb6E08f4c7C32D4F71b54bdA02913' } },
  monitor: { status: 'VERIFIED', last_scan_at: '2026-11-07T10:00:00.000Z', metadata: { scan_caught_up: true, payment_reconciliation_ready: true, token_contract: '0x833589fCD6eDb6E08f4c7C32D4F71b54bdA02913' } }
};
test('allows only fresh, caught-up, independently reconcilable supported rails', () => {
  const routes = selectNegotiableCryptoRoutes([base], Date.parse('2026-11-07T10:05:00.000Z'));
  assert.equal(routes.length, 1);
  assert.deepEqual(routes[0], { asset: 'USDC', network: 'base', label: 'Base USDC', requires_approval: false, auto_route: true, requires_customer_token_account_setup: false, readiness: 'verified' });
});
test('rejects stale monitors', () => assert.equal(selectNegotiableCryptoRoutes([base], Date.parse('2026-11-07T10:11:00.000Z')).length, 0));
test('rejects routes not caught up or not ready for reconciliation', () => {
  const route = structuredClone(base); route.monitor.metadata.scan_caught_up = false; route.monitor.metadata.payment_reconciliation_ready = false;
  assert.equal(selectNegotiableCryptoRoutes([route], Date.parse('2026-11-07T10:05:00.000Z')).length, 0);
});
test('rejects networks unsupported by the payment verifier', () => {
  const route = { ...base, network: 'ethereum', asset: 'USDT' };
  assert.equal(selectNegotiableCryptoRoutes([route], Date.parse('2026-11-07T10:05:00.000Z')).length, 0);
});
test('rejects inactive, non-receive, and unverified routes', () => {
  const inactive = { ...base, active: false }; const outbound = { ...base, route_kind: 'send' };
  const unverified = { ...base, monitor: { ...base.monitor, status: 'DEGRADED' } };
  assert.equal(selectNegotiableCryptoRoutes([inactive, outbound, unverified], Date.parse('2026-11-07T10:05:00.000Z')).length, 0);
});
test('keeps manual-approval routes clearly marked rather than treating them as autonomous', () => {
  const route = { ...base, auto_route: false, requires_approval: true };
  const result = selectNegotiableCryptoRoutes([route], Date.parse('2026-11-07T10:05:00.000Z'));
  assert.equal(result[0].requires_approval, true); assert.equal(result[0].auto_route, false);
});
test('classifies English crypto payment negotiation as an approval-gated payment question', () => {
  assert.deepEqual(classifyPaymentIntent('Can I pay in USDC on Base?'), { intent: 'payment_question', risk_class: 'medium' });
});
test('classifies Arabic crypto payment questions safely', () => {
  assert.deepEqual(classifyPaymentIntent('هل يمكن الدفع بالعملات الرقمية؟'), { intent: 'payment_question', risk_class: 'medium' });
});
test('does not misclassify unrelated messages as payment questions', () => {
  assert.equal(classifyPaymentIntent('Please send the project update'), null);
});
test('discount negotiation takes precedence over crypto payment wording', () => {
  assert.deepEqual(classifyClientFallback('Can you give me a discount if I pay in USDC?'), { intent: 'discount', risk_class: 'high' });
});
test('scope changes take precedence over crypto payment wording', () => {
  assert.deepEqual(classifyClientFallback('Add one more feature and I will pay in crypto'), { intent: 'scope_change', risk_class: 'high' });
});
test('refund and legal terms remain critical even when payment is mentioned', () => {
  assert.deepEqual(classifyClientFallback('I want a refund for the payment'), { intent: 'legal', risk_class: 'critical' });
});

test('allows a Solana route awaiting its first token account only when sender ATA setup and verifier readiness are confirmed', () => {
  const route = {
    ...base, asset: 'USDC', network: 'solana', auto_route: false, requires_approval: true,
    metadata: { canonical: true, verification: { token_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' } },
    monitor: { status: 'READY_AWAITING_FIRST_TOKEN_ACCOUNT', last_scan_at: '2026-11-07T10:00:00.000Z',
      metadata: { payment_reconciliation_ready: true, sender_ata_creation_supported: true, token_accounts: 0,
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' } }
  };
  const result = selectNegotiableCryptoRoutes([route], Date.parse('2026-11-07T10:05:00.000Z'));
  assert.equal(result.length, 1);
  assert.equal(result[0].requires_approval, true);
  assert.equal(result[0].requires_customer_token_account_setup, true);
  assert.equal(result[0].readiness, 'sender_ata_setup_required');
});
test('rejects a pending Solana route unless both verifier readiness and sender ATA support are true', () => {
  const route = {
    ...base, network: 'solana',
    metadata: { canonical: true, verification: { token_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' } },
    monitor: { status: 'READY_AWAITING_FIRST_TOKEN_ACCOUNT', last_scan_at: '2026-11-07T10:00:00.000Z',
      metadata: { payment_reconciliation_ready: true, sender_ata_creation_supported: false, token_accounts: 0,
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' } }
  };
  assert.equal(selectNegotiableCryptoRoutes([route], Date.parse('2026-11-07T10:05:00.000Z')).length, 0);
});
test('does not expose a non-canonical pending Solana asset route', () => {
  const route = {
    ...base, asset: 'EURC', network: 'solana',
    metadata: { canonical: false, verification: { token_mint: 'HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr' } },
    monitor: { status: 'READY_AWAITING_FIRST_TOKEN_ACCOUNT', last_scan_at: '2026-11-07T10:00:00.000Z',
      metadata: { payment_reconciliation_ready: true, sender_ata_creation_supported: true, token_accounts: 0,
        mint: 'HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr' } }
  };
  assert.equal(selectNegotiableCryptoRoutes([route], Date.parse('2026-11-07T10:05:00.000Z')).length, 0);
});

test('rejects payment-intent creation without a valid owner approval reference', () => {
  for (const input of [
    { amount_fiat: 100, fiat_currency: 'USD', settlement_asset: 'USDC', network: 'base', wallet_address: 'attacker-controlled' },
    { amount_fiat: 1, approval_id: 'some-id', decision: 'approved' },
    { amount_fiat: 1, wallet_address: 'any-address', quoted_crypto_amount: 1, route_id: 'some-route' }
  ]) {
    assert.deepEqual(paymentIntentCreationDecision(input), {
      allowed: false,
      http_status: 403,
      error: 'payment_intent_approval_id_required'
    });
  }
});

test('builds a bounded approval record for an exact supported crypto quote', () => {
  const evidence = buildPaymentIntentApprovalEvidence({
    route_id: '09efe2ac-e20d-4c72-9b68-0a5b8031bdf3',
    client_id: '11111111-1111-4111-8111-111111111111',
    conversation_id: '22222222-2222-4222-8222-222222222222',
    agreement_message_id: '33333333-3333-4333-8333-333333333333',
    amount_fiat: '125.50', fiat_currency: 'USD',
    settlement_asset: 'USDC', network: 'solana',
    quoted_crypto_amount: '125.5', fx_rate: '1',
    quote_source: 'owner-approved-quote', expires_in_minutes: 30
  }, Date.parse('2026-11-07T12:00:00.000Z'));
  assert.deepEqual(evidence, {
    route_id: '09efe2ac-e20d-4c72-9b68-0a5b8031bdf3',
    amount_fiat: 125.5, fiat_currency: 'USD',
    settlement_asset: 'USDC', network: 'solana',
    quoted_crypto_amount: 125.5, fx_rate: 1,
    quote_source: 'owner-approved-quote',
    client_id: '11111111-1111-4111-8111-111111111111',
    conversation_id: '22222222-2222-4222-8222-222222222222',
    agreement_message_id: '33333333-3333-4333-8333-333333333333',
    expires_at: '2026-11-07T12:30:00.000Z'
  });
});

test('rejects unsupported rails, invalid amounts, incomplete quotes, and malformed route ids', () => {
  for (const input of [
    { route_id: 'bad', client_id: '11111111-1111-4111-8111-111111111111', conversation_id: '22222222-2222-4222-8222-222222222222', agreement_message_id: '33333333-3333-4333-8333-333333333333', amount_fiat: 10, fiat_currency: 'USD', settlement_asset: 'USDC', network: 'base', quoted_crypto_amount: 10, fx_rate: 1, quote_source: 'test' },
    { route_id: '09efe2ac-e20d-4c72-9b68-0a5b8031bdf3', client_id: '11111111-1111-4111-8111-111111111111', conversation_id: '22222222-2222-4222-8222-222222222222', agreement_message_id: '33333333-3333-4333-8333-333333333333', amount_fiat: 0, fiat_currency: 'USD', settlement_asset: 'USDC', network: 'base', quoted_crypto_amount: 10, fx_rate: 1, quote_source: 'test' },
    { route_id: '09efe2ac-e20d-4c72-9b68-0a5b8031bdf3', client_id: '11111111-1111-4111-8111-111111111111', conversation_id: '22222222-2222-4222-8222-222222222222', agreement_message_id: '33333333-3333-4333-8333-333333333333', amount_fiat: 10, fiat_currency: 'USD', settlement_asset: 'USDT', network: 'base', quoted_crypto_amount: 10, fx_rate: 1, quote_source: 'test' },
    { route_id: '09efe2ac-e20d-4c72-9b68-0a5b8031bdf3', client_id: '11111111-1111-4111-8111-111111111111', conversation_id: '22222222-2222-4222-8222-222222222222', agreement_message_id: '33333333-3333-4333-8333-333333333333', amount_fiat: 10, fiat_currency: 'USD', settlement_asset: 'USDC', network: 'base', quoted_crypto_amount: 10, quote_source: 'test' },
    { route_id: '09efe2ac-e20d-4c72-9b68-0a5b8031bdf3', client_id: '11111111-1111-4111-8111-111111111111', conversation_id: '22222222-2222-4222-8222-222222222222', agreement_message_id: '33333333-3333-4333-8333-333333333333', amount_fiat: 10, fiat_currency: 'USD', settlement_asset: 'EURC', network: 'solana', quoted_crypto_amount: 10, fx_rate: 1, quote_source: 'test' }
  ]) assert.throws(() => buildPaymentIntentApprovalEvidence(input), /payment_intent_request_invalid/);
});

test('payment intent creation accepts only an approval UUID and ignores caller-supplied payment terms', () => {
  assert.deepEqual(paymentIntentCreationDecision({ amount_fiat: 999, wallet_address: 'attacker' }), {
    allowed: false, http_status: 403, error: 'payment_intent_approval_id_required'
  });
  assert.deepEqual(paymentIntentCreationDecision({ approval_id: 'not-a-uuid', amount_fiat: 999 }), {
    allowed: false, http_status: 403, error: 'payment_intent_approval_id_required'
  });
  assert.deepEqual(paymentIntentCreationDecision({
    approval_id: '09efe2ac-e20d-4c72-9b68-0a5b8031bdf3',
    amount_fiat: 999, wallet_address: 'attacker', network: 'attacker-chain'
  }), { allowed: true });
});

test('requires an exact inbound customer-agreement message reference', () => {
  const { agreement_message_id, ...withoutAgreement } = {
    route_id: '09efe2ac-e20d-4c72-9b68-0a5b8031bdf3',
    client_id: '11111111-1111-4111-8111-111111111111',
    conversation_id: '22222222-2222-4222-8222-222222222222',
    agreement_message_id: '33333333-3333-4333-8333-333333333333',
    amount_fiat: 10, fiat_currency: 'USD', settlement_asset: 'USDC', network: 'base',
    quoted_crypto_amount: 10, fx_rate: 1, quote_source: 'owner-approved-quote'
  };
  assert.throws(() => buildPaymentIntentApprovalEvidence(withoutAgreement), /payment_intent_request_invalid/);
});

test('requires a fully verified live receive route before opening a payment approval', () => {
  const now = Date.parse('2026-11-07T12:05:00.000Z');
  const baseRoute = {
    id: '09efe2ac-e20d-4c72-9b68-0a5b8031bdf3', asset: 'USDC', network: 'base',
    route_kind: 'receive', active: true,
    metadata: { canonical: true, verification: { token_contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' } }
  };
  const baseMonitor = {
    status: 'VERIFIED', last_scan_at: '2026-11-07T12:00:00.000Z',
    metadata: { token_contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', scan_caught_up: true, payment_reconciliation_ready: true }
  };
  assert.deepEqual(paymentRouteReadinessDecision(baseRoute, baseMonitor, now), { ready: true });
  assert.equal(paymentRouteReadinessDecision(baseRoute, { ...baseMonitor, metadata: { ...baseMonitor.metadata, scan_caught_up: false } }, now).ready, false);
  assert.equal(paymentRouteReadinessDecision(baseRoute, { ...baseMonitor, last_scan_at: '2026-11-07T11:00:00.000Z' }, now).ready, false);
  const solRoute = { ...baseRoute, asset: 'USDC', network: 'solana', metadata: { canonical: true, verification: { token_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' } } };
  const pendingSol = { status: 'READY_AWAITING_FIRST_TOKEN_ACCOUNT', last_scan_at: '2026-11-07T12:00:00.000Z', metadata: { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', payment_reconciliation_ready: true, sender_ata_creation_supported: true, token_accounts: 0 } };
  assert.equal(paymentRouteReadinessDecision(solRoute, pendingSol, now).ready, false);
  const verifiedSol = { ...pendingSol, status: 'VERIFIED', metadata: { ...pendingSol.metadata, token_accounts: 1 } };
  assert.deepEqual(paymentRouteReadinessDecision(solRoute, verifiedSol, now), { ready: true });
  assert.equal(paymentRouteReadinessDecision(solRoute, { ...verifiedSol, metadata: { ...verifiedSol.metadata, mint: 'epjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' } }, now).ready, false);
});
