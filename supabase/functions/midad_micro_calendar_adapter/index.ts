import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { callMicroCalendarAvailability } from "./adapter.mjs";

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: HEADERS });

async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const aa = new Uint8Array(a), bb = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0 && left.length > 0 && right.length > 0;
}

async function authorized(req: Request): Promise<boolean> {
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const adapterKey = Deno.env.get("MIDAD_MICRO_ADAPTER_KEY") || "";
  const authorization = req.headers.get("authorization") || "";
  const suppliedAdapterKey = req.headers.get("x-midad-micro-adapter-key") || "";
  if (!serviceRole || !adapterKey || authorization !== `Bearer ${serviceRole}`) return false;
  return await constantTimeEqual(suppliedAdapterKey, adapterKey);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!await authorized(req)) return json({ ok: false, error: "unauthorized" }, 401);

  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > 4096) return json({ ok: false, error: "request_too_large" }, 413);
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw || "{}"); }
  catch { return json({ ok: false, error: "invalid_json" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ ok: false, error: "invalid_input" }, 400);
  if (body.action !== "calendar_availability") return json({ ok: false, error: "action_not_allowed" }, 400);

  const allowed = new Set(["action", "from", "to", "minutes", "day_start", "day_end"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) return json({ ok: false, error: "unsupported_parameter" }, 400);
  const input: Record<string, unknown> = {};
  for (const key of ["from", "to", "minutes", "day_start", "day_end"]) {
    if (body[key] !== undefined) input[key] = body[key];
  }

  const token = Deno.env.get("MIDAD_MICRO_API_TOKEN") || "";
  const result = await callMicroCalendarAvailability({ token, input });
  if (result.ok) return json(result, 200);

  const errorCode = "error" in result ? String(result.error) : "unknown";
  const status = ["invalid_input", "unsupported_parameter", "invalid_time_range", "invalid_duration", "invalid_working_hours"].includes(errorCode)
    ? 400
    : errorCode === "micro_token_missing" ? 503
    : errorCode === "micro_rate_limited" ? 429
    : 502;
  return json(result, status);
});
