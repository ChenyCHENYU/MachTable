import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import type { GridApi, RowDragEndEvent } from "../../packages/core/src/index";

interface Row { id: string; name: string; status: string }
declare global {
  interface Window { presentationApi: GridApi<Row>; presentationEvents: RowDragEndEvent<Row>[] }
}
const root = resolve(import.meta.dirname, "../../packages/core");
const fixtureUrl = "http://127.0.0.1:4173/__row-presentation";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 760 });
  await page.route(fixtureUrl, route => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html><head><meta charset="UTF-8"><link rel="stylesheet" href="/@fs${root}/dist/mach-table.css">
      <style>body{margin:48px;background:#f4f7fb;font:14px -apple-system,sans-serif;color:#26303f}h1{font-size:22px;margin:0 0 10px}p{color:#64748b;margin:0 0 24px}#grid{height:440px;border-radius:8px;overflow:hidden;box-shadow:0 8px 28px #1725540c}</style>
      </head><body><h1>生产计划 · 顺序与状态</h1><p>拖动左侧手柄调整顺序 · 条件颜色仅标记需要关注的行</p><div id="grid"></div>
      <script type="module">
      import {createGrid,dragColumn,indexColumn,selectionColumn} from '/@fs${root}/dist/index.js';
      window.presentationEvents=[];
      window.presentationApi=createGrid(document.getElementById('grid'),{
        rowKey:'id',pagination:false,columnLayout:'fit',stripedRows:true,rowSelection:'multiple',
        columnDefs:[dragColumn(),selectionColumn(),indexColumn(),{field:'id',headerName:'计划编号',pinned:'left',width:150},
          {field:'name',headerName:'计划名称',minWidth:220,flex:1},{field:'status',headerName:'计划状态',width:160,pinned:'right'}],
        rowData:Array.from({length:100},(_,i)=>({id:'P'+String(i+1).padStart(4,'0'),name:'生产计划 '+(i+1),status:['已下达','待复核','已完成','草稿'][i%4]})),
        rowStyleRules:[{when:({data})=>data.status==='已下达',tone:'warning'},{when:({data})=>data.status==='待复核',tone:'danger'},{when:({data})=>data.status==='已完成',tone:'success'}],
        onRowDragEnd:event=>window.presentationEvents.push(event)
      });</script></body></html>`
  }));
  await page.goto(fixtureUrl);
  await expect(page.locator('.mach-row[data-id="P0001"]').first()).toBeVisible();
  await expect(page.locator('.mach-row[data-id="P0001"] .mach-row-drag-handle')).toBeVisible();
});

test("row colors span pinned panes, survive selection and clear on refresh/recycling in both themes", async ({ page }) => {
  const row = page.locator('.mach-row[data-id="P0001"]');
  const colors = () => row.evaluateAll(rows => rows.map(element => getComputedStyle(element.querySelector('.mach-cell')!).backgroundColor));
  const light = await colors();
  expect(new Set(light).size).toBe(1);
  expect(light[0]).not.toBe('rgb(255, 255, 255)');
  // Both rows are odd: a status rule must outrank zebra backgrounds in every pane.
  const readBackground = (id: string) => page.locator(`.mach-row[data-id="${id}"] .mach-cell`).first().evaluate(element => getComputedStyle(element).backgroundColor);
  await expect.poll(async () => (await readBackground('P0002')) !== (await readBackground('P0004'))).toBe(true);
  await page.locator('.mach-row[data-id="P0001"] .mach-row-checkbox').check();
  expect((await colors())[0]).not.toBe(light[0]);
  await page.evaluate(() => window.presentationApi.updateOptions({ theme: 'dark' }));
  await expect.poll(async () => (await colors())[0]).not.toBe(light[0]);
  await expect.poll(() => page.locator('.mach-header').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(16, 26, 46)');
  await page.screenshot({ path: '/private/tmp/machtable-row-colors-dark.png', animations: 'disabled' });
  await page.evaluate(() => window.presentationApi.rows.transact({ update: [{ id: 'P0001', name: '生产计划 1', status: '草稿' }] }));
  await expect(row.first()).not.toHaveClass(/mach-row--styled/);
  await page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('.mach-body-viewport--scroll')!;
    viewport.scrollTop = viewport.scrollHeight;
  });
  await expect(page.locator('.mach-row[data-id="P0100"]').first()).toBeVisible();
  await expect(page.locator('.mach-row[data-id="P0100"]').first()).not.toHaveClass(/mach-row--styled/);
  await page.evaluate(() => window.presentationApi.updateOptions({ rowStyleRules: [] }));
  await expect(page.locator('.mach-row--styled')).toHaveCount(0);
});

test("pointer reorder has themed preview and cross-pane indicators and preserves business identities", async ({ page }) => {
  const source = page.locator('.mach-row[data-id="P0001"] .mach-row-drag-handle');
  await source.hover();
  const sourceBox = (await source.boundingBox())!;
  const target = (await page.locator('.mach-row[data-id="P0003"]').first().boundingBox())!;
  await page.mouse.move(sourceBox.x + 12, sourceBox.y + 12);
  await page.mouse.down();
  await page.mouse.move(sourceBox.x + 12, target.y + target.height - 5, { steps: 8 });
  await expect(page.locator('.mach-row-drag-preview')).toBeVisible();
  await expect(page.locator('.mach-row-drag-preview')).toHaveText('第 1 行 → 第 3 行');
  await expect(page.locator('.mach-row-drop-indicator:visible')).toHaveCount(3);
  await page.screenshot({ path: '/private/tmp/machtable-row-drag-light.png', animations: 'disabled' });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.presentationApi.rows.getAt(2)?.id)).toBe('P0001');
  expect(await page.evaluate(() => ({ index: window.presentationEvents[0].targetIndex, applied: window.presentationEvents[0].applied }))).toEqual({ index: 2, applied: true });
  await expect(page.locator('.mach-row-drag-preview, .mach-row-drop-indicator')).toHaveCount(0);
  await expect(page.locator('.mach-row[data-id="P0001"]').first()).toHaveAttribute('data-row-tone','warning');
});

test("edge scrolling continues without pointer movement and Escape cancels", async ({ page }) => {
  const source = page.locator('.mach-row[data-id="P0001"] .mach-row-drag-handle');
  await source.hover();
  const handle = (await source.boundingBox())!;
  const viewport = page.locator('.mach-body-viewport--scroll');
  const box = (await viewport.boundingBox())!;
  await page.mouse.move(handle.x + 10, handle.y + 10);
  await page.mouse.down();
  await page.mouse.move(handle.x + 10, box.y + box.height - 6, { steps: 6 });
  await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(120);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('.mach-row-drag-preview, .mach-row-drop-indicator')).toHaveCount(0);
  expect(await page.evaluate(() => window.presentationEvents.length)).toBe(0);
});

test("keyboard moves keep handle focus and column sort disables automatic ordering", async ({ page }) => {
  const handle = page.locator('.mach-row[data-id="P0001"] .mach-row-drag-handle');
  await handle.click();
  expect(await page.evaluate(() => window.presentationApi.selection.getRows().length)).toBe(0);
  await handle.focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect.poll(() => page.evaluate(() => window.presentationApi.rows.getAt(1)?.id)).toBe('P0001');
  await expect(page.locator('.mach-row[data-id="P0001"] .mach-row-drag-handle')).toBeFocused();
  await page.evaluate(() => window.presentationApi.sorting.setModel([{ colId:'id',direction:'asc' }]));
  await expect(handle).toBeDisabled();
  await page.evaluate(() => window.presentationApi.sorting.setModel([]));
  await expect(handle).toBeEnabled();
});
