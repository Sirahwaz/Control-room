import { stripBearerPrefix } from "./auth.mjs";
import { isAllowedBrowserUserOrigin } from "./origin-policy.ts";

function equal(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

Deno.test("Bearer prefix is removed case-insensitively", () => {
  equal(stripBearerPrefix("Bearer session-token-123"), "session-token-123", "standard bearer");
  equal(stripBearerPrefix("bEaReR\t session-token-123 "), "session-token-123", "mixed-case bearer");
});

Deno.test("raw session tokens remain compatible", () => {
  equal(stripBearerPrefix("raw-session-token-123"), "raw-session-token-123", "raw token");
  equal(stripBearerPrefix("  raw-session-token-123  "), "raw-session-token-123", "trimmed raw token");
});

Deno.test("invalid authorization values normalize to empty", () => {
  equal(stripBearerPrefix(null), "", "null header");
  equal(stripBearerPrefix(42), "", "non-string header");
  equal(stripBearerPrefix("   "), "", "blank header");
});

Deno.test("only exact approved HTTPS browser origins are accepted", () => {
  equal(isAllowedBrowserUserOrigin("https://sirahwaz.github.io"), true, "hosted control room");
  equal(isAllowedBrowserUserOrigin("https://appassets.androidplatform.net"), true, "Android WebView asset origin");
  equal(isAllowedBrowserUserOrigin("http://sirahwaz.github.io"), false, "HTTP origin");
  equal(isAllowedBrowserUserOrigin("https://evil.sirahwaz.github.io"), false, "subdomain");
  equal(isAllowedBrowserUserOrigin("https://sirahwaz.github.io.evil.example"), false, "lookalike host");
  equal(isAllowedBrowserUserOrigin("null"), false, "opaque origin");
  equal(isAllowedBrowserUserOrigin(null), false, "missing origin");
});
