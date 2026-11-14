const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
let server;
let origin;
let browser;

test("real Chromium Service Worker runtime enforces static-only caching and offline fallback", async t => {
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (pathname === "/service-worker.js") {
      res.writeHead(200, { "content-type": "text/javascript", "service-worker-allowed": "/" });
      res.end(fs.readFileSync(path.join(root, "service-worker.js")));
      return;
    }
    if (pathname === "/" || pathname === "/index.html") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<!doctype html><title>MIDAD SW runtime test</title><main>runtime fixture</main>");
      return;
    }
    if (pathname.startsWith("/api/") || pathname.startsWith("/functions/")) {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "private, no-store" });
      res.end(JSON.stringify({ private: true, path: pathname }));
      return;
    }
    res.writeHead(200, { "content-type": pathname.endsWith(".css") ? "text/css" : "text/javascript" });
    res.end("/* isolated static fixture */");
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  t.after(async () => {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  });

  const context = await browser.newContext({ serviceWorkers: "allow" });
  const page = await context.newPage();
  await page.goto(origin);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/service-worker.js", { scope: "/" });
  });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 15000 });

  const approved = `${origin}/midad-control-v2.css`;
  const approvedResponse = await page.evaluate(async url => {
    const response = await fetch(url);
    return { status: response.status, body: await response.text() };
  }, approved);
  assert.equal(approvedResponse.status, 200);

  const apiUrl = `${origin}/api/account`;
  const profileUrl = `${origin}/functions/v1/private-profile`;
  const dynamicResults = await page.evaluate(async urls => Promise.all(urls.map(async url => {
    const response = await fetch(url);
    return { status: response.status, body: await response.text() };
  })), [apiUrl, profileUrl]);
  assert.deepEqual(dynamicResults.map(item => item.status), [200, 200]);

  const unapprovedUrl = `${origin}/midad-control-v2.js?v=unapproved`;
  await page.evaluate(async url => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Unexpected status: ${response.status}`);
  }, unapprovedUrl);

  await page.waitForFunction(async url => {\n    const names = await caches.keys();\n    for (const name of names) {\n      const cache = await caches.open(name);\n      if (await cache.match(url)) return true;\n    }\n    return false;\n  }, approved, { timeout: 5000 });\n\n  const cacheState = await page.evaluate(async () => {
    const names = await caches.keys();
    const cache = await caches.open(names.find(name => name.startsWith("midad-control-v")) || names[0]);
    const requests = (await cache.keys()).map(request => request.url);
    return { names, requests };
  });
  assert.ok(cacheState.names.some(name => name.startsWith("midad-control-v")), "worker cache should exist");
  assert.ok(cacheState.requests.includes(approved), "approved static asset should be cached");
  assert.ok(!cacheState.requests.includes(apiUrl), "API response must not be cached");
  assert.ok(!cacheState.requests.includes(profileUrl), "personalized endpoint must not be cached");
  assert.ok(!cacheState.requests.includes(unapprovedUrl), "unapproved query variant must not be cached");

  await context.setOffline(true);
  const offline = await page.evaluate(async url => {
    const response = await fetch(url);
    return { status: response.status, body: await response.text() };
  }, approved);
  assert.equal(offline.status, 200, "pre-cached static asset should remain available offline");
  assert.match(offline.body, /isolated static fixture/);
  await context.setOffline(false);
  await context.close();
});
