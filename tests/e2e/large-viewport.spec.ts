import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";
import type { GridApi, RowDragEndEvent } from "../../packages/core/src/index";

interface Row { id: string; name: string; status: string }
declare global { interface Window { largeViewportFixture: { api: GridApi<Row>; events: RowDragEndEvent<Row>[]; requests: number[] } } }
const root = resolve(import.meta.dirname, "../../packages/core");
const url = "http://127.0.0.1:4173/__large-viewport";

async function openFixture(page: Page, variable = false): Promise<void> {
  await page.setViewportSize({ width: 1150, height: 800 });
  await page.route(url, route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
    <link rel="stylesheet" href="/@fs${root}/dist/mach-table.css"><style>body{margin:24px;font:14px system-ui}#grid{height:420px;width:1000px}</style>
    </head><body><h1>逻辑位置与有界滚动坐标</h1><div id="grid"></div><script type="module">
    import {createGrid,dragColumn} from '/@fs${root}/dist/index.js';
    const requests=[],events=[];
    const source=${variable ? `{
      rowData:Array.from({length:2000},(_,index)=>({id:String(index),name:'Row '+index,status:'Ready'})),
      getRowHeight:({data})=>Number(data.id)%2?15000:10000
    }` : `{
      rowData:[],datasourceMode:'block',datasourceRowCount:10000000,blockSize:20,maxBlocksInCache:2,blockPrefetch:0,
      datasource:{getRows(request){requests.push(request.startRow);if(requests.length>100)requests.shift();
        setTimeout(()=>request.onSuccess(Array.from({length:request.endRow-request.startRow},(_,offset)=>{
          const index=request.startRow+offset;return{id:String(index),name:(request.quickFilterText||'Row')+' '+index,status:'Ready'};
        }),10000000),8);}}
    }`};
    const api=createGrid(document.getElementById('grid'),{...source,rowKey:'id',rowHeight:32,rowBuffer:1,pagination:false,
      enableRangeSelection:true,applyRowDrag:false,
      columnDefs:[dragColumn(),{field:'id',pinned:'left',width:130},{field:'name',width:520,editable:true},{field:'status',pinned:'right',width:140}],
      onRowDragEnd:event=>events.push(event)});
    window.largeViewportFixture={api,events,requests};
    </script></body></html>` }));
  await page.goto(url);
  await expect(cell(page, 0)).toHaveText("Row 0");
}
const viewport = (page: Page) => page.locator(".mach-body-viewport--scroll");
const cell = (page: Page, index: number) => page.locator(`.mach-row[data-index="${index}"] .mach-cell[data-col-id="name"]`);
async function scrollTo(page: Page, row: number, position: "top" | "bottom" = "top") {
  await page.evaluate(({ row, position }) => window.largeViewportFixture.api.view.scrollToRow(row, position), { row, position });
  await expect(cell(page, row)).toContainText(` ${row}`);
  await expect(cell(page, row)).toBeVisible();
}
async function clickVisibleCell(page: Page, row: number) {
  // Native scrollIntoView can quantize a compressed scroll position between
  // locator hit testing and dispatch. Use the visible cell as a user would.
  const box = (await cell(page, row).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  expect(await page.evaluate(() => window.largeViewportFixture.api.selection.getRange())).toEqual({
    row1: row, row2: row, colId1: "name", colId2: "name"
  });
  return box;
}

test("ten-million remote rows reach the last row with bounded DOM/cache and aligned frozen panes", async ({ page }) => {
  await openFixture(page);
  // A buffered row can extend beyond the spacer before the exact endpoint.
  // Clipping must prevent that offscreen geometry from enlarging native scrollHeight.
  await scrollTo(page, 9_999_989);
  expect(await viewport(page).evaluate(element => element.scrollHeight)).toBeLessThanOrEqual(16_000_000);
  await scrollTo(page, 9_999_999, "bottom");
  const geometry = await page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>(".mach-body-viewport--scroll")!;
    const rows = [...document.querySelectorAll<HTMLElement>('.mach-row[data-index="9999999"]')];
    return { scrollHeight: viewport.scrollHeight, bottom: rows.map(row => row.getBoundingClientRect().bottom),
      viewportBottom: viewport.getBoundingClientRect().bottom, domRows: document.querySelectorAll(".mach-row[data-index]").length,
      cache: window.largeViewportFixture.api.rows.getCacheSnapshot() };
  });
  expect(geometry.scrollHeight).toBeLessThanOrEqual(16_000_000);
  expect(geometry.domRows).toBeLessThan(90);
  expect(geometry.cache.cachedRowCount).toBeLessThanOrEqual(80);
  expect(Math.max(...geometry.bottom) - Math.min(...geometry.bottom)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.bottom[0] - geometry.viewportBottom)).toBeLessThanOrEqual(1);
  await expect(page.locator(".mach-root")).toHaveAttribute("aria-rowcount", "10000001");
  await clickVisibleCell(page, 9_999_999);
  await expect(page.locator(".mach-fill-handle")).toBeVisible();
  expect(await viewport(page).evaluate(element => element.scrollHeight)).toBeLessThanOrEqual(16_000_000);
});

test("native thumb jumps, exact API targets, keyboard steps and wheel deltas share logical coordinates", async ({ page }) => {
  await openFixture(page);
  await viewport(page).evaluate(element => { element.scrollTop = (element.scrollHeight - element.clientHeight) / 2; });
  await expect.poll(() => page.evaluate(() => Number(document.querySelector(".mach-row[data-index]")?.getAttribute("data-index")))).toBeGreaterThan(4_999_970);
  await expect.poll(() => page.evaluate(() => Number(document.querySelector(".mach-row[data-index]")?.getAttribute("data-index")))).toBeLessThan(5_000_030);
  await scrollTo(page, 123_457);
  const topDifference = () => cell(page, 123_457).evaluate(element => element.getBoundingClientRect().top - document.querySelector(".mach-body-viewport--scroll")!.getBoundingClientRect().top);
  await expect.poll(topDifference).toBeCloseTo(0, 0);
  const box = await clickVisibleCell(page, 123_457);
  await expect.poll(topDifference).toBeCloseTo(0, 0);
  await page.keyboard.press("ArrowDown");
  await expect(cell(page, 123_458)).toHaveClass(/mach-cell--focus/);
  await expect.poll(topDifference).toBeCloseTo(0, 0);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(topDifference).toBeCloseTo(0, 0);
  await page.mouse.wheel(0, 32);
  await expect.poll(topDifference).toBeCloseTo(-32, 0);
  const browserEvents = await viewport(page).evaluate(element => [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }].map(modifier => {
    const event = new WheelEvent("wheel", { deltaY: 32, bubbles: true, cancelable: true, ...modifier }); element.dispatchEvent(event); return event.defaultPrevented;
  }));
  expect(browserEvents).toEqual([false, false, false]);
});

test("range fill and unmanaged drag targets stay aligned after a large jump", async ({ page }) => {
  await openFixture(page); await scrollTo(page, 8_765_400);
  await clickVisibleCell(page, 8_765_400);
  const fill = page.locator(".mach-fill-handle");
  await expect(fill).toBeVisible();
  expect(await fill.evaluate(element => {
    const box = element.getBoundingClientRect();
    return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === element;
  })).toBe(true);
  const handle = (await fill.boundingBox())!, target = (await cell(page, 8_765_403).boundingBox())!;
  await page.mouse.move(handle.x + 4, handle.y + 4); await page.mouse.down();
  await page.mouse.move(handle.x + 4, target.y + target.height - 3, { steps: 6 }); await page.mouse.up();
  await expect(cell(page, 8_765_403)).toHaveText("Row 8765400");
  expect(await page.evaluate(() => window.largeViewportFixture.api.selection.getRange())).toMatchObject({ row1: 8_765_400, row2: 8_765_403 });
  await page.evaluate(() => window.largeViewportFixture.api.editing.rollback());
  const source = page.locator('.mach-row[data-index="8765400"] .mach-row-drag-handle');
  const sourceBox = (await source.boundingBox())!, drop = (await cell(page, 8_765_403).boundingBox())!;
  await page.mouse.move(sourceBox.x + 10, sourceBox.y + 12); await page.mouse.down();
  await page.mouse.move(sourceBox.x + 10, drop.y + drop.height - 4, { steps: 6 });
  const indicators = page.locator(".mach-row-drop-indicator:visible");
  await expect(indicators).toHaveCount(3);
  // Edge autoscroll can move rows during the gesture. Compare the current row
  // and feedback in one layout sample, rather than the pre-drag cell rectangle.
  const { lines, rowBottoms } = await page.evaluate(() => ({
    lines: [...document.querySelectorAll(".mach-row-drop-indicator")].map(element => element.getBoundingClientRect().top),
    rowBottoms: [...document.querySelectorAll('.mach-row[data-index="8765403"]')].map(element => element.getBoundingClientRect().bottom)
  }));
  expect(Math.max(...rowBottoms) - Math.min(...rowBottoms)).toBeLessThanOrEqual(1);
  expect(Math.max(...lines) - Math.min(...lines)).toBeLessThanOrEqual(1);
  expect(Math.abs(lines[0] - rowBottoms[0])).toBeLessThanOrEqual(2);
  await page.mouse.up();
  expect(await page.evaluate(() => window.largeViewportFixture.events[0]?.toIndex)).toBe(8_765_404);
  expect(await page.evaluate(() => window.largeViewportFixture.events[0]?.applied)).toBe(false);
  expect(await page.evaluate(() => window.largeViewportFixture.events[0]?.intent)).toMatchObject({ targetId: "8765403", beforeId: "8765403", afterId: "8765404" });
});

test("variable heights use the same mapping and shrinking layouts restore the direct path", async ({ page }) => {
  await openFixture(page, true); await scrollTo(page, 1333);
  const before = await cell(page, 1333).evaluate(element => ({ top: element.getBoundingClientRect().top,
    viewportTop: document.querySelector(".mach-body-viewport--scroll")!.getBoundingClientRect().top }));
  expect(Math.abs(before.top - before.viewportTop)).toBeLessThanOrEqual(1);
  expect(await viewport(page).evaluate(element => element.scrollHeight)).toBeLessThanOrEqual(16_000_000);
  await page.evaluate(() => window.largeViewportFixture.api.updateOptions({ getRowHeight: () => 32 }));
  await scrollTo(page, 1999, "bottom");
  expect(await viewport(page).evaluate(element => element.scrollHeight)).toBe(64_000);
  await page.evaluate(() => window.largeViewportFixture.api.destroy());
  await expect(page.locator(".mach-root")).toHaveCount(0);
});
