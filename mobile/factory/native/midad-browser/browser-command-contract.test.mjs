import test from "node:test";
import assert from "node:assert/strict";
import {
  validateBrowserCommand,
  sanitizeDomSnapshot,
  classifyBrowserCommand,
} from "./browser-command-contract.mjs";

const context = {
  currentOrigin: "https://github.com",
  allowedOrigins: ["https://github.com", "https://chatgpt.com"],
  capabilities: ["browser.inspect", "browser.navigate", "browser.click", "browser.fill", "browser.wait"],
  approvedActionIds: [],
};

test("accepts typed inspection and navigation commands within the current origin scope", () => {
  assert.equal(validateBrowserCommand({
    id: "cmd-00000001", type: "getDomSnapshot", tabId: 0, origin: "https://github.com",
  }, context).ok, true);
  assert.equal(validateBrowserCommand({
    id: "cmd-00000002", type: "navigate", tabId: 0, origin: "https://github.com",
    url: "https://chatgpt.com/codex",
  }, context).ok, true);
});

test("rejects origin drift, unapproved origins, and non-HTTPS navigation", () => {
  for (const command of [
    { id: "cmd-00000001", type: "getDomSnapshot", tabId: 0, origin: "https://evil.example" },
    { id: "cmd-00000002", type: "navigate", tabId: 0, origin: "https://github.com", url: "https://evil.example/" },
    { id: "cmd-00000003", type: "navigate", tabId: 0, origin: "https://github.com", url: "javascript:alert(1)" },
    { id: "cmd-00000004", type: "navigate", tabId: 0, origin: "https://github.com", url: "http://github.com/" },
  ]) assert.equal(validateBrowserCommand(command, context).ok, false);
});

test("rejects unknown command fields, unsupported commands, and invalid tab indexes", () => {
  assert.equal(validateBrowserCommand({
    id: "cmd-00000001", type: "getDomSnapshot", tabId: 0, origin: "https://github.com",
    script: "document.cookie",
  }, context).ok, false);
  assert.equal(validateBrowserCommand({
    id: "cmd-00000002", type: "executeJavaScript", tabId: 0, origin: "https://github.com",
  }, context).ok, false);
  assert.equal(validateBrowserCommand({
    id: "cmd-00000003", type: "getTabs", tabId: 99, origin: "https://github.com",
  }, context).ok, false);
});

test("classifies mutating interactions as approval-gated", () => {
  for (const type of ["click", "type", "select", "pressKey"]) {
    assert.equal(classifyBrowserCommand(type).requiresApproval, true);
  }
  assert.equal(classifyBrowserCommand("getDomSnapshot").requiresApproval, false);
  assert.equal(validateBrowserCommand({
    id: "cmd-00000009", type: "click", tabId: 0, origin: "https://github.com", selector: "button",
  }, context).error, "human_approval_required");
  assert.equal(validateBrowserCommand({
    id: "cmd-00000010", type: "click", tabId: 0, origin: "https://github.com",
    selector: "button", approvalId: "approval-0000001",
  }, { ...context, approvedActionIds: ["approval-0000001"] }).ok, true);
});

test("bounds selectors, text input, wait duration, and DOM snapshot output", () => {
  assert.equal(validateBrowserCommand({
    id: "cmd-00000001", type: "type", tabId: 0, origin: "https://github.com",
    selector: "input[name=q]", text: "x".repeat(10001), approvalId: "approval-0000001",
  }, { ...context, approvedActionIds: ["approval-0000001"] }).ok, false);
  assert.equal(validateBrowserCommand({
    id: "cmd-00000002", type: "waitFor", tabId: 0, origin: "https://github.com",
    selector: "main", timeoutMs: 120000,
  }, context).ok, false);

  const snapshot = sanitizeDomSnapshot(`
    <main><h1>Welcome</h1><script>document.cookie</script>
    <input type="password" value="do-not-leak">
    <input name="email" value="person@example.com">
    <textarea>private notes</textarea><p>Safe content</p><p>xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx</p></main>
  `, { maxChars: 80 });
  assert.match(snapshot.text, /Welcome/);
  assert.match(snapshot.text, /Safe content/);
  assert.doesNotMatch(snapshot.text, /document.cookie|do-not-leak|person@example.com|private notes/);
  assert.ok(snapshot.text.length <= 80);
  assert.equal(snapshot.truncated, true);
});
