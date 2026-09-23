const DEFAULT_BASE_URL = "https://www.viabtc.net";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function assertCoin(coin) {
  const value = String(coin || "BTC").trim().toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(value)) {
    throw new Error("Invalid coin");
  }
  return value;
}

function assertWorkerId(workerId) {
  const value = String(workerId || "").trim();
  if (!/^[0-9]+$/.test(value)) {
    throw new Error("Invalid workerId");
  }
  return value;
}

async function viabtcGet(path, query = {}) {
  const baseUrl = process.env.VIABTC_API_BASE_URL || DEFAULT_BASE_URL;
  const apiKey = requiredEnv("VIABTC_API_KEY");
  const timeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 8000);

  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "X-API-KEY": apiKey,
        "User-Agent": "MIDAD-ViaBTC-Monitor/0.1"
      },
      signal: controller.signal
    });

    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`ViaBTC returned non-JSON response (HTTP ${response.status})`);
    }

    if (!response.ok) {
      throw new Error(`ViaBTC HTTP ${response.status}`);
    }
    if (payload?.code !== 0) {
      throw new Error(`ViaBTC API error ${payload?.code ?? "unknown"}`);
    }

    return {
      endpoint: url.pathname,
      provider_status: response.status,
      provider_message: payload?.message ?? null,
      data: payload.data ?? null
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function getAccountHashrate(coin = "BTC") {
  return viabtcGet("/res/openapi/v1/hashrate", { coin: assertCoin(coin) });
}

export async function getProfit(coin = "BTC") {
  return viabtcGet("/res/openapi/v1/profit", { coin: assertCoin(coin) });
}

export async function getWorkerHashrate(workerId, coin = "BTC") {
  // ViaBTC identifies the worker in the path; coin is retained in the
  // normalized request context even though this endpoint's documented path
  // does not require it as a query parameter.
  return viabtcGet(`/res/openapi/v1/hashrate/worker/${assertWorkerId(workerId)}`, { coin: assertCoin(coin) });
}
