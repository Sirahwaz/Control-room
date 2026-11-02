import { assertEquals } from "jsr:@std/assert@1";
import { evaluateSolanaReceiptReadiness } from "./route-policy.ts";

Deno.test("fails closed when the token account is absent even if verifier and scan are ready", () => {
  assertEquals(evaluateSolanaReceiptReadiness({
    paymentVerifierReady: true,
    signatureScanComplete: true,
    tokenAccountCount: 0,
  }), {
    stateStatus: "NO_TOKEN_ACCOUNT",
    paymentReconciliationReady: false,
    senderAtaCreationSupported: false,
    readinessReason: "token_account_missing",
  });
});

Deno.test("sender ATA support is not a substitute for an owner token account", () => {
  const result = evaluateSolanaReceiptReadiness({
    paymentVerifierReady: true,
    signatureScanComplete: true,
    tokenAccountCount: 0,
    senderAtaCreationSupported: true,
  });
  assertEquals(result.stateStatus, "NO_TOKEN_ACCOUNT");
  assertEquals(result.paymentReconciliationReady, false);
  assertEquals(result.senderAtaCreationSupported, true);
});

Deno.test("requires verifier, complete signature scan, and at least one token account", () => {
  assertEquals(evaluateSolanaReceiptReadiness({
    paymentVerifierReady: true,
    signatureScanComplete: true,
    tokenAccountCount: 1,
  }), {
    stateStatus: "VERIFIED",
    paymentReconciliationReady: true,
    senderAtaCreationSupported: false,
    readinessReason: null,
  });
});

Deno.test("fails closed when verifier is unavailable", () => {
  const result = evaluateSolanaReceiptReadiness({
    paymentVerifierReady: false,
    signatureScanComplete: true,
    tokenAccountCount: 1,
  });
  assertEquals(result.stateStatus, "DEGRADED");
  assertEquals(result.paymentReconciliationReady, false);
  assertEquals(result.readinessReason, "strict_payment_verifier_not_ready");
});

Deno.test("fails closed when signature scanning is incomplete", () => {
  const result = evaluateSolanaReceiptReadiness({
    paymentVerifierReady: true,
    signatureScanComplete: false,
    tokenAccountCount: 1,
  });
  assertEquals(result.stateStatus, "DEGRADED");
  assertEquals(result.paymentReconciliationReady, false);
  assertEquals(result.readinessReason, "signature_scan_incomplete");
});
