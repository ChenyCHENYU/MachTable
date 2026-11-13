import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import type { GridApi } from "../../packages/core/src/index";

declare global { interface Window { editorChromeFixture: GridApi } }
const core = resolve(import.meta.dirname, "../../packages/core");

for (const rowHeight of [30, 52]) for (const pagination of [false, true]) {
  test(`one-row ${rowHeight}px autoHeight keeps edit actions reachable with pagination=${pagination}`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const url = new URL("/__editing-chrome", info.project.use.baseURL ?? "http://127.0.0.1:4173").href;
    await page.route(url, route => route.fulfill({ contentType: "text/html", body: `<!doctype html><meta charset="utf-8">
      <link rel="stylesheet" href="/@fs${core}/styles/mach-table.css">
      <style>body{margin:24px;background:#f3f6fb}#grid{width:560px}.compound{display:grid;width:100%;gap:2px;padding:2px}.compound input{min-width:0;width:100%;height:21px;font:12px sans-serif}</style>
      <div id="grid"></div><script type="module">
      import {createGrid} from '/@fs${core}/src/index.ts';
      function editor({value}) {
        const el=document.createElement('div');el.className='compound';
        const number=document.createElement('input'),time=document.createElement('input');
        [number.value,time.value]=String(value).split('@').map(part=>part.trim());el.append(number,time);
        return {el,getValue:()=>number.value+' @ '+time.value,focus:()=>number.focus()};
      }
      window.editorChromeFixture=createGrid(document.getElementById('grid'),{
        rowKey:'id',rowNumber:false,domLayout:'autoHeight',rowHeight:${rowHeight},maxBodyHeight:${rowHeight},
        pagination:${pagination ? "{pageSize:2,pageSizeOptions:[2,4]}" : "false"},
        columnMenu:false,defaultColDef:{sortable:false,filter:false},
        columnDefs:[{field:'value',headerName:'Result',width:150,editable:true,cellEditor:${rowHeight === 52 ? "editor" : "'text'"}}],
        rowData:[{id:'1',value:${rowHeight === 52 ? "'110.25 @ 08:30'" : "'before'"}}]
      });</script>` }));
    await page.goto(url);
    const root = page.locator(".mach-root");
    const body = root.locator(".mach-body");
    const cell = root.locator('.mach-row[data-id="1"] .mach-cell[data-col-id="value"]');
    await expect(body).toHaveCSS("height", `${rowHeight}px`);
    const initialHeight = await root.evaluate(element => element.getBoundingClientRect().height);
    await cell.dblclick();
    const controls = root.locator(".mach-cell-editor-controls");
    await expect(controls).toBeVisible();
    await expect(controls).toHaveCSS("position", "static");
    await expect(body).toHaveCSS("height", `${rowHeight}px`);
    const overlap = await controls.evaluate(actions => {
      const rect = actions.getBoundingClientRect();
      return [...actions.closest('.mach-root')!.querySelectorAll('.mach-cell--editing input')].some(input => {
        const box = input.getBoundingClientRect();
        return rect.top < box.bottom && rect.bottom > box.top && rect.left < box.right && rect.right > box.left;
      });
    });
    expect(overlap).toBe(false);
    if (pagination) {
      const size = root.locator('.mach-pagination-size-control .mach-select-trigger');
      await size.click();
      await expect(page.locator('.mach-select-listbox--open')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(controls).toBeVisible();
    }
    await page.screenshot({ path: info.outputPath(`one-row-${rowHeight}-pagination-${pagination}.png`) });
    await controls.getByRole('button', { name: 'Cancel edit', exact: true }).click();
    await expect(controls).toHaveCount(0);
    await expect.poll(() => root.evaluate(element => element.getBoundingClientRect().height)).toBe(initialHeight);
    await cell.dblclick();
    const input = cell.locator('input').first();
    await input.fill('draft');
    await page.evaluate(height => {
      window.editorChromeFixture.updateOptions({ maxBodyHeight: height * 2 });
      window.editorChromeFixture.rows.transact({ add: [{ id: '2', value: 'second' }] });
    }, rowHeight);
    await expect(body).toHaveCSS('height', `${rowHeight * 2}px`);
    await expect(input).toHaveValue('draft');
    await expect(controls).toHaveCSS('position', 'absolute');
    await controls.getByRole('button', { name: 'Confirm edit', exact: true }).click();
    await expect(controls).toHaveCount(0);
    await expect(cell).toContainText('draft');
    expect(errors).toEqual([]);
  });
}
