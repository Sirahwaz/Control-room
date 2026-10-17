import { test, expect } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const annotationText = "MIDAD-CI-E2E: product UI annotation reached MCP";

test("selected Mobile Factory product UI annotation reaches the Agentation MCP tool", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /UI review/ })).toBeVisible();

  const frame = page.frameLocator('iframe[title="MIDAD product preview"]');
  await expect(frame.locator("body")).toBeVisible();
  await expect.poll(async () => page.locator('iframe[title="MIDAD product preview"]').evaluate(el => {
    try { return el.contentDocument?.readyState === "complete"; } catch { return false; }
  }), { timeout: 15000 }).toBe(true);

  const health = await request.get("http://127.0.0.1:4747/health");
  expect(health.ok()).toBeTruthy();

  // Target a real element inside the selected product. Buttons are preferred;
  // informational pages fall back to a visible link, heading or main region.
  const buttons = frame.locator("button:visible");
  const links = frame.locator("a:visible");
  const headings = frame.locator("h1:visible");
  const mains = frame.locator("main:visible");
  let target;
  if (await buttons.count()) target = buttons.first();
  else if (await links.count()) target = links.first();
  else if (await headings.count()) target = headings.first();
  else target = mains.first();
  await expect(target).toBeVisible();

  await page.getByRole("button", { name: "Start feedback mode" }).click();
  await target.click({ timeout: 10000 });
  await page.getByPlaceholder("What should change?").fill(annotationText);
  await page.getByRole("button", { name: "Add", exact: true }).click();

  await expect.poll(async () => {
    const response = await request.get("http://127.0.0.1:4747/pending");
    if (!response.ok()) return false;
    return JSON.stringify(await response.json()).includes(annotationText);
  }, { timeout: 20000 }).toBe(true);

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["--yes", "agentation-mcp", "server", "--mcp-only", "--http-url", "http://127.0.0.1:4747"],
    stderr: "pipe",
  });
  const client = new Client({ name: "midad-agentation-ci-check", version: "1.0.0" }, { capabilities: {} });

  try {
    await client.connect(transport);
    const toolResult = await client.callTool({ name: "agentation_get_all_pending", arguments: {} });
    expect(JSON.stringify(toolResult)).toContain(annotationText);
    expect(JSON.stringify(toolResult)).toContain("MIDAD");
  } finally {
    await client.close().catch(() => {});
  }
});
