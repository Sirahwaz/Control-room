const WORKER_ID = /^[A-Za-z0-9_.:-]{3,120}$/;
const LEASE_TOKEN = /^[A-Za-z0-9_-]{32,200}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeLeaseWorkerId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value !== value.trim()) return null;
  return WORKER_ID.test(value) ? value : null;
}

export function normalizeLeaseToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim();
  return LEASE_TOKEN.test(token) ? token : null;
}

export function normalizeLeaseJobId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return UUID.test(id) ? id : null;
}

export function normalizeLeaseOwnerId(value: unknown): string | null {
  return normalizeLeaseJobId(value);
}

export function normalizeLeaseSeconds(value: unknown, fallback = 120): number | null {
  const seconds = value === undefined || value === null ? fallback : Number(value);
  return Number.isInteger(seconds) && seconds >= 30 && seconds <= 300 ? seconds : null;
}

export function normalizeLeaseLimit(value: unknown, fallback = 5): number | null {
  const limit = value === undefined || value === null ? fallback : Number(value);
  return Number.isInteger(limit) && limit >= 1 && limit <= 20 ? limit : null;
}

export async function hashLeaseToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}
