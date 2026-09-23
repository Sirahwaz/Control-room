import http from "node:http";
import crypto from "node:crypto";

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8788);
const API_BASE_URL = process.env.VIABTC_API_BASE_URL || "https://pool.viabtc.com";
const API_KEY = process.env.VIABTC_API_KEY;
const GATEWAY_KEY = process.env.MIDAD_VIABTC_GATEWAY_KEY;
const TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 8000);

if (!API_KEY) throw new Error("VIABTC_API_KEY is required");
if (!GATEWAY_KEY) throw new Error("MIDAD_VIABTC_GATEWAY_KEY is required");

const ALLOWED_STATIC_PATHS = new Set([
  "/res/openapi/v1/hashrate",
  "/res/openapi/v1/profit",
  "/res/openapi/v1/profit/history",
  "/res/openapi/v1/wallet/payment/history",
  "/res/openapi/v1/hashrate/history",
  "/res/openapi/v1/hashrate/worker"
]);

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  res.end(JSON.stringify(body));
}

function authOK(req) {
  const bearer = req.headers.authorization || "";
  const supplied = req.headers["x-midad-gateway-key"] || "";
  const value = supplied || (bearer.startsWith("Bearer ") ? bearer.slice(7) : "");
  const provided = Buffer.from(String(value));
  const expected = Buffer.from(GATEWAY_KEY);
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}

function isAllowedPath(path) {
  if (ALLOWED_STATIC_PATHS.has(path)) return true;
  return /^\/res\/openapi\/v1\/hashrate\/worker\/[0-9]+$/.test(path);
}

function sanitizeQuery(input) {
  const allowed = new Set([
    "coin", "start_date", "end_date", "utc", "page", "limit",
    "group_id", "worker_status"
  ]);
  const out = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (!allowed.has(key)) throw new Error("Query key not allowed: " + key);
    const text = String(value ?? "");
    if (text.length > 80) throw new Error("Query value too long");
    out[key] = text;
  }
  if (out.coin) {
    out.coin = out.coin.toUpperCase();
    if (!/^[A-Z0-9]{2,12}$/.test(out.coin)) throw new Error("Invalid coin");
  }
  return out;
}

async function callViaBTC(path, query) {
  const url = new URL(path, API_BASE_URL);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "accept": "application/json",
        "x-api-key": API_KEY,
        "user-agent": "MIDAD-Static-Egress-Gateway/0.1"
      },
      signal: controller.signal
    });

    const text = await response.text();
    let upstream;
    try {
      upstream = JSON.parse(text);
    } catch {
      upstream = { raw: text.slice(0, 2000) };
    }

    return {
      ok: response.ok && (!(upstream && "code" in upstream) || Number(upstream.code) === 0),
      upstream_status: response.status,
      upstream
    };
  } finally {
    clearTimeout(timer);
  }
}

async function route(req, res) {
  if (req.method === "GET" && req.url === "/healthz") {
    return json(res, 200, {
      ok: true,
      service: "midad-static-egress-gateway",
      provider: "viabtc",
      mode: "READ_ONLY",
      time: new Date().toISOString()
    });
  }

  if (req.url?.split("?")[0] !== "/v1/viabtc") {
    return json(res, 404, { ok: false, error: "not_found" });
  }

  if (!authOK(req)) return json(res, 401, { ok: false, error: "unauthorized" });
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "post_required" });

  let body = {};
  try {
    body = await new Promise((resolve, reject) => {
      let raw = "";
      req.on("data", chunk => {
        raw += chunk;
        if (raw.length > 12000) reject(new Error("body_too_large"));
      });
      req.on("end", () => {
        try { resolve(JSON.parse(raw || "{}")); }
        catch { reject(new Error("invalid_json")); }
      });
      req.on("error", reject);
    });

    const path = String(body.path || "");
    if (body.url || body.base_url || body.host) throw new Error("Arbitrary upstream routing is forbidden");
    if (body.headers) throw new Error("Caller-supplied upstream headers are forbidden");
    if (!isAllowedPath(path)) throw new Error("ViaBTC path not allowed");

    const query = sanitizeQuery(body.query || {});
    const result = await callViaBTC(path, query);

    return json(res, result.ok ? 200 : 502, {
      ok: result.ok,
      upstream_status: result.upstream_status,
      upstream: result.upstream,
      transport: "static_egress_gateway",
      read_only: true
    });
  } catch (error) {
    return json(res, 400, {
      ok: false,
      error: error instanceof Error ? error.message : "bad_request"
    });
  }
}

const server = http.createServer((req, res) => {
  route(req, res).catch(error => {
    json(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : "internal_error"
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`MIDAD static egress gateway listening on http://${HOST}:${PORT}`);
});
