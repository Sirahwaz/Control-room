import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createPaperPosition, createPaperJournalBackup } from "../web/trading/trading-core.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(process.cwd(), process.argv[2] || "www");
const outputDir = path.resolve(process.cwd(), process.argv[3] || "../dist");
await fs.mkdir(outputDir, { recursive: true });

const mime = { ".html": "text/html; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8" };
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || "/", "http://127.0.0.1").pathname);
    const target = path.resolve(webRoot, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!target.startsWith(webRoot + path.sep) && target !== path.join(webRoot, "index.html")) {
      res.writeHead(403).end("Forbidden"); return;
    }
    const body = await fs.readFile(target);
    res.writeHead(200, { "content-type": mime[path.extname(target)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const url = "http://127.0.0.1:" + address.port + "/";

let browser;
const consoleErrors = [];
const pageErrors = [];
const checks = [];
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on("pageerror", error => pageErrors.push(String(error)));
  page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });

  await page.addInitScript(() => {
    class MockWebSocket {
      constructor(url) {
        this.url = url; this.readyState = 0;
        setTimeout(() => {
          this.readyState = 1;
          if (this.onopen) this.onopen({});
          const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"];
          for (const [index, symbol] of symbols.entries()) {
            const event = { e: "24hrTicker", s: symbol, c: String(100 + index), P: "1.25", q: "2500000", E: Date.now() };
            if (this.onmessage) this.onmessage({ data: JSON.stringify({ data: event }) });
          }
        }, 5);
      }
      close() { this.readyState = 3; }
      send() {}
    }
    window.WebSocket = MockWebSocket;
  });

  await page.route("https://api.binance.com/**", async route => {
    const requestUrl = route.request().url();
    if (requestUrl.includes("/api/v3/klines")) {
      const now = Date.now();
      const candles = Array.from({ length: 120 }, (_, i) => {
        const openTime = now - (120 - i) * 60000;
        const close = 100 + i * 0.08;
        return [openTime, String(close - 0.02), String(close + 0.1), String(close - 0.1), String(close), "100", openTime + 59999, String(10000 + i * 10)];
      });
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(candles) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
  });
  await page.route("https://api.dexscreener.com/**", route => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("https://api.geckoterminal.com/**", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) }));
  await page.route("https://api.coinex.com/**", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, data: [] }) }));

  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  assert.match(await page.title(), /MIDAD Trading Intelligence/i);
  assert.equal(await page.locator("script[type='module']").count(), 1);
  assert.equal(await page.locator("#marketRows tr").count(), 4);
  checks.push("page-load-and-market-feed");

  await page.getByRole("button", { name: "DEX Discovery" }).click();
  await page.locator("#dexStatus").getByText("OBSERVED · 0").waitFor({ timeout: 10000 });
  assert.equal(await page.locator(".view.active").count(), 1);
  checks.push("tab-navigation-and-dex-discovery");

  const sample = createPaperPosition({
    id: "ui-smoke-paper-001", symbol: "BTCUSDT", side: "buy", quantity: 0.01,
    entryPrice: 100, feePct: 0.1, slippagePct: 0.05, openedAt: 1700000000000, bucket: "tactical"
  });
  const backup = createPaperJournalBackup([sample], { createdAt: 1700000001000 });
  await page.locator("#paperImportFile").setInputFiles({
    name: "midad-paper-journal-smoke.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup))
  });
  await page.locator("#paperBackupStatus").getByText("اكتمل الدمج", { exact: false }).waitFor({ timeout: 10000 });
  assert.equal(await page.locator("#paperPositions .signal").count(), 1);
  checks.push("paper-journal-import");

  const conflicting = createPaperPosition({
    id: "ui-smoke-paper-001", symbol: "BTCUSDT", side: "buy", quantity: 0.02,
    entryPrice: 100, feePct: 0.1, slippagePct: 0.05, openedAt: 1700000000000, bucket: "tactical"
  });
  const conflictBackup = createPaperJournalBackup([conflicting], { createdAt: 1700000002000 });
  await page.locator("#paperImportFile").setInputFiles({
    name: "midad-paper-journal-conflict.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(conflictBackup))
  });
  await page.locator("#paperBackupStatus").getByText("PAPER_BACKUP_ID_CONFLICT", { exact: false }).waitFor({ timeout: 10000 });
  assert.equal(await page.locator("#paperPositions .signal").count(), 1);
  checks.push("paper-journal-conflict-is-non-destructive");

  const downloadWait = page.waitForEvent("download");
  await page.locator("#paperExportBtn").click();
  const download = await downloadWait;
  const downloadPath = await download.path();
  assert.ok(downloadPath, "export download path missing");
  const exported = JSON.parse(await fs.readFile(downloadPath, "utf8"));
  assert.equal(exported.format, "MIDAD_PAPER_JOURNAL");
  assert.equal(exported.positionCount, 1);
  checks.push("paper-journal-export");

  await page.screenshot({ path: path.join(outputDir, "trading-ui-smoke.png"), fullPage: true });
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.deepEqual(pageErrors, [], "uncaught page errors");
  assert.deepEqual(consoleErrors, [], "browser console errors");
  checks.push("clean-console-and-page-runtime");

  const report = {
    status: "PASSED",
    product: "midad-trading",
    url,
    viewport: { width: 390, height: 844 },
    checks,
    consoleErrors,
    pageErrors,
    screenshots: ["trading-ui-smoke.png"],
    note: "Public API feeds were mocked with deterministic fixtures; no exchange credentials or live order routes were used."
  };
  await fs.writeFile(path.join(outputDir, "trading-ui-smoke-report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
  await context.close();
} catch (error) {
  const report = { status: "FAILED", checks, consoleErrors, pageErrors, error: String(error?.stack || error) };
  await fs.writeFile(path.join(outputDir, "trading-ui-smoke-report.json"), JSON.stringify(report, null, 2) + "\n");
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
