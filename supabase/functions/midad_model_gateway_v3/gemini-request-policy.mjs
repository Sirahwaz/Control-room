const ALLOWED_DATA_CLASSES = new Set(["public", "sanitized"]);

export function evaluateGeminiRequestPolicy({ dataClass, routeMetadata } = {}) {
  const normalizedClass = String(dataClass || "").trim().toLowerCase();
  const metadata = routeMetadata && typeof routeMetadata === "object" ? routeMetadata : {};
  const privacyProfile = String(metadata.privacy_profile || "").trim().toLowerCase();
  const allowedClasses = Array.isArray(metadata.allowed_data_classes)
    ? metadata.allowed_data_classes.map((value) => String(value).trim().toLowerCase())
    : [];

  if (privacyProfile !== "public_sanitized_only") {
    return { ok: false, error: "gemini_route_not_marked_public_sanitized" };
  }
  if (!ALLOWED_DATA_CLASSES.has(normalizedClass) || !allowedClasses.includes(normalizedClass)) {
    return { ok: false, error: "gemini_requires_explicit_public_or_sanitized_data_class" };
  }
  return { ok: true, dataClass: normalizedClass };
}
