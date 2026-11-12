import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import type { GridApi } from "../../packages/core/src/index";

declare global { interface Window { headerDragApi: GridApi } }
const root = resolve(import.meta.dirname, "../../packages/core");

test("pointer column moves resolve special IDs within all three current header panes", async ({ page }) => {
  const pairs = ["left", "center", "right"].map(pane => ({ pane, source: `${pane}\"\\\n[value]`, anchor: `${pane}-anchor` }));
  const url = "http://127.0.0.1:4173/__header-drag";
  await page.route(url, route => route.fulfill({ contentType: "text/html", body: `<!doctype html><meta charset="utf-8">
    <link rel="stylesheet" href="/@fs${root}/dist/mach-table.css">
    <div id="grid" style="height:320px;width:1040px"></div>
    <script type="module">
    import {createGrid} from '/@fs${root}/dist/index.js';
    const pairs=${JSON.stringify(pairs)};
    window.headerDragApi=createGrid(document.getElementById('grid'),{
      rowKey:'id',pagination:false,rowData:[{id:'one'}],
      columnDefs:pairs.flatMap(({pane,source,anchor})=>[source,anchor].map((colId,index)=>({
        colId,field:'id',headerName:pane+'-'+(index?'anchor':'source'),width:140,
        pinned:pane==='center'?null:pane,sortable:false,filter:false
      })))
    });</script>` }));
  await page.goto(url);
  for (const pair of pairs) {
    const source = page.getByRole("columnheader", { name: `${pair.pane}-source`, exact: true });
    const anchor = page.getByRole("columnheader", { name: `${pair.pane}-anchor`, exact: true });
    const from = (await source.boundingBox())!;
    const to = (await anchor.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width - 4, to.y + to.height / 2, { steps: 8 });
    await expect(page.locator(".mach-column-drag-ghost")).toBeVisible();
    await expect(source).toHaveClass(/mach-header-cell--dragging/);
    await page.mouse.up();
    await expect(page.locator(".mach-column-drag-ghost")).toHaveCount(0);
    expect((await page.evaluate(() => window.headerDragApi.columns.getState()))
      .filter(column => column.colId === pair.source || column.colId === pair.anchor)
      .map(column => column.colId)).toEqual([pair.anchor, pair.source]);
  }
});
