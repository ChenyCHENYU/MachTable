import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import type { GridApi } from "../../packages/core/src/index";

interface TestRow { id: string; name: string; note: string }
declare global { interface Window { widthFixtureApi: GridApi<TestRow> } }

const root = resolve(import.meta.dirname, "../../packages/core");
const fixtureUrl = "http://127.0.0.1:4173/__responsive-widths";

test("fit layout fills the real viewport with pinned columns, content sizing and manual preferences", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.route(fixtureUrl, route => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html><head>
      <link rel="stylesheet" href="/@fs${root}/styles/mach-table.css">
      <style>body{margin:20px}#grid{height:420px}</style></head><body><div id="grid"></div>
      <script type="module">
      import {createGrid, selectionColumn, indexColumn} from '/@fs${root}/dist/index.js';
      window.widthFixtureApi = createGrid(document.getElementById('grid'), {
        columnLayout:'fit', enableColumnResize:true, pagination:false,
        columnDefs:[selectionColumn(),indexColumn(),
          {field:'name',width:140,minWidth:120},
          {field:'note',width:280,minWidth:180},
          {colId:'actions',width:128,pinned:'right',suppressSizeToFit:true}],
        rowData:Array.from({length:100},(_,index)=>({id:String(index),name:'Alpha',note:'A longer description'}))
      });
      </script></body></html>`
  }));
  await page.goto(fixtureUrl);
  const read = () => page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>(".mach-body-viewport--scroll")!;
    const widths = Object.fromEntries(window.widthFixtureApi.columns.getState().map(column => [column.colId, column.width!]));
    return { available: viewport.clientWidth, scrollWidth: viewport.scrollWidth, filled: widths.name + widths.note, widths };
  });
  const expectFilled = () => expect.poll(async () => {
    const state = await read();
    return Math.abs(state.available - state.filled);
  }).toBeLessThan(2);

  await expect(page.locator(".mach-row").first()).toBeVisible();
  await expectFilled();
  await page.evaluate(() => window.widthFixtureApi.columns.autoSizeAll());
  await expectFilled();
  const content = await read();
  await page.setViewportSize({ width: 2400, height: 900 });
  await expectFilled();
  const wide = await read();
  expect(wide.widths.name).toBeGreaterThan(content.widths.name);
  expect(wide.widths.name / wide.widths.note).toBeCloseTo(content.widths.name / content.widths.note, 2);
  expect(wide.widths.actions).toBe(128);
  expect(wide.widths.sel).toBe(40);
  expect(wide.widths.idx).toBe(52);
  await page.evaluate(() => window.widthFixtureApi.columns.setWidth("name", 200));
  await page.setViewportSize({ width: 1800, height: 900 });
  await expectFilled();
  expect((await read()).widths.name).toBe(200);
  await page.evaluate(() => window.widthFixtureApi.columns.resetState());
  await page.setViewportSize({ width: 500, height: 900 });
  await expect.poll(async () => {
    const state = await read();
    return state.scrollWidth - state.available;
  }).toBeGreaterThan(0);
  const narrow = await read();
  expect(narrow.widths.name).toBeGreaterThanOrEqual(120);
  expect(narrow.widths.note).toBeGreaterThanOrEqual(180);
});

test("manual shrinking fills row backgrounds to the right pinned pane without wrapping text", async ({ page }, info) => {
  const url = new URL("/__manual-shrink-background", info.project.use.baseURL ?? "http://127.0.0.1:4173").href;
  await page.route(url, route => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/@fs${root}/styles/mach-table.css">
      <style>body{margin:20px}#grid{width:1000px;height:260px}</style><div id="grid"></div>
      <script type="module">
      import{createGrid}from'/@fs${root}/src/index.ts';
      window.widthFixtureApi=createGrid(document.getElementById('grid'),{
        rowNumber:false,pagination:false,rowSelection:'multiple',enableColumnResize:true,columnMenu:false,
        defaultColDef:{sortable:false,filter:false},
        columnDefs:[{field:'id',width:90,pinned:'left'},
          {field:'name',headerName:'客户名称'},{field:'note',headerName:'交付备注'},
          {colId:'actions',headerName:'操作',width:120,pinned:'right'}],
        rowData:[{id:'one',name:'BEGIN-工业订单完整名称-ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789-END',note:'交付说明'}]
      });</script>`
  }));
  await page.goto(url);
  const grid = page.locator(".mach-root");
  const header = grid.locator('.mach-header-cell[data-col-id="name"]');
  const handle = header.locator(".mach-header-resize");
  await expect(handle).toBeVisible();
  const widths = () => page.evaluate(() => Object.fromEntries(window.widthFixtureApi.columns.getState().map(column => [column.colId, column.width!])));
  const before = await widths();
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const delta = -Math.floor(before.name - 100);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + delta, y, { steps: 5 });
  await expect.poll(async () => (await widths()).name).toBeCloseTo(before.name + delta, 0);
  await page.mouse.up();
  const after = await widths();
  for (const id of ["id", "note", "actions"]) expect(after[id]).toBe(before[id]);
  await page.evaluate(() => window.widthFixtureApi.selection.selectAll());
  await expect(grid.locator(".mach-row--selected")).toHaveCount(3);
  const geometry = () => grid.evaluate(element => {
    const viewport = element.querySelector<HTMLElement>(".mach-body-viewport--scroll")!;
    const row = viewport.querySelector<HTMLElement>(".mach-row")!;
    const right = element.querySelector<HTMLElement>(".mach-body-pane.mach-pane--right")!;
    const body = element.querySelector<HTMLElement>(".mach-body")!;
    const cell = row.querySelector<HTMLElement>('[data-col-id="name"]')!;
    const range = document.createRange();
    range.selectNodeContents(cell.querySelector(".mach-cell-text") ?? cell);
    const text = range.getBoundingClientRect();
    return { centerAvailable:viewport.clientWidth,rowWidth:row.getBoundingClientRect().width,
      rightPaneEnd:right.getBoundingClientRect().right,bodyEnd:body.getBoundingClientRect().right,
      // Chromium may report both the full and ellipsized rect for one baseline.
      cellWhiteSpace:getComputedStyle(cell).whiteSpace,textLines:new Set(Array.from(range.getClientRects(),rect=>Math.round(rect.top))).size,
      textRects:Array.from(range.getClientRects(),rect=>({top:rect.top,height:rect.height,width:rect.width})),
      cellLeft:cell.getBoundingClientRect().left,cellRight:cell.getBoundingClientRect().right,
      textLeft:text.left,textRight:text.right,title:cell.title };
  });
  const shrunk = await geometry();
  await info.attach("manual-shrink-geometry.json", { body:JSON.stringify(shrunk,null,2),contentType:"application/json" });
  expect(shrunk.rightPaneEnd).toBeCloseTo(shrunk.bodyEnd, 0);
  expect(shrunk.cellWhiteSpace).toBe("nowrap");
  expect(shrunk.textLines).toBe(1);
  expect(shrunk.title).toContain("BEGIN-");
  await page.screenshot({ path:info.outputPath("manual-shrink-background.png") });
  expect(shrunk.rowWidth).toBeCloseTo(shrunk.centerAvailable, 0);
  await page.locator("#grid").evaluate(element => { (element as HTMLElement).style.width = "180px"; });
  await expect.poll(() => grid.locator(".mach-body").evaluate(element => element.clientWidth)).toBe(178);
  await expect.poll(() => grid.locator(".mach-body-viewport--scroll").evaluate(element => element.clientWidth)).toBe(0);
  expect(await grid.locator(".mach-row-container").evaluateAll(elements => elements.every(element => parseFloat((element as HTMLElement).style.width || "0") >= 0))).toBe(true);
});
