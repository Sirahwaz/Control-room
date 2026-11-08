const SUPPORTED_VERIFIER_RAILS = new Set([
  'base:USDC', 'solana:USDC', 'solana:USDT', 'solana:EURC',
]);
const asObject = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
export function selectNegotiableCryptoRoutes(rows, now = Date.now(), maxAgeMs = 10 * 60 * 1000) {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const route = asObject(row);
    const monitor = asObject(route.monitor);
    const monitorMeta = asObject(monitor.metadata);
    const routeMeta = asObject(route.metadata);
    const verification = asObject(routeMeta.verification);
    const asset = String(route.asset || '').toUpperCase();
    const network = String(route.network || '').toLowerCase();
    const scanAt = Date.parse(monitor.last_scan_at || '');
    const fresh = Number.isFinite(scanAt) && scanAt <= now + 30000 && scanAt >= now - maxAgeMs;
    const supported = SUPPORTED_VERIFIER_RAILS.has(network + ':' + asset);
    const tokenExpected = network === 'base' ? String(verification.token_contract || '').toLowerCase() : String(verification.token_mint || '').trim();
    const tokenObserved = network === 'base' ? String(monitorMeta.token_contract || '').toLowerCase() : String(monitorMeta.mint || '').trim();
    const tokenMatches = Boolean(tokenExpected && tokenObserved && tokenExpected === tokenObserved);
    const tokenAccounts = Number(monitorMeta.token_accounts || 0);
    const solanaPendingSetup = network === 'solana'
      && monitor.status === 'READY_AWAITING_FIRST_TOKEN_ACCOUNT'
      && monitorMeta.payment_reconciliation_ready === true
      && monitorMeta.sender_ata_creation_supported === true
      && tokenAccounts === 0;
    const networkReady = network === 'base'
      ? monitorMeta.scan_caught_up === true && monitorMeta.payment_reconciliation_ready === true
      : network === 'solana'
        ? monitorMeta.payment_reconciliation_ready === true && (tokenAccounts > 0 || solanaPendingSetup)
        : false;
    const monitorReady = monitor.status === 'VERIFIED' || solanaPendingSetup;
    const canonical = routeMeta.canonical !== false;
    const eligible = route.active === true && route.route_kind === 'receive' && monitorReady
      && fresh && supported && tokenMatches && networkReady && canonical;
    if (!eligible) return [];
    return [{ asset, network, label: String(route.label || (network + ' ' + asset)).slice(0, 100),
      requires_approval: solanaPendingSetup || route.requires_approval === true || route.auto_route !== true,
      auto_route: route.auto_route === true,
      requires_customer_token_account_setup: solanaPendingSetup,
      readiness: solanaPendingSetup ? 'sender_ata_setup_required' : 'verified' }];
  });
}
export function classifyPaymentIntent(text) {
  const value = String(text || '').toLowerCase();
  if (/pay|payment|paid|دفع|تحويل|محفظة|wallet|usdc|usdt|btc|crypto|cryptocurrency|bitcoin|ethereum|عملة رقمية|العملات الرقمية|كريبتو|بيتكوين|طريقة الدفع|payment method/.test(value)) {
    return { intent: 'payment_question', risk_class: 'medium' };
  }
  return null;
}
export function classifyClientFallback(text) {
  const value = String(text || '').toLowerCase();
  if (/discount|ديسكاونت|خصم|تخفيض|سعر أقل|cheaper/.test(value)) return { intent: 'discount', risk_class: 'high' };
  if (/scope|نطاق|إضافة|اضافة|feature|ميزة|requirement change|تغيير المطلوب/.test(value)) return { intent: 'scope_change', risk_class: 'high' };
  if (/refund|استرداد|legal|عقد|contract|terms|شروط قانونية/.test(value)) return { intent: 'legal', risk_class: 'critical' };
  const payment = classifyPaymentIntent(text);
  if (payment) return payment;
  if (/status|update|تحديث|حالة|where is|أين وصل/.test(value)) return { intent: 'status_request', risk_class: 'low' };
  if (/how|what|can you|هل تستطيع|ما هو|كيف/.test(value)) return { intent: 'faq', risk_class: 'low' };
  return { intent: 'other', risk_class: 'medium' };
}

/**
 * Validates the commercial terms and customer-agreement references before
 * creating a pending owner approval. The database RPC remains authoritative.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAYMENT_RAILS = new Set(['base:USDC', 'solana:USDC', 'solana:USDT']);

export function buildPaymentIntentApprovalEvidence(input, now = Date.now()) {
  const p = asObject(input);
  const routeId = String(p.route_id || '').trim();
  const amount = Number(p.amount_fiat);
  const currency = String(p.fiat_currency || 'USD').trim().toUpperCase();
  const asset = String(p.settlement_asset || '').trim().toUpperCase();
  const network = String(p.network || '').trim().toLowerCase();
  const quoteAmountPresent = p.quoted_crypto_amount !== undefined && p.quoted_crypto_amount !== null && p.quoted_crypto_amount !== '';
  const fxRatePresent = p.fx_rate !== undefined && p.fx_rate !== null && p.fx_rate !== '';
  const quoteAmount = quoteAmountPresent ? Number(p.quoted_crypto_amount) : null;
  const fxRate = fxRatePresent ? Number(p.fx_rate) : null;
  const expiresIn = p.expires_in_minutes === undefined ? 30 : Number(p.expires_in_minutes);
  const clientId = String(p.client_id || '').trim();
  const conversationId = String(p.conversation_id || '').trim();
  const agreementMessageId = String(p.agreement_message_id || '').trim();
  if (!UUID_RE.test(routeId) || !UUID_RE.test(clientId) || !UUID_RE.test(conversationId) || !UUID_RE.test(agreementMessageId)
    || !Number.isFinite(amount) || amount <= 0 || amount > 1000000000
    || !/^[A-Z]{3,10}$/.test(currency) || !PAYMENT_RAILS.has(network + ':' + asset)
    || !quoteAmountPresent || !fxRatePresent
    || !Number.isFinite(quoteAmount) || quoteAmount <= 0 || !Number.isFinite(fxRate) || fxRate <= 0
    || !String(p.quote_source || '').trim()
    || !Number.isInteger(expiresIn) || expiresIn < 5 || expiresIn > 1440) {
    throw new Error('payment_intent_request_invalid');
  }
  const evidence = {
    route_id: routeId,
    amount_fiat: amount,
    fiat_currency: currency,
    settlement_asset: asset,
    network,
    quoted_crypto_amount: quoteAmount,
    fx_rate: fxRate,
    quote_source: String(p.quote_source).trim().slice(0, 120),
    client_id: clientId,
    conversation_id: conversationId,
    agreement_message_id: agreementMessageId,
    expires_at: new Date(now + expiresIn * 60000).toISOString()
  };
  if (p.project_ref) evidence.project_ref = String(p.project_ref).trim().slice(0, 160);
  return evidence;
}

export function paymentIntentCreationDecision(input) {
  const approvalId = String(asObject(input).approval_id || '').trim();
  return UUID_RE.test(approvalId)
    ? { allowed: true }
    : { allowed: false, http_status: 403, error: 'payment_intent_approval_id_required' };
}

const PAYMENT_TOKEN_IDS = {
  'base:USDC': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'solana:USDC': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'solana:USDT': 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
};

export function paymentRouteReadinessDecision(routeInput, monitorInput, now = Date.now()) {
  const route = asObject(routeInput);
  const monitor = asObject(monitorInput);
  const routeMeta = asObject(route.metadata);
  const verification = asObject(routeMeta.verification);
  const monitorMeta = asObject(monitor.metadata);
  const asset = String(route.asset || '').toUpperCase();
  const network = String(route.network || '').toLowerCase();
  const rail = network + ':' + asset;
  const expected = PAYMENT_TOKEN_IDS[rail];
  const lastScan = Date.parse(monitor.last_scan_at || '');
  const fresh = Number.isFinite(lastScan) && lastScan <= now + 30000 && lastScan >= now - 10 * 60 * 1000;
  if (!expected || route.active !== true || route.route_kind !== 'receive' || routeMeta.canonical !== true) {
    return { ready: false, error: 'payment_route_not_eligible' };
  }
  if (monitor.status !== 'VERIFIED' || !fresh) return { ready: false, error: 'payment_monitor_not_fresh_and_verified' };
  if (network === 'base') {
    if (String(verification.token_contract || '').toLowerCase() !== expected.toLowerCase()
      || String(monitorMeta.token_contract || '').toLowerCase() !== expected.toLowerCase()) {
      return { ready: false, error: 'payment_token_contract_mismatch' };
    }
    if (monitorMeta.scan_caught_up !== true || monitorMeta.payment_reconciliation_ready !== true) {
      return { ready: false, error: 'base_payment_reconciliation_not_ready' };
    }
  } else {
    if (String(verification.token_mint || '') !== expected || String(monitorMeta.mint || '') !== expected) {
      return { ready: false, error: 'payment_token_contract_mismatch' };
    }
    if (monitorMeta.payment_reconciliation_ready !== true || Number(monitorMeta.token_accounts || 0) < 1) {
      return { ready: false, error: 'solana_token_account_not_verified' };
    }
  }
  return { ready: true };
}
