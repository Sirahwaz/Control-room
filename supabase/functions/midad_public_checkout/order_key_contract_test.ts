import { normalizePublicOrderKey, PUBLIC_ORDER_KEY_RE } from "./order_key_contract.ts";

Deno.test("accepts a canonical store UUID", () => {
  const key = "store-00000000-0000-4000-8000-000000000001";
  if (!PUBLIC_ORDER_KEY_RE.test(key) || normalizePublicOrderKey(key) !== key) throw new Error("canonical_store_order_key_rejected");
});

Deno.test("rejects missing, malformed, and legacy deterministic keys", () => {
  for (const value of ["", "store-not-a-uuid", "midadRevenueOrderKey-product-123", null, 42]) {
    if (normalizePublicOrderKey(value) !== null) throw new Error("invalid_store_order_key_accepted: " + String(value));
  }
});

Deno.test("trims whitespace around a canonical key", () => {
  const key = "store-00000000-0000-4000-8000-000000000001";
  if (normalizePublicOrderKey("  " + key + "  ") !== key) throw new Error("canonical_store_order_key_not_normalized");
});
