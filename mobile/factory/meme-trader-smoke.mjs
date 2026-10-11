#!/usr/bin/env node
/**
 * End-to-end browser smoke for the standalone Meme Trader web surface that is bundled into Android.
 * Uses mocked public market data; no real orders, wallet, key, or backend write is performed.
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { chromium } from "playwright";

const root = path.resolve(process.cwd(), "mobile/www");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml"
};
let phase = 0;
let requests = 0;
let pageErrors = [];
let browser;
const fail = (message) => { throw new Error("MEME_TRADER_SMOKE_FAIL: " + message); };
const waitFor = async (page, fn, message) => {
  try { await page.waitForFunction(fn, null, { timeout: 8000 }); }
  catch (_) { fail(message); }
};
const pair = () => ({
  chainId: "solana",
  dexId: "raydium",
  url: "https://dexscreener.com/solana/mockpair",
  pairAddress: "mockpair",
  baseToken: { address: "mock-token-address", name: "Mock Momentum", symbol: "MOCK" },
  quoteToken: { address: "mock-quote-address", name: "Wrapped SOL", symbol: "SOL" },
  priceUsd: phase === 0 ? "0.00001" : "0.000007",
  priceChange: phase === 0 ? { m5: 1, h1: 5, h24: 20 } : { m5: -4, h1: -31, h24: -5 },
  liquidity: { usd: 250000 },
  volume: { h24: 125000, h6: 45000, h1: 12000, m5: 700 },
  txns: { h1: { buys: phase === 0 ? 100 : 10, sells: phase === 0 ? 40 : 100 } },
  pairCreatedAt: Date.now() - 60 * 60 * 1000,
  info: {}
});

const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname); }
  catch (_) { res.writeHead(400); res.end("bad url"); return; }
  const target = path.resolve(root, "." + pathname);
  if (!target.startsWith(root + path.sep) && target !== path.join(root, "index.html")) {
    res.writeHead(403); res.end("forbidden"); return;
  }
  fs.readFile(target, (err, data) => {
    if (err) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "content-type": mime[path.extname(target)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(data);
  });
});

try {
  if (!fs.existsSync(path.join(root, "index.html"))) fail("standalone HTML entry is missing");
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("https://api.dexscreener.com/**", async (route) => {
    requests += 1;
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/token-profiles/latest/v1")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ chainId: "solana", tokenAddress: "mock-token-address", symbol: "MOCK", name: "Mock Momentum" }]) });
    } else if (url.pathname.endsWith("/token-boosts/latest/v1")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    } else if (url.pathname.includes("/tokens/v1/")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([pair()]) });
    } else {
      await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    }
  });

  await page.goto("http://127.0.0.1:" + port + "/index.html", { waitUntil: "domcontentloaded" });
  await waitFor(page, () => document.querySelector("#stat-assets")?.textContent === "1", "market scanner failed to render the mocked token");
  const tokenCard = page.locator("article.token-card").first();
  if (!(await tokenCard.isVisible())) fail("token card is not visible on a 390px viewport");
  if (!(await tokenCard.innerText()).includes("MOCK")) fail("token symbol did not render");

  const buyButton = tokenCard.locator('button[data-action="buy"]');
  if (!(await buyButton.isEnabled())) fail("safe mock momentum token should allow paper entry");
  await buyButton.click();
  await page.locator("#confirm-paper-buy").click();
  await waitFor(page, () => document.querySelector("#stat-open")?.textContent === "1", "paper buy did not open one local simulated position");
  await page.locator('[data-view="portfolio"]').click();
  await waitFor(page, () => document.querySelector("#open-positions")?.innerText.includes("Mock Momentum"), "paper portfolio did not render the opened position");

  // Reprice the same token below stop-loss. Only a fresh mocked quote may close it.
  phase = 1;
  await page.locator('[data-view="radar"]').click();
  await page.locator("#scan-btn").click();
  await waitFor(page, () => document.querySelector("#stat-open")?.textContent === "0", "stop-loss did not auto-close the paper position on a fresh falling quote");
  await page.locator('[data-view="journal"]').click();
  await waitFor(page, () => document.querySelector("#journal-items")?.innerText.includes("بيع ورقي"), "paper close was not written to the journal");

  if (requests < 6) fail("market-data route was not exercised enough times");
  if (pageErrors.length) fail("browser runtime errors: " + pageErrors.join(" | "));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  if (overflow) fail("horizontal overflow at mobile viewport 390px");
  console.log(JSON.stringify({
    ok: true,
    product: "midad-meme-trader",
    tests: [
      "standalone mobile UI rendered",
      "mocked public market scan rendered a priced token",
      "local paper buy updated portfolio",
      "fresh-price stop-loss closed the simulated position",
      "paper close appeared in trade journal",
      "no browser page errors",
      "no horizontal overflow at 390px"
    ],
    marketApiRequests: requests,
    browserPageErrors: pageErrors.length
  }, null, 2));
} catch (error) {
  console.error(error && error.stack || String(error));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
