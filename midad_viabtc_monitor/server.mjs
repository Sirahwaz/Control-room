import http from "node:http";
import crypto from "node:crypto";
import {
  getAccountHashrate,
  getProfit,
  getWorkerHashrate
} from "./adapter/viabtc-client.mjs";

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8787);
const MONITOR_TOKEN = process.env.MIDAD_MONITOR_TOKEN;
const MAX_FRESHNESS_SECONDS = Number(process.env.MAX_FRESHNESS_SECONDS || 120);

if (!MONITOR_TOKEN) {
  throw new Error("MIDAD_MONITOR_TOKEN is required");
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(payload);
}

function unauthorized(res) {
  json(res, 401, {
    status: "UNAUTHORIZED",
    message: "Valid monitor bearer token required"
  });
}

function forbidden(res) {
  json(res, 403, {
    status: "FORBIDDEN",
    message: "Read-only ViaBTC monitor"
  });
}

function authenticate(req) {
  const value = req.headers.authorization || "";
  const prefix = "Bearer ";
  if (!value.startsWith(prefix)) return false;
  const provided = Buffer.from(value.slice(prefix.length));
  const expected = Buffer.from(MONITOR_TOKEN);
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
}

function observation({ endpoint, data, providerMessage, error = null }) {
  const observedAt = new Date().toISOString();
  const observedMs = Date.parse(observedAt);
  return {
    schema_version: "midad.provider-observation.v1",
    provider_id: "viabtc",
    provider_type: "MINING",
    environment: "LIVE",
    observed_at: observedAt,
    source: {
      provider: "ViaBTC",
      endpoint,
      provider_message: providerMessage ?? null
    },
    freshness_seconds: Math.max(0, Math.floor((Date.now() - observedMs) / 1000)),
    freshness_limit_seconds: MAX_FRESHNESS_SECONDS,
    status: error ? "ERROR" : "VERIFIED_OBSERVATION",
    data: data ?? null,
    error: error ?? null,
    capabilities: [
      "ACCOUNT_HASHRATE_READ",
      "PROFIT_SUMMARY_READ",
      "WORKER_HASHRATE_READ"
    ],
    mutation_capabilities: []
  };
}

async function route(req, res) {
  if (req.method === "GET" && req.url === "/healthz") {
    return json(res, 200, {
      status: "ok",
      service: "midad-viabtc-monitor",
      mode: "READ_ONLY",
      provider: "viabtc",
      time: new Date().toISOString()
    });
  }

  if (!authenticate(req)) return unauthorized(res);

  const url = new URL(req.url, "http://midad-monitor.local");

  // Deliberately no POST/PUT/PATCH/DELETE routes.
  if (req.method !== "GET") return forbidden(res);

  try {
    if (url.pathname === "/v1/account/hashrate") {
      const coin = url.searchParams.get("coin") || "BTC";
      const result = await getAccountHashrate(coin);
      return json(res, 200, observation(result));
    }

    if (url.pathname === "/v1/profit") {
      const coin = url.searchParams.get("coin") || "BTC";
      const result = await getProfit(coin);
      return json(res, 200, observation(result));
    }

    const workerMatch = url.pathname.match(/^\/v1\/worker\/([0-9]+)$/);
    if (workerMatch) {
      const coin = url.searchParams.get("coin") || "BTC";
      const result = await getWorkerHashrate(workerMatch[1], coin);
      return json(res, 200, observation(result));
    }

    return json(res, 404, { status: "NOT_FOUND" });
  } catch (error) {
    return json(res, 502, observation({
      endpoint: "viaBTC",
      data: null,
      providerMessage: null,
      error: error instanceof Error ? error.message : "unknown error"
    }));
  }
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    json(res, 500, {
      status: "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : "unknown error"
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`MIDAD ViaBTC monitor listening on http://${HOST}:${PORT}`);
});
