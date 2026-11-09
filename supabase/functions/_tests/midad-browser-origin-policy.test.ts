import { assertEquals } from "jsr:@std/assert@1";
import { isAllowedBrowserUserOrigin } from "../midad_browser_agent_gateway/origin-policy.ts";

Deno.test("allows the hosted MIDAD Browser surface", () => {
  assertEquals(isAllowedBrowserUserOrigin("https://sirahwaz.github.io"), true);
});

Deno.test("allows the packaged Android WebViewAssetLoader origin", () => {
  assertEquals(isAllowedBrowserUserOrigin("https://appassets.androidplatform.net"), true);
});

Deno.test("rejects lookalike, insecure, opaque, and unexpected origins", () => {
  for (const origin of [
    "https://sirahwaz.github.io.attacker.example",
    "http://sirahwaz.github.io",
    "https://appassets.androidplatform.net.evil.example",
    "null",
    "https://localhost",
    "https://example.com",
  ]) {
    assertEquals(isAllowedBrowserUserOrigin(origin), false, origin);
  }
});
