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

test("bounded natural height grows, scrolls and recovers from a filtered empty state", async ({ page }) => {
  const body = page.locator(".mach-body");
  const scroller = body.locator(".mach-body-viewport--scroll");
  const centerRows = scroller.locator(".mach-row[data-id]");
  await page.evaluate(() => {
    document.querySelector<HTMLElement>("#grid")!.style.height = "auto";
    window.columnPresentationApi.updateOptions({
      rowKey: "id", rowHeight: 30, domLayout: "autoHeight", maxBodyHeight: 120,
      columnDefs: [{ field: "id", pinned: "left", width: 120 }, { field: "name", width: 180 }],
      rowData: []
    });
  });
  await expect(page.getByText("暂无数据", { exact: true })).toBeVisible();
  await page.evaluate(() => window.columnPresentationApi.rows.setData([{ id: "1", name: "第一条" }]));
  await expect(centerRows).toHaveCount(1);
  await expect(body).toHaveCSS("height", "30px");
  await page.evaluate(() => window.columnPresentationApi.rows.setData(
    Array.from({ length: 500 }, (_, index) => ({ id: String(index), name: `计划 ${index}` }))
  ));
  await expect(body).toHaveCSS("height", "120px");
  await expect.poll(() => centerRows.count()).toBeLessThan(30);
  await scroller.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(scroller.getByText("计划 499", { exact: true })).toBeVisible();
  await page.evaluate(() => window.columnPresentationApi.filtering.setQuickText("没有匹配"));
  await expect(page.getByText("没有符合筛选条件的行")).toBeVisible();
  await page.getByRole("button", { name: "清除筛选" }).click();
  await expect(body).toHaveCSS("height", "120px");
  await page.evaluate(() => window.columnPresentationApi.filtering.setQuickText("计划 499"));
  await expect(body).toHaveCSS("height", "30px");
  await expect(centerRows).toHaveCount(1);
  await expect(centerRows).toHaveText("计划 499");
});

test("wrapped words remain fully visible after font and column width changes", async ({ page }) => {
  await page.evaluate(() => {
    document.querySelector<HTMLElement>("#grid")!.style.height = "auto";
    window.columnPresentationApi.updateOptions({
      rowNumber: false, domLayout: "autoHeight",
      columnDefs: [{ field: "name", width: 130, wrapText: true, autoHeight: true, sortable: false, filter: false }],
      rowData: [
        { id: "words", name: "abcdefghij klmnopqrst uvwxyzabcd efghijklmn opqrstuvwx yzabcdefgh ijklmnopqr stuvwxyzab" },
        { id: "mixed", name: "生产计划 manufacturing scheduling accountability production ".repeat(3) }
      ]
    });
  });
  const checkText = async () => {
    const clipped = await page.locator('.mach-pane--center .mach-row[data-id] .mach-cell').evaluateAll(cells => cells.flatMap(cell => {
      const range = document.createRange();
      range.selectNodeContents(cell);
      return range.getBoundingClientRect().bottom > cell.getBoundingClientRect().bottom + 1
        ? [cell.closest<HTMLElement>(".mach-row")!.dataset.id] : [];
    }));
    expect(clipped).toEqual([]);
  };
  await checkText();
  await page.evaluate(() => {
    const api = window.columnPresentationApi;
    api.view.getRoot()!.style.setProperty("--mach-font-size", "20px");
    api.view.refreshLayout();
  });
  await checkText();
  await page.evaluate(() => window.columnPresentationApi.columns.setWidth("name", 220));
  await checkText();
});

for (const automatic of [false, true]) {
  test(`late web fonts remeasure wrapped rows ${automatic ? "automatically" : "on explicit layout"}`, async ({ page }) => {
    const measured = await page.evaluate(async (automatic) => {
      const api = window.columnPresentationApi;
      api.updateOptions({
        rowNumber: false, pagination: false, rowKey: "id",
        columnDefs: [{ field: "name", width: 160, wrapText: true, autoHeight: true, sortable: false, filter: false }],
        rowData: [{ id: "font", name: "i".repeat(100) }]
      });
      api.view.getRoot()!.style.setProperty("--mach-font-family", "MachLateFont, Arial, sans-serif");
      api.view.refreshLayout();
      // Flush the initial ResizeObserver layout so it cannot mask a missing font refresh.
      for (let frame = 0; frame < 3; frame++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      }
      const cell = document.querySelector<HTMLElement>(".mach-row[data-id='font'] .mach-cell")!;
      const before = cell.getBoundingClientRect().height;
      // Local, commonly available monospace faces keep this test offline on macOS, Linux and Windows.
      const face = new FontFace("MachLateFont", 'local("Courier New"),local("Liberation Mono"),local("DejaVu Sans Mono"),local("Menlo")');
      if (automatic) {
        document.fonts.add(face);
        await document.fonts.load("12px MachLateFont", "i");
      } else {
        await face.load();
        document.fonts.add(face);
        api.view.refreshLayout();
      }
      await document.fonts.ready;
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const range = document.createRange();
      range.selectNodeContents(cell);
      const rect = cell.getBoundingClientRect();
      return { before, after: rect.height, clipped: Math.max(0, range.getBoundingClientRect().bottom - rect.bottom) };
    }, automatic);
    expect(measured.after).toBeGreaterThan(measured.before);
    expect(measured.clipped).toBeLessThanOrEqual(1);
  });
}

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
