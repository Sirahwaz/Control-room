import { classifySpeedbotRequest } from "./midad-speedbot-matching.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("matches a bounded crypto-paid automation task", () => {
  const result = classifySpeedbotRequest(
    "We need paid work from an API automation agent. Budget of 20 USDC; payout terms are public. No upfront payment is required."
  );
  assert(result.wantsPaidWorker, "expected paid-work match");
  assert(result.cryptoAndSettlement, "expected explicit crypto settlement");
  assert(!result.noPaymentIntent, "no upfront payment is not the same as no payment intent");
});

Deno.test("recognizes a published-service field-test request", () => {
  const result = classifySpeedbotRequest(
    "We need an independent field tester for our published service. This is a no-payment test; no purchase is required."
  );
  assert(result.seeksTester, "expected field-test match");
  assert(result.noPaymentIntent, "expected no-payment guard");
  assert(!result.cryptoAndSettlement, "field test must not be classified as paid crypto work");
});

Deno.test("rejects an unrelated crypto mention as paid work", () => {
  const result = classifySpeedbotRequest(
    "Our community discusses USDC and stablecoins, but no task, budget, or payout is offered."
  );
  assert(!result.wantsPaidWorker, "must not match an unrelated mention");
  assert(!result.cryptoAndSettlement, "must not classify discussion as a paid opportunity");
});

Deno.test("honors the explicit no-payment guard", () => {
  const result = classifySpeedbotRequest(
    "Paid work for an API agent, budget of 20 USDC, payout terms published; no paid order."
  );
  assert(result.wantsPaidWorker, "phrase may match, but must not authorize response");
  assert(result.noPaymentIntent, "expected explicit no-payment guard");
  assert(!result.cryptoAndSettlement, "no-payment guard must veto paid-path classification");
});
