(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MIDADCheckoutAttribution = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  const UTM_KEYS = Object.freeze([
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term"
  ]);
  const MAX_VALUE_LENGTH = 160;

  function clean(value) {
    return String(value ?? "")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, MAX_VALUE_LENGTH);
  }

  function buildCheckoutAttribution(locationHref, documentReferrer) {
    const pageUrl = new URL(String(locationHref));
    const attribution = {
      lane: "revenue_forge",
      landing_path: clean(pageUrl.pathname)
    };

    for (const key of UTM_KEYS) {
      const value = pageUrl.searchParams.getAll(key).map(clean).find(Boolean);
      if (value) attribution[key] = value;
    }

    try {
      const referrerUrl = new URL(String(documentReferrer || ""));
      const httpReferrer =
        referrerUrl.protocol === "http:" || referrerUrl.protocol === "https:";
      if (httpReferrer && referrerUrl.origin !== pageUrl.origin) {
        attribution.ref = clean(referrerUrl.hostname).toLowerCase();
      }
    } catch {
      // Referrer is optional and untrusted; ignore invalid values.
    }

    return attribution;
  }

  return Object.freeze({ buildCheckoutAttribution });
});
