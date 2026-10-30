import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import type { GridApi } from "../../packages/core/src/index";

declare global { interface Window { columnPresentationApi: GridApi } }
const root = resolve(import.meta.dirname, "../../packages/core");
const url = "http://127.0.0.1:4173/__column-presentation";

test.beforeEach(async ({ page }) => {
  await page.route(url, route => route.fulfill({ contentType: "text/html", body: `<!doctype html><meta charset="utf-8">
    <link rel="stylesheet" href="/@fs${root}/dist/mach-table.css">
    <style>body{margin:24px;background:#f3f6fb}#grid{height:420px;width:1040px}</style><div id="grid"></div>
    <script type="module">
    import {createGrid,indexColumn} from '/@fs${root}/dist/index.js';
    window.columnPresentationApi=createGrid(document.getElementById('grid'),{
      pagination:false,enableColumnResize:true,columnMenu:true,size:'compact',showCellBorders:true,
      columnDefs:[indexColumn(),{field:'id',headerName:'生产计划',width:240,filter:true},
        {field:'note',headerName:'备注'},{field:'status',headerName:'状态',status:{S1B:{label:'待复核',color:'danger'},S1C:{label:'已完成',color:'success'}}}],
      rowData:[{id:'P001',note:'异常长的备注'.repeat(1000),status:'S1B'},{id:'P002',note:'普通备注',status:'S1C'}]
    });</script>` }));
  await page.goto(url);
  await expect(page.locator('.mach-tag--danger')).toHaveText('待复核');
});

test('automatic widths stay bounded and status tags retain their theme', async ({ page }) => {
  const widths = await page.evaluate(() => window.columnPresentationApi.columns.getState());
  expect(widths.find(column => column.colId === 'id')?.width).toBe(240);
  expect(widths.find(column => column.colId === 'note')?.width).toBe(360);
  const tag = page.locator('.mach-tag--success');
  await expect(tag).toHaveText('已完成');
  const light = await tag.evaluate(element => getComputedStyle(element).color);
  await page.evaluate(() => window.columnPresentationApi.updateOptions({ theme: 'dark' }));
  await expect.poll(() => tag.evaluate(element => getComputedStyle(element).color)).not.toBe(light);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('pointer and keyboard shrinking keep all four header characters visible', async ({ page }) => {
  const header = page.locator('.mach-header-cell[data-col-id="id"]');
  const label = header.locator('.mach-header-label');
  const handle = header.locator('.mach-header-resize');
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(0, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  const width = await header.evaluate(element => element.getBoundingClientRect().width);
  expect(width).toBeGreaterThan(100);
  expect(await label.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await header.focus();
  for (let i = 0; i < 8; i++) await header.press('Alt+ArrowLeft');
  expect(await header.evaluate(element => element.getBoundingClientRect().width)).toBeCloseTo(width, 0);
  expect(await label.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
});

test('initial fit and restored narrow widths never truncate complete headers', async ({ page }) => {
  await page.evaluate(() => {
    document.getElementById('grid')!.style.width = '360px';
    window.columnPresentationApi.updateOptions({ columnLayout: 'fit', columnDefs: [
      { field: 'id', headerName: '生产计划', width: 40, maxWidth: 60, filter: true },
      { field: 'note', headerName: '目标重量（吨）', width: 40, maxWidth: 60, filter: true },
      { field: 'status', headerName: 'Production equipment information', width: 40, maxWidth: 60, filter: true }
    ] });
    window.columnPresentationApi.columns.setState([{ colId: 'id', width: 30 }, { colId: 'note', width: 30 }]);
  });
  const verify = async () => {
    const failures = await page.locator('.mach-header-cell--leaf').evaluateAll(cells => cells.flatMap(cell => {
      const label = cell.querySelector('.mach-header-label')!;
      const range = document.createRange();
      range.selectNodeContents(label);
      const text = range.getBoundingClientRect();
      const bounds = cell.getBoundingClientRect();
      return text.left < bounds.left || text.right > bounds.right || getComputedStyle(label).textOverflow === 'ellipsis'
        ? [label.textContent] : [];
    }));
    expect(failures).toEqual([]);
  };
  await verify();
  await page.evaluate(() => {
    window.columnPresentationApi.columns.autoSizeAll(true);
    window.columnPresentationApi.columns.resetState();
    window.columnPresentationApi.updateOptions({ theme: 'dark' });
  });
  await verify();
  expect(await page.locator('.mach-body-viewport--scroll').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
});
