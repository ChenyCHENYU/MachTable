import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import type { GridApi } from "../../packages/core/src/index";

declare global { interface Window { resizeIsolation: GridApi } }
const core = resolve(import.meta.dirname, "../../packages/core");

for (const columnLayout of ["normal", "fit"] as const) {
  test(`${columnLayout} manual resizing leaves other widths stable and retains automatic sizing`, async ({ page }) => {
    const url = "http://127.0.0.1:4173/__resize-isolation";
    await page.route(url, route => route.fulfill({ contentType: "text/html", body: `<!doctype html>
      <link rel="stylesheet" href="/@fs${core}/dist/mach-table.css">
      <style>#grid{width:800px;height:360px}</style><div id="grid"></div>
      <script type="module">
      import{createGrid}from'/@fs${core}/dist/index.js';
      window.resizeIsolation=createGrid(document.getElementById('grid'),{
        rowNumber:false,pagination:false,enableColumnResize:true,columnLayout:'${columnLayout}',
        columnDefs:[{field:'id',colId:'left',width:90,pinned:'left'},
          {field:'name',headerName:'生产计划',width:180,filter:true},
          {field:'amount',headerName:'计划量',width:180,flex:1},
          {field:'id',colId:'right',width:90,pinned:'right'}],
        rowData:[{id:'P1',name:'计划一',amount:12.5}]
      });
      </script>` }));
    await page.goto(url);
    const header = page.locator('.mach-header-cell[data-col-id="name"]');
    const handle = header.locator('.mach-header-resize');
    await expect(handle).toBeVisible();
    const widths = () => page.locator('.mach-header-cell--leaf').evaluateAll(elements => Object.fromEntries(
      elements.map(element => [(element as HTMLElement).dataset.colId, element.getBoundingClientRect().width])
    ));
    const before = await widths();
    const others = (values: Record<string, number>) => [values.left, values.amount, values.right];
    const start = (await handle.boundingBox())!;
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(start.x + start.width / 2 + 64, start.y + start.height / 2, { steps: 6 });
    await expect.poll(async () => (await widths()).name).toBeCloseTo(before.name + 64, 0);
    expect(others(await widths())).toEqual(others(before));
    await page.mouse.up();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(others(await widths())).toEqual(others(before));
    await header.focus();
    await header.press("Alt+ArrowLeft");
    expect(others(await widths())).toEqual(others(before));

    const stable = await widths();
    const cancel = (await handle.boundingBox())!;
    await page.mouse.move(cancel.x + cancel.width / 2, cancel.y + cancel.height / 2);
    await page.mouse.down();
    await page.mouse.move(cancel.x + cancel.width / 2 - 48, cancel.y + cancel.height / 2, { steps: 4 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect(await widths()).toEqual(stable);

    // A genuine layout-mode change releases the snapshot while keeping the target manual width.
    await page.evaluate(mode => window.resizeIsolation.updateOptions({ columnLayout: mode }),
      columnLayout === "fit" ? "normal" : "fit");
    await expect.poll(async () => (await widths()).amount).not.toBe(stable.amount);
    expect((await widths()).name).toBe(stable.name);
    await page.evaluate(mode => window.resizeIsolation.updateOptions({ columnLayout: mode }), columnLayout);

    const beforeApiResize = await widths();
    await page.evaluate(() => window.resizeIsolation.columns.setWidth("name", 280));
    expect(others(await widths())).toEqual(others(beforeApiResize));
    await handle.dblclick();
    const label = header.locator(".mach-header-label");
    expect(await label.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    const resized = await widths();
    await page.locator("#grid").evaluate(element => { (element as HTMLElement).style.width = "1000px"; });
    await expect.poll(async () => (await widths()).amount).not.toBe(resized.amount);
    expect(await page.evaluate(() => window.resizeIsolation.columns.getState().find(column => column.colId === "amount")?.widthMode)).toBe("auto");
  });
}
