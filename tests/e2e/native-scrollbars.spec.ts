import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import type { GridApi } from "../../packages/core/src/index";

declare global { interface Window { nativeScrollbarGrid: GridApi } }
const core = resolve(import.meta.dirname, "../../packages/core");
// Headless Chromium otherwise disables the scrollbar being verified here.
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

for (const pinned of [false, true]) {
  test(`native horizontal scrolling preserves the last auto-height row ${pinned ? "with" : "without"} frozen panes`, async ({ page, browserName }) => {
    const url = "http://127.0.0.1:4173/__native-scrollbars";
    await page.route(url, route => route.fulfill({ contentType: "text/html", body: `<!doctype html>
      <link rel="stylesheet" href="/@fs${core}/dist/mach-table.css">
      <style>#grid{width:480px;height:auto}</style><div id="grid"></div>
      <script type="module">
      import{createGrid}from'/@fs${core}/dist/index.js';
      window.nativeScrollbarGrid=createGrid(document.getElementById('grid'),{
        rowKey:'id',rowNumber:false,pagination:false,domLayout:'autoHeight',rowHeight:30,
        defaultColDef:{sortable:false,filter:false,suppressColumnMenu:true},
        columnDefs:[${pinned ? "{field:'id',colId:'left',headerName:'L',pinned:'left',width:80}," : ""}
          {field:'name',headerName:'名称',width:900}${pinned ? ",{field:'id',colId:'right',headerName:'R',pinned:'right',width:80}" : ""}],
        rowData:[{id:'0',name:'第一行'},{id:'1',name:'最后一行'}]
      });
      </script>` }));
    await page.goto(url);
    const viewport = page.locator(".mach-body-viewport--scroll");
    const metrics = () => viewport.evaluate(element => {
      const last = element.querySelector<HTMLElement>('.mach-row[data-id="1"]')!;
      const body = element.closest(".mach-body")!;
      return {
        body: body.getBoundingClientRect().height,
        gutter: (element as HTMLElement).offsetHeight - element.clientHeight,
        lastBottom: last.getBoundingClientRect().bottom,
        visibleBottom: element.getBoundingClientRect().top + element.clientHeight,
        y: getComputedStyle(element).overflowY,
        scrollTop: element.scrollTop
      };
    });
    const visibleLastRow = async () => {
      await expect.poll(async () => {
        const result = await metrics();
        return result.lastBottom <= result.visibleBottom + 1;
      }).toBe(true);
    };
    await visibleLastRow();
    if (browserName !== "firefox") expect((await metrics()).gutter).toBeGreaterThan(0);
    expect((await metrics()).body).toBe(60 + (await metrics()).gutter);

    for (let trial = 0; trial < 3; trial++) {
      await page.evaluate(() => window.nativeScrollbarGrid.columns.setWidth("name", 100));
      await expect.poll(async () => (await metrics()).body).toBe(60);
      await visibleLastRow();
      await page.evaluate(() => window.nativeScrollbarGrid.columns.setWidth("name", 900));
      await visibleLastRow();
      const expected = 60 + (await metrics()).gutter;
      for (let frame = 0; frame < 3; frame++) {
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
        expect((await metrics()).body).toBe(expected);
      }
    }

    await page.evaluate(() => window.nativeScrollbarGrid.updateOptions({ maxBodyHeight: 60 }));
    await expect.poll(async () => (await metrics()).body).toBe(60);
    if ((await metrics()).gutter > 0) {
      expect((await metrics()).y).toBe("auto");
      await page.evaluate(() => window.nativeScrollbarGrid.view.scrollToRow(1, "bottom"));
      await visibleLastRow();
    }
    await page.evaluate(() => window.nativeScrollbarGrid.updateOptions({ maxBodyHeight: 80 }));
    await visibleLastRow();
    expect((await metrics()).scrollTop).toBe(0);
    await page.evaluate(() => window.nativeScrollbarGrid.rows.setData([]));
    await expect(page.getByText("暂无数据", { exact: true })).toBeVisible();
    await expect(page.locator(".mach-body")).toHaveCSS("height", "0px");
  });
}
