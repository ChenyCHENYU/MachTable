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
