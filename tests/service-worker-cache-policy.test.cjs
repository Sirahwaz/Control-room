const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const workerSource = fs.readFileSync(path.join(__dirname, "..", "service-worker.js"), "utf8");

function createHarness(fetchImpl) {
  const listeners = {};
  const stored = new Map();
  const cache = {
    async addAll() {},
    async put(request, response) {
      stored.set(new URL(request.url).href, response);
    },
    async match(request) {
      return stored.get(typeof request === "string" ? request : new URL(request.url).href);
    }
  };
  const context = {
    URL,
    Response,
    location: { origin: "https://midad.example" },
    fetch: fetchImpl,
    caches: {
      async open() { return cache; },
      async match(request) { return cache.match(request); },
      async keys() { return ["midad-control-v23-20261113-outreach-v1"]; },
      async delete() { return true; }
    },
    self: {
      registration: { scope: "https://midad.example/" },
      clients: { async claim() {} },
      async skipWaiting() {},
      addEventListener(type, handler) { listeners[type] = handler; }
    }
  };
  vm.runInNewContext(workerSource, context, { filename: "service-worker.js" });
  return {
    stored,
    async dispatch(request) {
      let responsePromise;
      const event = {
        request,
        respondWith(promise) { responsePromise = Promise.resolve(promise); },
        waitUntil() {}
      };
      listeners.fetch(event);
      return responsePromise;
    }
  };
}

function request(url, method = "GET", mode = "cors") {
  return { url, method, mode };
}

test("caches successful allowlisted static assets", async () => {
  const harness = createHarness(async () => new Response("css", { status: 200 }));
  const response = await harness.dispatch(request("https://midad.example/midad-control-v2.css"));
  assert.equal(await response.text(), "css");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.stored.size, 1);
});

test("does not cache same-origin API or other dynamic GET responses", async () => {
  const harness = createHarness(async () => new Response("private-data", { status: 200 }));
  await harness.dispatch(request("https://midad.example/api/account"));
  await harness.dispatch(request("https://midad.example/functions/v1/private-profile"));
  assert.equal(harness.stored.size, 0);
});

test("does not cache non-allowlisted HTML navigations", async () => {
  const harness = createHarness(async () => new Response("dynamic-page", { status: 200 }));
  await harness.dispatch(request("https://midad.example/account/overview", "GET", "navigate"));
  assert.equal(harness.stored.size, 0);
});

test("does not intercept cross-origin or non-GET requests", async () => {
  const harness = createHarness(async () => new Response("ok", { status: 200 }));
  assert.equal(await harness.dispatch(request("https://api.example/data")), undefined);
  assert.equal(await harness.dispatch(request("https://midad.example/checkout", "POST")), undefined);
  assert.equal(harness.stored.size, 0);
});
