import test from "node:test";
import assert from "node:assert/strict";
import {
  createNativeAgentBridge,
  createNativeBrowserDriver,
} from "./native-agent-bridge.mjs";

class FakeEventTarget {
  listeners = new Set();
  addEventListener(type, listener) { if (type === "message") this.listeners.add(listener); }
  removeEventListener(type, listener) { if (type === "message") this.listeners.delete(listener); }
  dispatch(data) { for (const listener of this.listeners) listener({ data }); }
}

test("native bridge correlates typed requests with native WebMessageListener replies", async () => {
  const events = new FakeEventTarget();
  let posted;
  const nativeObject = {
    postMessage(raw) {
      posted = JSON.parse(raw);
      events.dispatch(JSON.stringify({
        v: 1, requestId: posted.requestId, ok: true,
        result: { text: "Visible page text" },
      }));
    },
  };
  const bridge = createNativeAgentBridge({ nativeObject, eventTarget: events });
  const result = await bridge.request({
    type: "getDomSnapshot", tabId: 0, origin: "https://example.com",
  });
  assert.equal(result.text, "Visible page text");
  assert.equal(posted.v, 1);
  assert.equal(posted.command.type, "getDomSnapshot");
  bridge.close();
  assert.equal(events.listeners.size, 0);
});

test("native bridge rejects failed native commands with stable error codes", async () => {
  const events = new FakeEventTarget();
  const nativeObject = {
    postMessage(raw) {
      const request = JSON.parse(raw);
      events.dispatch(JSON.stringify({
        v: 1, requestId: request.requestId, ok: false, error: "origin_not_allowed",
      }));
    },
  };
  const bridge = createNativeAgentBridge({ nativeObject, eventTarget: events });
  await assert.rejects(
    bridge.request({ type: "click", selector: "#pay" }),
    (error) => error.code === "origin_not_allowed",
  );
  bridge.close();
});

test("native browser driver binds every command to the fixed HTTPS origin allowlist", async () => {
  const calls = [];
  const bridge = { request: async (command) => { calls.push(command); return { ok: true }; } };
  const driver = createNativeBrowserDriver({
    bridge,
    allowedOrigins: ["https://example.com", "https://shop.example"],
  });
  await driver.navigate({
    id: "step-0001", type: "navigate", tabId: 0,
    origin: "https://example.com", url: "https://shop.example/catalog",
  });
  assert.deepEqual(calls[0].allowedOrigins, ["https://example.com", "https://shop.example"]);
  assert.equal(calls[0].type, "navigate");
  assert.throws(() => createNativeBrowserDriver({
    bridge, allowedOrigins: ["https://example.com/path"],
  }), /allowed_origin_invalid/);
});

test("native browser driver exposes only the typed browser command surface", () => {
  const driver = createNativeBrowserDriver({
    bridge: { request: async () => null },
    allowedOrigins: ["https://example.com"],
  });
  assert.deepEqual(Object.keys(driver).sort(), [
    "captureScreenshot", "click", "getDomSnapshot", "getTabs", "navigate",
    "pressKey", "scroll", "select", "switchTab", "type", "waitFor",
  ]);
  assert.equal(driver.evaluate, undefined);
  assert.equal(driver.execute, undefined);
});
