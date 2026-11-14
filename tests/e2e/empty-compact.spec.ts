import { expect, test, type Locator } from "@playwright/test";
import { resolve } from "node:path";
import type { GridApi } from "../../packages/core/src/index";

declare global { interface Window { emptyCompactFixture: GridApi } }
const core = resolve(import.meta.dirname, "../../packages/core");

async function fits(root: Locator): Promise<void> {
  // Overlay replacement is frame-scheduled; measure from the stable root so a
  // detached previous overlay cannot race the geometry assertion.
  await expect.poll(() => root.evaluate(root => {
    const empty = root.querySelector(".mach-empty");
    if (!empty?.children.length) return false;
    const bounds = root.getBoundingClientRect();
    return [...empty.children].every(child => {
      const box = child.getBoundingClientRect();
      const hit = root.ownerDocument.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return box.top >= bounds.top && box.bottom <= bounds.bottom && box.left >= bounds.left && box.right <= bounds.right &&
        box.height > 0 && (hit === child || child.contains(hit));
    });
  })).toBe(true);
}

for (const height of [120, 150, 360]) {
  test(`${height}px default/filtered empty keeps text and reset usable without changing custom/loading/autoHeight`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const url = new URL("/__empty-compact", info.project.use.baseURL ?? "http://127.0.0.1:4173").href;
    await page.route(url, route => route.fulfill({ contentType: "text/html", body: `<!doctype html><meta charset="utf-8">
      <link rel="stylesheet" href="/@fs${core}/styles/mach-table.css">
      <style>body{margin:24px;background:#f3f6fb}#grid{width:360px;height:${height}px}</style>
      <div id="grid"></div><script type="module">
      import {createGrid} from '/@fs${core}/src/index.ts';
      window.emptyCompactFixture=createGrid(document.getElementById('grid'),{rowKey:'id',rowNumber:false,pagination:false,
        locale:{emptyRows:'没有可显示的行',emptyRowsHint:'请调整筛选条件后重试',clearFilters:'清除筛选'},
        columnDefs:[{field:'value',headerName:'结果',width:150}],rowData:[]});</script>` }));
    await page.goto(url);
    const root = page.locator(".mach-root");
    await expect(root.locator(".mach-empty")).toBeVisible();
    await page.screenshot({ path: info.outputPath(`empty-${height}.png`) });
    await fits(root);
    if (height === 360) await expect(root.locator(".mach-empty__icon")).toHaveCSS("height", "84px");
    await page.evaluate(() => {
      window.emptyCompactFixture.rows.setData([{ id: "1", value: "before" }]);
      window.emptyCompactFixture.filtering.setQuickText("no-match");
    });
    await fits(root);
    await root.getByRole("button", { name: "清除筛选", exact: true }).click();
    await expect(root.locator('.mach-row[data-id="1"]')).toBeVisible();
    await page.evaluate(() => window.emptyCompactFixture.view.setOverlay("loading"));
    await expect(root.locator(".mach-loading")).toBeVisible();
    await expect(root.locator(".mach-loading__row")).toHaveCount(3);
    await expect(root.locator(".mach-overlay-content")).not.toHaveCSS("height", `${height - 2}px`);
    await page.evaluate(() => {
      window.emptyCompactFixture.updateOptions({ overlayNoRowsTemplate: () => {
        const custom = document.createElement("div"); custom.textContent = "custom";
        custom.style.cssText = "width:70px;height:36px"; custom.dataset.testid = "custom-empty"; return custom;
      } });
      window.emptyCompactFixture.view.setOverlay("noRows");
    });
    await expect(root.getByTestId("custom-empty")).toHaveCSS("height", "36px");
    await expect(root.locator(".mach-overlay-content")).toHaveCSS("height", "36px");
    await page.evaluate(() => {
      const api = window.emptyCompactFixture;
      api.updateOptions({ overlayNoRowsTemplate: undefined, domLayout: "autoHeight" });
      api.rows.setData([]);
    });
    await fits(root);
    await expect(root).toHaveCSS("min-height", "180px");
    await expect(root.locator(".mach-empty__icon")).toHaveCSS("height", "84px");
    expect(errors).toEqual([]);
  });
}
