const VALID_MEDIA = new Set(["image", "video", "audio"]);

function normalizedText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function getOpenArtCandidates(catalog, mediaType, ceiling) {
  const models = Array.isArray(catalog?.models) ? catalog.models : [];
  const candidates = [];
  for (const model of models) {
    const modes = Array.isArray(model?.modes?.[mediaType]) ? model.modes[mediaType] : [];
    for (const mode of modes) {
      const cost = finiteNonNegative(mode?.totalCredits);
      if (cost === null) continue;
      candidates.push({
        provider: "openart",
        modelId: String(model.id || ""),
        modelName: String(model.displayName || model.id || "Unknown model"),
        mode: String(mode.mode || ""),
        creditsRequired: cost,
        affordable: mode.affordable === true,
        withinBudget: cost <= ceiling
      });
    }
  }
  return candidates.sort((a, b) => a.creditsRequired - b.creditsRequired || a.modelName.localeCompare(b.modelName));
}

export function planMediaProduction({
  mediaType,
  brief,
  rightsConfirmed = false,
  availableCredits,
  maxCredits,
  openArtCatalog,
  preferredProvider = "openart",
  speechCostQuote = null,
  approvalToSpend = false
} = {}) {
  const type = normalizedText(mediaType).toLowerCase();
  if (!VALID_MEDIA.has(type)) throw new TypeError("UNSUPPORTED_MEDIA_TYPE");
  const contentBrief = normalizedText(brief);
  const balance = finiteNonNegative(availableCredits);
  const ceiling = finiteNonNegative(maxCredits);
  if (balance === null || ceiling === null) {
    return { status: "BLOCKED_COST_BUDGET_UNVERIFIED", mediaType: type, reason: "A verified balance and spend ceiling are required.", executionAllowed: false };
  }
  const spendLimit = Math.min(balance, ceiling);
  if (!contentBrief) return { status: "BLOCKED_MISSING_BRIEF", mediaType: type, spendLimit, executionAllowed: false };
  if (rightsConfirmed !== true) return { status: "BLOCKED_RIGHTS_CONFIRMATION", mediaType: type, spendLimit, executionAllowed: false };

  if (type === "audio") {
    const quote = speechCostQuote;
    const quoteAmount = finiteNonNegative(quote?.amount);
    const quotaAvailable = finiteNonNegative(quote?.availableUnits);
    const quoteUnit = normalizedText(quote?.unit);
    const quoteVerified = quote?.verified === true && quoteAmount !== null && quotaAvailable !== null && !!quoteUnit;
    if (!quoteVerified) {
      return { status: "BLOCKED_AUDIO_COST_UNVERIFIED", mediaType: type, provider: "heygen", spendLimit, voiceCatalogAvailable: true, executionAllowed: false };
    }
    if (quoteAmount > quotaAvailable) {
      return { status: "BLOCKED_PROVIDER_QUOTA", mediaType: type, provider: "heygen", requiredUnits: quoteAmount, availableUnits: quotaAvailable, unit: quoteUnit, executionAllowed: false };
    }
    return { status: approvalToSpend ? "READY_PENDING_EXECUTION" : "PENDING_SPEND_APPROVAL", mediaType: type, provider: "heygen", requiredUnits: quoteAmount, availableUnits: quotaAvailable, unit: quoteUnit, verifiedQuote: quote, executionAllowed: false };
  }

  if (preferredProvider !== "openart") {
    return { status: "BLOCKED_PROVIDER_NOT_VERIFIED", mediaType: type, preferredProvider, spendLimit, executionAllowed: false };
  }
  const candidates = getOpenArtCandidates(openArtCatalog, type, spendLimit);
  const eligible = candidates.filter(x => x.withinBudget && x.affordable);
  if (!eligible.length) {
    const cheapest = candidates[0] || null;
    return {
      status: cheapest ? "BLOCKED_INSUFFICIENT_CREDITS" : "BLOCKED_NO_CATALOG_MODE",
      mediaType: type,
      provider: "openart",
      spendLimit,
      cheapestAvailable: cheapest,
      deficitCredits: cheapest ? Math.max(0, cheapest.creditsRequired - spendLimit) : null,
      executionAllowed: false
    };
  }
  const selected = eligible[0];
  return {
    status: approvalToSpend ? "READY_PENDING_EXECUTION" : "PENDING_SPEND_APPROVAL",
    mediaType: type,
    selected,
    availableCandidates: eligible,
    spendLimit,
    rightsConfirmed: true,
    executionAllowed: false
  };
}
