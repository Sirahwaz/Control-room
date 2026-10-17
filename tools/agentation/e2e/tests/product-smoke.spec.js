import { test, expect } from "@playwright/test";

test("selected Factory product has a mobile-ready, non-blank WebView surface", async ({ page }) => {
  await page.goto("/");

  const preview = page.locator('iframe[title="MIDAD product preview"]');
  await expect(preview).toBeVisible();
  await expect.poll(async () => preview.evaluate(frame => {
    try {
      return frame.contentDocument?.readyState === "complete";
    } catch {
      return false;
    }
  }), { timeout: 15000 }).toBe(true);

  const diagnostics = await preview.evaluate(frame => {
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win) return { error: "same-origin product document is unavailable" };

    const root = doc.documentElement;
    const body = doc.body;
    const viewport = doc.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? "";
    const visibleControls = [...doc.querySelectorAll('a[href], button, input, select, textarea, [role="button"]')]
      .filter(element => {
        const rect = element.getBoundingClientRect();
        const style = win.getComputedStyle(element);
        return rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) > 0;
      }).length;

    return {
      title: doc.title.trim(),
      language: root.getAttribute("lang")?.trim() ?? "",
      direction: root.getAttribute("dir")?.trim().toLowerCase() ?? "",
      viewport,
      visibleTextLength: (body.innerText ?? "").trim().length,
      visibleControls,
      horizontalOverflow:
        root.scrollWidth > root.clientWidth + 12 ||
        body.scrollWidth > body.clientWidth + 12
    };
  });

  expect(diagnostics.error, JSON.stringify(diagnostics)).toBeUndefined();
  expect(diagnostics.title, JSON.stringify(diagnostics)).not.toBe("");
  expect(diagnostics.language, JSON.stringify(diagnostics)).not.toBe("");
  expect(["rtl", "ltr"], JSON.stringify(diagnostics)).toContain(diagnostics.direction);
  expect(diagnostics.viewport, JSON.stringify(diagnostics)).toMatch(/width\s*=\s*device-width/i);
  expect(diagnostics.visibleTextLength, JSON.stringify(diagnostics)).toBeGreaterThan(40);
  expect(diagnostics.visibleControls, JSON.stringify(diagnostics)).toBeGreaterThan(0);
  expect(diagnostics.horizontalOverflow, JSON.stringify(diagnostics)).toBe(false);
});
