import http from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PORT || 8080);
const GATEWAY_KEY = process.env.MIDAD_GATEWAY_KEY || "";
const UPSTREAM = "https://pool.viabtc.com";

const ALLOWED_PATHS = new Set([
  "/res/openapi/v1/hashrate",
  "/res/openapi/v1/profit",
  "/res/openapi/v1/profit/history",
  "/res/openapi/v1/wallet/payment/history",
  "/res/openapi/v1/hashrate/history",
]);

const ALLOWED_QUERY_KEYS = new Set([
  "coin",
  "start_date",
  "end_date",
  "utc",
  "page",
  "limit",
]);

function json(res, status, body, extra = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    ...extra,
  });
  res.end(payload);
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function readBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 16 * 1024) throw new Error("body_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function cleanQuery(input) {
  const out = new URLSearchParams();
  if (!input || typeof input !== "object") return out;
  for (const [key, value] of Object.entries(input)) {
    if (!ALLOWED_QUERY_KEYS.has(key)) continue;
    if (typeof value !== "string") continue;
    if (value.length > 128) continue;
    out.set(key, value);
  }
  return out;
}

async function handle(req, res) {
  const requestId = req.headers["x-request-id"] || randomUUID();

  if (req.method === "GET" && req.url === "/healthz") {
    return json(res, 200, { ok: true, service: "midad-viabtc-egress", request_id: requestId });
  }

  if (req.method !== "POST" || req.url !== "/v1/viabtc") {
    return json(res, 404, { ok: false, error: "not_found", request_id: requestId });
  }

  if (!GATEWAY_KEY) {
    return json(res, 503, { ok: false, error: "gateway_not_configured", request_id: requestId });
  }

  const suppliedGatewayKey = req.headers["x-midad-gateway-key"] || "";
  if (!timingSafeEqual(String(suppliedGatewayKey), GATEWAY_KEY)) {
    return json(res, 401, { ok: false, error: "unauthorized", request_id: requestId });
  }

  const viabtcKey = req.headers["x-viabtc-api-key"] || "";
  if (!viabtcKey || String(viabtcKey).length > 512) {
    return json(res, 400, { ok: false, error: "missing_viabtc_api_key", request_id: requestId });
  }

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return json(res, 400, { ok: false, error: "invalid_json", request_id: requestId });
  }

  const path = typeof body?.path === "string" ? body.path : "";
  if (!ALLOWED_PATHS.has(path)) {
    return json(res, 403, { ok: false, error: "path_not_allowed", request_id: requestId });
  }

  const query = cleanQuery(body?.query);
  const target = new URL(path, UPSTREAM);
  target.search = query.toString();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const upstream = await fetch(target, {
      method: "GET",
      headers: {
        "X-API-KEY": String(viabtcKey),
        "Accept": "application/json",
        "User-Agent": "MIDAD-ViaBTC-Gateway/1.0",
      },
      signal: controller.signal,
    });

    const text = await upstream.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text.slice(0, 2000) };
    }

    return json(res, upstream.ok ? 200 : 502, {
      ok: upstream.ok,
      upstream_status: upstream.status,
      upstream: parsed,
      request_id: requestId,
    });
  } catch (error) {
    const message = error?.name === "AbortError" ? "upstream_timeout" : "upstream_fetch_failed";
    return json(res, 502, { ok: false, error: message, request_id: requestId });
  } finally {
    clearTimeout(timer);
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(() => {
    json(res, 500, { ok: false, error: "internal_error" });
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(JSON.stringify({ event: "gateway_started", port: PORT }));
});