import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";
import type { GridApi } from "../../packages/core/src/index";

interface Row { id: string; name: string; amount: number }
interface Fixture {
  api: GridApi<Row>;
  hold(query: string): void;
  release(): void;
  pending(): number;
  save(): Promise<void>;
  lateWrites: number;
  diagnostics(mark?: string): unknown;
  destroy(): void;
}
declare global { interface Window { cacheBoundaryFixture: Fixture } }
const root = resolve(import.meta.dirname, "../../packages/core");
const url = "http://127.0.0.1:4173/__cache-boundaries";

async function openFixture(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1150, height: 800 });
  await page.route(url, route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
    <link rel="stylesheet" href="/@fs${root}/dist/mach-table.css"><style>body{margin:24px;font:14px system-ui}#grid{height:420px;width:1000px}</style>
    </head><body><h1>随机块缓存 · 操作边界</h1><div id="grid"></div><script type="module">
    import {createGrid} from '/@fs${root}/dist/index.js';
    const held=new Set(),resolvers=[],saved=new Map();let destroyed=false;
    const api=createGrid(document.getElementById('grid'),{rowKey:'id',rowHeight:32,rowBuffer:1,blockSize:4,maxBlocksInCache:1,blockPrefetch:1,
      datasourceMode:'block',datasourceRowCount:400,datasourceMaxConcurrentRequests:2,pagination:false,enableRangeSelection:true,
      columnDefs:[{field:'id',width:100},{field:'name',width:420,editable:true},{field:'amount',width:160,editable:true,cellEditor:'number'}],
      rowData:[],datasource:{getRows(request){const query=request.quickFilterText||'base';
        const rows=Array.from({length:request.endRow-request.startRow},(_,offset)=>{const index=request.startRow+offset;
          return saved.get(String(index))||{id:String(index),name:query+' Row '+index,amount:index};});
        const complete=()=>request.onSuccess(rows,400);
        if(held.has(query))resolvers.push(complete);else setTimeout(complete,8);}},
      onModelUpdated:()=>{if(destroyed)window.cacheBoundaryFixture.lateWrites++;}});
    window.cacheBoundaryFixture={api,lateWrites:0,hold:query=>held.add(query),pending:()=>resolvers.length,
      release(){held.clear();for(const complete of resolvers.splice(0))complete();},
      async save(){await api.editing.save(async changes=>{for(const row of changes)saved.set(row.rowId,{...row.data});});},
      destroy(){destroyed=true;api.destroy();}};
    const events=[],viewport=document.querySelector('.mach-body-viewport--scroll');
    const record=event=>{const target=event.target,active=document.activeElement;events.push({type:event.type,detail:event.detail,
      target:target instanceof Element?target.className:'',row:target instanceof Element?target.closest('.mach-row')?.dataset.index:undefined,
      scrollTop:viewport.scrollTop,active:active?.className,rowEditing:api.editing.isRowActive()});if(events.length>80)events.shift();};
    for(const type of ['mousedown','mouseup','click','dblclick','focusin','focusout','scroll'])document.addEventListener(type,record,true);
    window.cacheBoundaryFixture.diagnostics=mark=>{if(mark)record({type:mark,target:viewport});return{events,scrollTop:viewport.scrollTop,rendered:[...document.querySelectorAll('.mach-row[data-index]')].map(row=>row.dataset.index)};};
    </script></body></html>` }));
  await page.goto(url);
  // No fixture refresh/scroll: small blocks must fill the real first viewport themselves.
  await expect.poll(() => page.evaluate(() => Array.from({ length: 11 }, (_, index) => window.cacheBoundaryFixture.api.rows.getAt(index)?.data?.id))).toEqual(Array.from({ length: 11 }, (_, index) => String(index)));
}

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const details = await page.evaluate(() => window.cacheBoundaryFixture?.diagnostics()).catch(() => null);
  await testInfo.attach("cache-interaction-diagnostics", { body: JSON.stringify(details, null, 2), contentType: "application/json" });
});

async function churn(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (const start of [160, 200, 240, 280]) await window.cacheBoundaryFixture.api.rows.ensureLoaded(start, start + 4);
  });
}

async function scrollTo(page: Page, index: number): Promise<void> {
  await page.evaluate(row => {
    const fixture = window.cacheBoundaryFixture;
    fixture.api.view.scrollToRow(row, "top");
    fixture.diagnostics("public-scroll-returned:" + row);
  }, index);
  await expect(page.locator('.mach-row[data-index="' + index + '"] .mach-cell[data-col-id="name"]')).toBeVisible();
  await expect.poll(() => page.evaluate(row => window.cacheBoundaryFixture.api.rows.getAt(row)?.data?.id, index)).toBe(String(index));
}

test("small blocks fill all visible rows and focus/edit protection stays bounded under prefetch churn", async ({ page }) => {
  await openFixture(page);
  const cell = page.locator('.mach-row[data-index="0"] .mach-cell[data-col-id="name"]');
  await cell.click(); await churn(page);
  await expect(cell).toHaveText("base Row 0");
  await cell.dblclick(); await page.locator(".mach-editor-input").fill("Editing survives prefetch");
  await churn(page);
  await expect(page.locator(".mach-editor-input")).toHaveValue("Editing survives prefetch");
  expect(await page.evaluate(() => window.cacheBoundaryFixture.api.rows.getById("0")?.data?.name)).toBe("base Row 0");
  expect(await page.evaluate(() => window.cacheBoundaryFixture.api.rows.getCacheSnapshot().cachedBlockCount)).toBeLessThanOrEqual(9);
  await page.evaluate(() => window.cacheBoundaryFixture.api.editing.stop({ cancel: true }));
  expect(await page.evaluate(() => window.cacheBoundaryFixture.api.editing.getChanges())).toEqual([]);
});

test("a virtualized row draft survives scrolling and remounts without pinning query history", async ({ page }) => {
  await openFixture(page);
  await page.evaluate(() => window.cacheBoundaryFixture.api.editing.startRow(0));
  await page.locator('.mach-row[data-index="0"] .mach-cell[data-col-id="name"] .mach-editor-input').fill("Staged row");
  await scrollTo(page, 40);
  await page.locator('.mach-row[data-index="40"] .mach-cell[data-col-id="name"]').click();
  await churn(page);
  expect(await page.evaluate(() => window.cacheBoundaryFixture.api.editing.isRowActive(0))).toBe(true);
  expect(await page.evaluate(() => window.cacheBoundaryFixture.api.rows.getById("0")?.data?.name)).toBe("base Row 0");
  await scrollTo(page, 0);
  await expect(page.locator('.mach-row[data-index="0"] .mach-cell[data-col-id="name"] .mach-editor-input')).toHaveValue("Staged row");
  await page.evaluate(() => window.cacheBoundaryFixture.api.editing.stop({ cancel: true }));
  expect(await page.evaluate(() => window.cacheBoundaryFixture.api.rows.getCacheSnapshot().cachedBlockCount)).toBeLessThanOrEqual(9);
});

test("evicted dirty nodes remain saveable or rollbackable and are reclaimed after acknowledgement", async ({ page }) => {
  await openFixture(page);
  await page.locator('.mach-row[data-index="0"] .mach-cell[data-col-id="name"]').dblclick();
  await page.locator(".mach-editor-input").fill("Saved sparse row");
  await page.evaluate(() => window.cacheBoundaryFixture.api.editing.stop());
  await scrollTo(page, 40);
  await page.locator('.mach-row[data-index="40"] .mach-cell[data-col-id="name"]').click();
  await churn(page);
  expect(await page.evaluate(() => window.cacheBoundaryFixture.api.editing.getChanges()[0]?.data.name)).toBe("Saved sparse row");
  expect(await page.evaluate(() => { const ids: string[] = []; window.cacheBoundaryFixture.api.rows.forEach(node => ids.push(node.id)); return ids.includes("0"); })).toBe(false);
  await page.evaluate(() => window.cacheBoundaryFixture.save());
  await churn(page);
  expect(await page.evaluate(() => window.cacheBoundaryFixture.api.rows.getById("0"))).toBeUndefined();
  await scrollTo(page, 0);
  await expect(page.locator('.mach-row[data-index="0"] .mach-cell[data-col-id="name"]')).toHaveText("Saved sparse row");
  await page.locator('.mach-row[data-index="0"] .mach-cell[data-col-id="name"]').dblclick();
  await page.locator(".mach-editor-input").fill("Rollback sparse row");
  await page.evaluate(() => window.cacheBoundaryFixture.api.editing.stop());
  await scrollTo(page, 60); await page.locator('.mach-row[data-index="60"] .mach-cell[data-col-id="name"]').click(); await churn(page);
  expect(await page.evaluate(() => window.cacheBoundaryFixture.api.editing.rollback())).toBe(true);
  await churn(page);
  expect(await page.evaluate(() => window.cacheBoundaryFixture.api.editing.getChanges())).toEqual([]);
  expect(await page.evaluate(() => window.cacheBoundaryFixture.api.rows.getById("0"))).toBeUndefined();
});

test("fast scrolling, old-query responses and destruction never restore stale rows", async ({ page }) => {
  await openFixture(page);
  await page.evaluate(() => { const fixture = window.cacheBoundaryFixture; fixture.hold("old"); fixture.api.filtering.setQuickText("old"); });
  await expect.poll(() => page.evaluate(() => window.cacheBoundaryFixture.pending())).toBeGreaterThan(0);
  await page.evaluate(() => { const api = window.cacheBoundaryFixture.api; api.view.scrollToRow(40); api.view.scrollToRow(120); api.view.scrollToRow(80); api.filtering.setQuickText("new"); });
  await scrollTo(page, 80);
  await expect(page.locator('.mach-row[data-index="80"] .mach-cell[data-col-id="name"]')).toHaveText("new Row 80");
  await page.evaluate(() => window.cacheBoundaryFixture.release());
  await expect(page.locator('.mach-row[data-index="80"] .mach-cell[data-col-id="name"]')).toHaveText("new Row 80");
  await page.evaluate(() => { const fixture = window.cacheBoundaryFixture; fixture.hold("destroy"); fixture.api.filtering.setQuickText("destroy"); });
  await expect.poll(() => page.evaluate(() => window.cacheBoundaryFixture.pending())).toBeGreaterThan(0);
  await page.evaluate(() => { window.cacheBoundaryFixture.destroy(); window.cacheBoundaryFixture.release(); });
  await expect(page.locator("#grid .mach-root")).toHaveCount(0);
  expect(await page.evaluate(() => window.cacheBoundaryFixture.lateWrites)).toBe(0);
  expect(await page.evaluate(() => window.cacheBoundaryFixture.api.rows.getCacheSnapshot().cachedBlockCount)).toBe(0);
});
