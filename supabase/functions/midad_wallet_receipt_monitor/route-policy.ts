export interface ReceiptMonitorRouteCandidate {
  active?: unknown;
  route_kind?: unknown;
  auto_route?: unknown;
  requires_approval?: unknown;
}

export function isReceiptMonitorRouteEligible(
  route: ReceiptMonitorRouteCandidate,
): boolean {
  return route.active === true && route.route_kind === "receive";
}


export interface SolanaReceiptReadinessInput {
  paymentVerifierReady?: unknown;
  signatureScanComplete?: unknown;
  tokenAccountCount?: unknown;
  senderAtaCreationSupported?: unknown;
}

export interface SolanaReceiptReadinessResult {
  stateStatus: "VERIFIED" | "DEGRADED" | "NO_TOKEN_ACCOUNT";
  paymentReconciliationReady: boolean;
  senderAtaCreationSupported: boolean;
  readinessReason: string | null;
}

/**
 * A route is payment-reconciliation-ready only when the strict verifier is
 * available, signature scanning completed, and at least one owner token
 * account exists. Sender-side ATA capability is independent of route readiness.
 */
export function evaluateSolanaReceiptReadiness(
  input: SolanaReceiptReadinessInput,
): SolanaReceiptReadinessResult {
  const paymentVerifierReady = input.paymentVerifierReady === true;
  const signatureScanComplete = input.signatureScanComplete === true;
  const tokenAccountCount = Number(input.tokenAccountCount);
  const hasTokenAccount = Number.isFinite(tokenAccountCount) &&
    tokenAccountCount > 0;
  const senderAtaCreationSupported = input.senderAtaCreationSupported === true;
  const paymentReconciliationReady = paymentVerifierReady &&
    signatureScanComplete && hasTokenAccount;

  const stateStatus: SolanaReceiptReadinessResult["stateStatus"] =
    !hasTokenAccount
      ? "NO_TOKEN_ACCOUNT"
      : paymentReconciliationReady
      ? "VERIFIED"
      : "DEGRADED";

  const readinessReason = !paymentVerifierReady
    ? "strict_payment_verifier_not_ready"
    : !signatureScanComplete
    ? "signature_scan_incomplete"
    : !hasTokenAccount
    ? "token_account_missing"
    : null;

  return {
    stateStatus,
    paymentReconciliationReady,
    senderAtaCreationSupported,
    readinessReason,
  };
}
