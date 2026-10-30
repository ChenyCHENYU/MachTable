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

test('native cell controls retain keyboard activation and clipboard ownership', async ({ page }) => {
  await page.evaluate(() => window.columnPresentationApi.updateOptions({ columnDefs: [{
    field: 'id', headerName: '内嵌控件', width: 640, editable: true, cellRenderer: () => {
      const container = document.createElement('div');
      container.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%';
      const button = document.createElement('button');
      button.textContent = '打开原生详情';
      button.onclick = () => { button.dataset.count = String(Number(button.dataset.count ?? 0) + 1); };
      const input = document.createElement('input');
      input.setAttribute('aria-label', '行内备注');
      const editable = document.createElement('div');
      editable.contentEditable = 'true';
      editable.style.cssText = 'min-height:20px;min-width:80px';
      editable.setAttribute('role', 'textbox');
      editable.setAttribute('aria-label', '富文本备注');
      container.append(button, input, editable);
      return container;
    }
  }] }));
  const button = page.getByRole('button', { name: '打开原生详情' }).first();
  await button.focus();
  await button.press('Enter');
  await button.press('Space');
  await expect(button).toHaveAttribute('data-count', '2');
  const input = page.getByRole('textbox', { name: '行内备注', exact: true }).first();
  await input.fill('draft');
  expect(await input.evaluate(element => {
    const event = new Event('cut', { bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(false);
  const editable = page.getByRole('textbox', { name: '富文本备注' }).first();
  await editable.fill('draft');
  await editable.press('Enter');
  await expect(page.locator('.mach-cell-editor-shell')).toHaveCount(0);
});
