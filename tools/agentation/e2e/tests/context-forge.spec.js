import { test, expect } from "@playwright/test";

test("Context Forge mobile compiles, flags contradictions, and saves only after a user action", async ({ page }) => {
  await page.goto("/");
  const frame = page.frameLocator('iframe[title="MIDAD product preview"]');
  await expect(frame.locator("body")).toBeVisible();

  const isContextForge = await page.locator('iframe[title="MIDAD product preview"]').evaluate(iframe => {
    try { return iframe.contentDocument?.documentElement?.dataset.productKey === "context-forge"; }
    catch { return false; }
  });
  test.skip(!isContextForge, "Context Forge-only flow");

  await frame.getByRole("button", { name: "مثال: مشروع" }).click();
  await frame.getByRole("button", { name: "حلّل السياق" }).click();
  await expect(frame.locator("#results-panel")).toBeVisible();
  await expect(frame.locator("#metric-claims")).not.toHaveText("0");
  await expect(frame.locator("#metric-conflicts")).toHaveText("1");

  await frame.getByRole("button", { name: "احفظ محليًا" }).click();
  await expect(frame.locator("#history-panel")).toBeVisible();
  await expect(frame.locator("#history-list .history-card")).toHaveCount(1);

  await frame.getByRole("button", { name: "مسودة خطة محلية" }).click();
  await expect(frame.locator("#draft-panel")).toBeVisible();
  await expect(frame.locator("#draft-panel")).toContainText("INFERRED");
});
