import { expect, test } from "@playwright/test";

test("100k rows and 100 columns remain virtualized under update pressure", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Performance budgets use one stable browser engine.");
  await page.goto("http://127.0.0.1:4176");
  await page.selectOption("#rows", "100000");
  await page.selectOption("#cols", "100");
  await page.click("#rebuild");
  await page.waitForFunction(() => (window as any).__MACH_BENCH__?.rowCount === 100000);

  const initial = await page.evaluate(() => {
    const bench = (window as any).__MACH_BENCH__;
    return {
      initMs: bench.initMs,
      renderedCells: document.querySelectorAll("#host .mach-cell").length,
      renderedRows: bench.api.getDiagnostics().renderedRowCount
    };
  });
  expect(initial.initMs).toBeLessThan(process.env.CI ? 10_000 : 5_000);
  expect(initial.renderedCells).toBeLessThan(2_000);
  expect(initial.renderedRows).toBeLessThan(100);

  const updateMs = await page.evaluate(async () => {
    const api = (window as any).__MACH_BENCH__.api;
    const updates = Array.from({ length: 1_000 }, (_, index) => {
      const node = api.getNodeById(`r${index}`);
      return node?.data ? { ...node.data, c2: index } : null;
    }).filter(Boolean);
    const started = performance.now();
    await Promise.all(updates.map((row: any) => api.applyTransactionAsync({ update: [row] })));
    return performance.now() - started;
  });
  expect(updateMs).toBeLessThan(process.env.CI ? 5_000 : 2_500);

  await page.evaluate(() => {
    const viewport = document.querySelector("#host .mach-body-viewport--scroll") as HTMLElement;
    viewport.scrollTop = viewport.scrollHeight;
    viewport.dispatchEvent(new Event("scroll"));
  });
  await page.waitForTimeout(100);
  expect(await page.locator("#host .mach-cell").count()).toBeLessThan(2_000);
});
