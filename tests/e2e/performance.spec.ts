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
      renderedRows: bench.api.diagnostics.get().renderedRowCount
    };
  });
  expect(initial.initMs).toBeLessThan(process.env.CI ? 10_000 : 5_000);
  expect(initial.renderedCells).toBeLessThan(2_000);
  expect(initial.renderedRows).toBeLessThan(100);

  const updateMs = await page.evaluate(async () => {
    const api = (window as any).__MACH_BENCH__.api;
    const updates = Array.from({ length: 1_000 }, (_, index) => {
      const node = api.rows.getById(`r${index}`);
      return node?.data ? { ...node.data, c2: index } : null;
    }).filter(Boolean);
    const started = performance.now();
    await Promise.all(updates.map((row: any) => api.rows.transactAsync({ update: [row] })));
    return performance.now() - started;
  });
  expect(updateMs).toBeLessThan(process.env.CI ? 5_000 : 2_500);

  await page.evaluate(() => {
    const api = (window as any).__MACH_BENCH__.api;
    api.diagnostics.resetPerformance();
    api.view.refreshLayout();
    const viewport = document.querySelector("#host .mach-body-viewport--scroll") as HTMLElement;
    viewport.scrollTop = viewport.scrollHeight;
    viewport.dispatchEvent(new Event("scroll"));
  });
  await page.waitForTimeout(100);
  expect(await page.locator("#host .mach-cell").count()).toBeLessThan(2_000);

  const performanceSnapshot = await page.evaluate(() =>
    (window as any).__MACH_BENCH__.api.diagnostics.getPerformance()
  );
  expect(performanceSnapshot.sampleCount).toBeGreaterThan(0);
  expect(performanceSnapshot.renderedRows).toBeLessThan(100);
  expect(performanceSnapshot.renderedCells).toBeLessThan(2_000);
  expect(performanceSnapshot.p95RenderMs).toBeLessThan(process.env.CI ? 200 : 100);
  expect(performanceSnapshot.layoutSampleCount).toBeGreaterThan(0);
  expect(performanceSnapshot.p95LayoutMs).toBeLessThan(process.env.CI ? 250 : 120);
  expect(performanceSnapshot.modelSampleCount).toBeGreaterThanOrEqual(0);
  expect(performanceSnapshot.longTaskCount).toBeGreaterThanOrEqual(0);
  expect(performanceSnapshot.usedHeapBytes == null || performanceSnapshot.usedHeapBytes > 0).toBe(true);
});

test("continuous vertical scroll and a 500-column viewport stay bounded", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Performance budgets use one stable browser engine.");
  await page.goto("http://127.0.0.1:4176");
  await page.selectOption("#rows", "100000");
  await page.selectOption("#cols", "100");
  await page.click("#rebuild");

  const vertical = await page.evaluate(async () => {
    const api = (window as any).__MACH_BENCH__.api;
    const viewport = document.querySelector("#host .mach-body-viewport--scroll") as HTMLElement;
    api.diagnostics.resetPerformance();
    const started = performance.now();
    for (let step = 1; step <= 60; step++) {
      viewport.scrollTop = (viewport.scrollHeight - viewport.clientHeight) * step / 60;
      viewport.dispatchEvent(new Event("scroll"));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    return { elapsed: performance.now() - started, metrics: api.diagnostics.getPerformance() };
  });
  expect(vertical.elapsed).toBeLessThan(process.env.CI ? 6_000 : 3_000);
  expect(vertical.metrics.p95RenderMs).toBeLessThan(process.env.CI ? 200 : 100);
  expect(vertical.metrics.renderedCells).toBeLessThan(2_000);

  await page.selectOption("#rows", "10000");
  await page.selectOption("#cols", "500");
  await page.click("#rebuild");
  await page.waitForFunction(() => (window as any).__MACH_BENCH__?.colCount === 500);
  const horizontal = await page.evaluate(async () => {
    const api = (window as any).__MACH_BENCH__.api;
    const viewport = document.querySelector("#host .mach-body-viewport--scroll") as HTMLElement;
    api.diagnostics.resetPerformance();
    viewport.scrollLeft = viewport.scrollWidth;
    viewport.dispatchEvent(new Event("scroll"));
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return {
      metrics: api.diagnostics.getPerformance(),
      cells: document.querySelectorAll("#host .mach-cell").length,
      columns: document.querySelectorAll("#host .mach-header-cell").length
    };
  });
  expect(horizontal.cells).toBeLessThan(2_000);
  expect(horizontal.columns).toBeLessThan(40);
  expect(horizontal.metrics.p95RenderMs).toBeLessThan(process.env.CI ? 250 : 120);
});

test("repeated mount and destroy does not accumulate grid roots", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Lifecycle soak runs once in the stable browser engine.");
  await page.goto("http://127.0.0.1:4176");
  await page.selectOption("#rows", "1000");
  await page.selectOption("#cols", "8");
  for (let iteration = 0; iteration < 30; iteration++) await page.click("#rebuild");
  expect(await page.locator("#host > .mach-root").count()).toBe(1);
  expect(await page.locator("#host .mach-row").count()).toBeLessThan(100);
});
