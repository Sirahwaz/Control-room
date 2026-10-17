import { test, expect } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const annotationText = "MIDAD-CI-E2E: toolbar note reached MCP";

test("browser toolbar annotation is readable through the Agentation MCP tool", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Agentation end-to-end test" })).toBeVisible();

  // Prove that the HTTP service is healthy before interacting with the toolbar.
  const health = await request.get("http://127.0.0.1:4747/health");
  expect(health.ok()).toBeTruthy();

  // Create a real annotation through the official browser toolbar.
  await page.getByRole("button", { name: "Start feedback mode" }).click();
  await page.getByRole("button", { name: "E2E sample control" }).click();
  await page.getByPlaceholder("What should change?").fill(annotationText);
  await page.getByRole("button", { name: "Add", exact: true }).click();

  // Wait for the toolbar's HTTP sync to save the exact annotation.
  await expect.poll(async () => {
    const response = await request.get("http://127.0.0.1:4747/pending");
    if (!response.ok()) return false;
    const payload = await response.json();
    return JSON.stringify(payload).includes(annotationText);
  }, { timeout: 20000 }).toBe(true);

  // Now check the other side of the full path: the MCP tool must return the same note.
  const transport = new StdioClientTransport({
    command: "npx",
    args: [
      "--yes",
      "agentation-mcp",
      "server",
      "--mcp-only",
      "--http-url",
      "http://127.0.0.1:4747",
    ],
    stderr: "pipe",
  });
  const client = new Client(
    { name: "midad-agentation-ci-check", version: "1.0.0" },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);
    const toolResult = await client.callTool({
      name: "agentation_get_all_pending",
      arguments: {},
    });
    expect(JSON.stringify(toolResult)).toContain(annotationText);
  } finally {
    await client.close().catch(() => {});
  }
});
