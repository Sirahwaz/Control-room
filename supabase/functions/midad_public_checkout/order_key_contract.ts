export const PUBLIC_ORDER_KEY_RE = /^store-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizePublicOrderKey(value: unknown): string | null {
  const key = typeof value === "string" ? value.trim() : "";
  return PUBLIC_ORDER_KEY_RE.test(key) ? key : null;
}
