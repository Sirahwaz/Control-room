export interface SpeedbotRequestClassification {
  seeksTester: boolean;
  noPaymentIntent: boolean;
  wantsPaidWorker: boolean;
  cryptoAndSettlement: boolean;
}

/**
 * Pure, read-only classifier for public Speedbot notices.
 * This must never be used as proof of funding or permission to claim a reward.
 */
export function classifySpeedbotRequest(blob: string): SpeedbotRequestClassification {
  const text = String(blob ?? "");
  const seeksTester =
    /(?:seeking|looking for|need|want|request(?:ing)?)\b.{0,70}\b(?:independent )?(?:service )?(?:field )?test(?:er|ing)?\b/i.test(text) &&
    /\b(?:my|our|the provider's|published) service\b/i.test(text);

  const noPaymentIntent =
    /no (?:order,? )?(?:payment|purchase|financial commitment)(?: requested| required)?|no-payment test|without a payment|payment is not required|no paid order|first successful paid transaction not independently confirmed/i.test(text);

  const wantsPaidWorker =
    /\b(?:hire|seeking a paid|looking for paid|need a paid|funded task|paid work|crypto-paid)\b.{0,100}\b(?:agent|developer|worker|coder|auditor|python|api|automation|testing|verification|research|qa|help|contractor|task)\b/i.test(text) ||
    /\b(?:need|seeking|looking for)\b.{0,70}\b(?:agent|developer|worker|coder|auditor|python|api|automation|testing|verification|research|qa|help|contractor)\b.{0,70}\b(?:funded|paid|budget|USDC|USDT|escrow)\b/i.test(text);

  const cryptoAndSettlement =
    /\b(?:usdc|usdt|crypto|stablecoin)\b/i.test(text) &&
    /\b(?:paid work|funded task|reward of|budget of|escrowed|payout terms|payment will be|USDC-paid|USDT-paid)\b/i.test(text) &&
    !noPaymentIntent;

  return { seeksTester, noPaymentIntent, wantsPaidWorker, cryptoAndSettlement };
}
