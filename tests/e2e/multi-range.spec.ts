import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";
import type { GridApi } from "../../packages/core/src/index";
import type { MultiRangeSelection } from "../../packages/core/src/multiRange";

declare global {
  interface Window { multiRangeFixture: { api: GridApi; ranges: MultiRangeSelection; copied: string; copies: number } }
}
const root = resolve(import.meta.dirname, "../../packages/core");
const url = "http://127.0.0.1:4173/__multi-range-fixture";

async function openFixture(page: Page): Promise<void> {
  await page.route(url, route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
    <link rel="stylesheet" href="/@fs${root}/styles/mach-table.css"><link rel="stylesheet" href="/@fs${root}/styles/workbench.css">
    <style>body{font:14px system-ui;margin:24px}#grid{width:800px;height:320px}</style></head><body>
    <p>Ctrl / Cmd 点击追加选区；Delete 清空，Ctrl / Cmd + Z 撤销。</p><div id="grid"></div><button id="outside">表格外</button>
    <script type="module">
    import {createGrid} from '/@fs${root}/dist/index.js';
    import {createMultiRangeSelection} from '/@fs${root}/dist/multi-range.js';
    const ranges=createMultiRangeSelection();
    const api=createGrid(document.getElementById('grid'),{rowKey:'id',pagination:false,enableRangeSelection:true,features:[ranges],
      columnDefs:[{field:'id',pinned:'left',width:100},{field:'name',width:200,editable:true},
        {field:'amount',width:160,editable:true,valueFormatter:({value})=>'$'+value,validate:value=>value==null?'Required':null}],
      rowData:Array.from({length:200},(_,i)=>({id:String(i),name:'Row '+i,amount:i+1}))});
    window.multiRangeFixture={api,ranges,copied:'',copies:0};
    document.getElementById('grid').addEventListener('copy',()=>window.multiRangeFixture.copies++);
    </script></body></html>` }));
  await page.goto(url);
  await expect(page.locator('.mach-row[data-id="0"] .mach-cell[data-col-id="name"]')).toContainText("Row 0");
}
const cell = (page: Page, row: string, col: string) => page.locator(`.mach-row[data-id="${row}"] .mach-cell[data-col-id="${col}"]`);

test("multi-range mouse interaction, shared copy and one-step validated undo", async ({ page }, testInfo) => {
  await openFixture(page);
  await cell(page, "0", "name").click();
  await cell(page, "2", "amount").click({ modifiers: ["ControlOrMeta"] });
  expect(await page.evaluate(() => window.multiRangeFixture.ranges.getRanges())).toHaveLength(2);
  await expect(cell(page, "0", "name")).toHaveClass(/mach-cell--multi-range/);
  const copied = await page.evaluate(() => {
    const fixture = window.multiRangeFixture;
    const event = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { setData(_type: string, value: string) { fixture.copied = value; } } });
    document.querySelector(".mach-root")!.dispatchEvent(event);
    return { text: fixture.copied, prevented: event.defaultPrevented, duplicates: fixture.copies };
  });
  expect(copied).toEqual({ text: "Row 0\n\n$3", prevented: true, duplicates: 0 });
  await page.screenshot({ path: testInfo.outputPath("multi-range.png") });
  await page.keyboard.press("Delete");
  expect(await page.evaluate(() => window.multiRangeFixture.api.rows.getById("0")?.data?.name)).toBeNull();
  // Invalid amount rejects only that row through the same Core validation path.
  expect(await page.evaluate(() => window.multiRangeFixture.api.rows.getById("2")?.data?.amount)).toBe(3);
  expect(await page.evaluate(() => window.multiRangeFixture.api.editing.undo())).toBe(true);
  await expect(cell(page, "0", "name")).toContainText("Row 0");
  expect(await page.evaluate(() => window.multiRangeFixture.api.editing.canUndo())).toBe(false);
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => window.multiRangeFixture.ranges.getRanges())).toEqual([]);
});

test("multi-range virtual row reuse, editor ownership and new data scope", async ({ page }) => {
  await openFixture(page);
  await cell(page, "0", "name").click();
  await page.evaluate(() => window.multiRangeFixture.api.view.scrollToRow(100, "start"));
  await cell(page, "100", "name").click({ modifiers: ["ControlOrMeta"] });
  expect(await page.evaluate(() => window.multiRangeFixture.ranges.getText())).toBe("Row 0\n\nRow 100");
  await page.evaluate(() => window.multiRangeFixture.api.view.scrollToRow(0, "start"));
  await expect(cell(page, "0", "name")).toHaveClass(/mach-cell--multi-range/);
  await expect(cell(page, "1", "name")).not.toHaveClass(/mach-cell--multi-range/);
  await page.evaluate(() => window.multiRangeFixture.api.editing.startCell({ rowIndex: 0, colId: "name" }));
  const input = page.locator(".mach-editor-input");
  await input.fill("Typing");
  await input.press("Delete");
  expect(await page.evaluate(() => window.multiRangeFixture.api.rows.getById("100")?.data?.name)).toBe("Row 100");
  await input.press("Escape");
  await page.evaluate(() => window.multiRangeFixture.api.rows.setData([{ id: "0", name: "New scope", amount: 8 }]));
  expect(await page.evaluate(() => window.multiRangeFixture.ranges.getRanges())).toEqual([]);
  await expect(cell(page, "0", "name")).not.toHaveClass(/mach-cell--multi-range/);
  await page.evaluate(() => { window.multiRangeFixture.ranges.clearValues(); window.multiRangeFixture.api.destroy(); });
  await expect(page.locator(".mach-root")).toHaveCount(0);
});
