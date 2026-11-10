const ALLOWED_BROWSER_USER_ORIGINS = new Set([
  "https://sirahwaz.github.io",
  "https://appassets.androidplatform.net",
]);

/**
 * Exact-origin allowlist for the hosted Control Room and packaged Android
 * WebViewAssetLoader surface. No suffix, wildcard, HTTP, opaque, or local
 * development origins are accepted.
 */
export function isAllowedBrowserUserOrigin(origin: string | null): boolean {
  if (typeof origin !== "string" || !origin) return false;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "https:" &&
      parsed.origin === origin &&
      ALLOWED_BROWSER_USER_ORIGINS.has(parsed.origin);
  } catch {
    return false;
  }
}
