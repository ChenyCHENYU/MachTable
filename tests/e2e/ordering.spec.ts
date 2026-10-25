import { expect, test, type Page } from "@playwright/test";
import type { GridApi } from "../../packages/core/src/index";

interface FilteredOrderRow { id: string; marker: string }
interface FilteredOrderingSnapshot {
  rows: string[]; server: string[]; clientRevision: number; serverRevision: number;
  calls: Array<{ operation: string; targetId: string; beforeId: string | null; afterId: string | null; expectedRevision: number; operations: number }>;
}
declare global { interface Window { filteredOrderingFixture: { api: GridApi<FilteredOrderRow>; snapshot(): FilteredOrderingSnapshot } } }

const grid = "#orderingGrid";
const initial = ["TASK-101", "TASK-102", "TASK-103", "TASK-104", "TASK-105", "TASK-106"];
const treeInitial = ["PHASE-PLAN", "TASK-101", "TASK-102", "PHASE-BUILD", "TASK-103", "TASK-104", "PHASE-REVIEW", "TASK-105", "TASK-106"];

async function order(page: Page): Promise<string[]> {
  return page.locator(`${grid} .mach-body-pane.mach-pane--center .mach-row`).evaluateAll(rows => rows
    .sort((a, b) => Number((a as HTMLElement).dataset.index) - Number((b as HTMLElement).dataset.index))
    .map(row => (row as HTMLElement).dataset.id!));
}

async function beginDrag(page: Page, source: string, target: string, position: "before" | "after" | "inside" = "after"): Promise<void> {
  const handle = page.locator(`${grid} .mach-row[data-id="${source}"] .mach-row-drag-handle`);
  await page.locator(grid).scrollIntoViewIfNeeded();
  await expect(handle).toBeVisible();
  await expect(handle).toBeEnabled();
  const from = (await handle.boundingBox())!;
  const to = (await page.locator(`${grid} .mach-row[data-id="${target}"]`).first().boundingBox())!;
  const fraction = position === "before" ? .12 : position === "inside" ? .5 : .88;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, to.y + to.height * fraction, { steps: 8 });
}

async function drag(page: Page, source: string, target: string, position: "before" | "after" | "inside" = "after"): Promise<void> {
  await beginDrag(page, source, target, position);
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("http://127.0.0.1:4173/");
  await expect(page.locator(`${grid} .mach-row[data-id="TASK-101"] .mach-row-drag-handle`)).toBeVisible();
  await page.locator("#orderingDemo").scrollIntoViewIfNeeded();
});

test("flat selected rows move in source order and keyboard moves preserve handle focus", async ({ page }) => {
  await page.locator("#orderingSelectSample").click();
  await drag(page, "TASK-101", "TASK-106");
  await expect(page.locator("#orderingStatus")).toHaveAttribute("data-status", "saved");
  expect(await order(page)).toEqual(["TASK-102", "TASK-104", "TASK-105", "TASK-106", "TASK-101", "TASK-103"]);
  await expect(page.locator("#orderingIntent")).toContainText("TASK-101、TASK-103 → TASK-106");
  await expect(page.locator("#orderingIntent")).toContainText("相邻 ID：TASK-106 / 终点");
  await page.locator("#orderingClearSelection").click();
  const handle = page.locator(`${grid} .mach-row[data-id="TASK-103"] .mach-row-drag-handle`);
  await handle.focus();
  await page.keyboard.press("Alt+ArrowUp");
  await expect(page.locator("#orderingStatus")).toHaveAttribute("data-status", "saved");
  await expect.poll(() => order(page)).toEqual(["TASK-102", "TASK-104", "TASK-105", "TASK-106", "TASK-103", "TASK-101"]);
  await expect(page.locator(`${grid} .mach-row[data-id="TASK-103"] .mach-row-drag-handle`)).toBeFocused();
});

test("tree multi-row inside moves use sibling neighbours and reject a parent's own descendants", async ({ page }) => {
  await page.locator("#orderingMode").selectOption("tree");
  await page.locator("#orderingSelectSample").click();
  await drag(page, "TASK-101", "PHASE-REVIEW", "inside");
  await expect(page.locator("#orderingStatus")).toHaveAttribute("data-status", "saved");
  expect(await order(page)).toEqual(["PHASE-PLAN", "TASK-102", "PHASE-BUILD", "TASK-104", "PHASE-REVIEW", "TASK-105", "TASK-106", "TASK-101", "TASK-103"]);
  await expect(page.locator("#orderingIntent")).toContainText("相邻 ID：TASK-106 / 终点");
  await expect(page.locator(`${grid} .mach-pane--center .mach-row[data-id="TASK-101"]`)).toHaveAttribute("aria-level", "2");
  await page.locator("#orderingUndo").click();
  await expect(page.locator("#orderingStatus")).toHaveAttribute("data-status", "saved");
  expect(await order(page)).toEqual(treeInitial);
  await page.locator("#orderingRedo").click();
  await expect(page.locator("#orderingStatus")).toHaveAttribute("data-status", "saved");
  await page.locator("#orderingClearSelection").click();
  await beginDrag(page, "PHASE-REVIEW", "TASK-101", "inside");
  await expect(page.locator(`${grid} .mach-row-drag-preview`)).toHaveText("Cannot target own subtree.");
  await expect(page.locator(`${grid} .mach-row-drop-indicator:visible`)).toHaveCount(0);
  await page.mouse.up();
  expect(await order(page)).toEqual(["PHASE-PLAN", "TASK-102", "PHASE-BUILD", "TASK-104", "PHASE-REVIEW", "TASK-105", "TASK-106", "TASK-101", "TASK-103"]);
});

test("tree keyboard moves a whole expanded subtree between siblings", async ({ page }) => {
  await page.locator("#orderingMode").selectOption("tree");
  const handle = page.locator(`${grid} .mach-row[data-id="PHASE-PLAN"] .mach-row-drag-handle`);
  await handle.focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(page.locator("#orderingStatus")).toHaveAttribute("data-status", "saved");
  expect(await order(page)).toEqual(["PHASE-BUILD", "TASK-103", "TASK-104", "PHASE-PLAN", "TASK-101", "TASK-102", "PHASE-REVIEW", "TASK-105", "TASK-106"]);
  await expect(page.locator(`${grid} .mach-row[data-id="PHASE-PLAN"] .mach-row-drag-handle`)).toBeFocused();
  await expect(page.locator("#orderingIntent")).toContainText("相邻 ID：PHASE-BUILD / PHASE-REVIEW");
});

test("filtered keyboard targets the next visible order while one CAS preserves all thirty rows through undo and redo", async ({ page }) => {
  const root = decodeURIComponent(new URL("../../packages/core", import.meta.url).pathname);
  const url = "http://127.0.0.1:4173/__filtered-ordering";
  await page.route(url, route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta charset="utf-8">
    <link rel="stylesheet" href="/@fs${root}/styles/mach-table.css">
    <style>#filteredOrderGrid{width:800px;height:360px}</style></head><body>
    <button id="filteredOrderUndo">Undo order</button><button id="filteredOrderRedo">Redo order</button>
    <div id="filteredOrderStatus" role="status"></div><div id="filteredOrderGrid"></div><script type="module">
    import {createGrid,dragColumn} from '/@fs${root}/dist/index.js';
    import {createRowOrderController} from '/@fs${root}/dist/ordering.js';
    let rows=Array.from({length:30},(_,index)=>({id:String(index+1),marker:index%6===0?'matching':'other'}));
    let server=rows,clientRevision=1,serverRevision=1;const calls=[];const status=document.getElementById('filteredOrderStatus');
    const ordering=createRowOrderController({rowKey:'id',getRows:()=>rows,getRevision:()=>clientRevision,
      applyRows:next=>{rows=next;api.rows.setData(rows);},
      save:async(intent,context)=>{
        if(context.operations.some(operation=>operation.expectedRevision!==serverRevision))return {status:'conflict',revision:serverRevision};
        calls.push({operation:context.operation,targetId:intent.targetId,beforeId:intent.beforeId??null,afterId:intent.afterId??null,expectedRevision:intent.expectedRevision,operations:context.operations.length});
        server=context.plan.after;return {revision:++serverRevision};},
      onStateChange:state=>{status.dataset.status=state.status;if(state.status==='saved')clientRevision=state.revision;}});
    const api=createGrid(document.getElementById('filteredOrderGrid'),{...ordering.bindings,rowKey:'id',rowData:rows,pagination:false,
      columnDefs:[dragColumn(),{field:'id',width:160},{field:'marker',width:200}],defaultColDef:{sortable:false}});
    window.filteredOrderingFixture={api,snapshot:()=>({rows:rows.map(row=>row.id),server:server.map(row=>row.id),clientRevision,serverRevision,calls})};
    for(const operation of ['undo','redo'])document.getElementById(operation==='undo'?'filteredOrderUndo':'filteredOrderRedo').onclick=()=>{
      void ordering[operation]().catch(error=>{status.dataset.status='error';status.textContent=error.message;});};
    window.addEventListener('pagehide',()=>{ordering.dispose();api.destroy();},{once:true});
    </script></body></html>` }));
  await page.goto(url);
  await expect(page.locator('#filteredOrderGrid .mach-row[data-id="1"] .mach-row-drag-handle')).toBeEnabled();
  await page.evaluate(() => window.filteredOrderingFixture.api.filtering.setQuickText("matching"));
  const visible = () => page.locator("#filteredOrderGrid .mach-pane--center .mach-row[data-id]").evaluateAll(rows => rows
    .sort((a, b) => Number((a as HTMLElement).dataset.index) - Number((b as HTMLElement).dataset.index)).map(row => (row as HTMLElement).dataset.id!));
  const snapshot = () => page.evaluate(() => window.filteredOrderingFixture.snapshot());
  const baseline = Array.from({ length: 30 }, (_, index) => String(index + 1));
  const moved = [...baseline.slice(1, 7), "1", ...baseline.slice(7)];
  expect(await visible()).toEqual(["1", "7", "13", "19", "25"]);
  await page.locator('#filteredOrderGrid .mach-row[data-id="1"] .mach-row-drag-handle').focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect.poll(visible).toEqual(["7", "1", "13", "19", "25"]);
  await expect.poll(async () => (await snapshot()).rows).toEqual(moved);
  expect((await snapshot()).calls[0]).toMatchObject({ targetId: "7", beforeId: "7", afterId: "8", expectedRevision: 1, operations: 1 });
  await page.locator("#filteredOrderUndo").click();
  await expect.poll(async () => (await snapshot()).server).toEqual(baseline);
  expect(await visible()).toEqual(["1", "7", "13", "19", "25"]);
  await page.locator("#filteredOrderRedo").click();
  await expect.poll(async () => (await snapshot()).server).toEqual(moved);
  expect(await visible()).toEqual(["7", "1", "13", "19", "25"]);
  expect(await snapshot()).toMatchObject({ rows: moved, server: moved, clientRevision: 4, serverRevision: 4,
    calls: [{ operation: "move", expectedRevision: 1, operations: 1 }, { operation: "undo", expectedRevision: 2, operations: 1 }, { operation: "redo", expectedRevision: 3, operations: 1 }] });
});

test("failed persistence restores the original order and allows a fresh successful move", async ({ page }) => {
  await page.locator("#orderingSaveMode").selectOption("failure");
  await drag(page, "TASK-101", "TASK-106");
  await expect(page.locator("#orderingStatus")).toHaveAttribute("data-status", "error");
  await expect(page.locator("#orderingStatus")).toContainText("已回滚");
  expect(await order(page)).toEqual(initial);
  await expect(page.locator(`${grid} .mach-row[data-id="TASK-101"] .mach-row-drag-handle`)).toBeEnabled();
  await page.locator("#orderingSaveMode").selectOption("success");
  await drag(page, "TASK-101", "TASK-106");
  await expect(page.locator("#orderingStatus")).toHaveAttribute("data-status", "saved");
  expect(await order(page)).toEqual(["TASK-102", "TASK-103", "TASK-104", "TASK-105", "TASK-106", "TASK-101"]);
});

test("undo and redo persist one atomic batch and a failed undo keeps the history cursor", async ({ page }) => {
  await page.locator("#orderingSelectSample").click();
  await drag(page, "TASK-101", "TASK-106");
  await expect(page.locator("#orderingStatus")).toHaveAttribute("data-status", "saved");
  const moved = ["TASK-102", "TASK-104", "TASK-105", "TASK-106", "TASK-101", "TASK-103"];
  await page.locator("#orderingSaveMode").selectOption("failure");
  await page.locator("#orderingUndo").click();
  await expect(page.locator("#orderingStatus")).toHaveAttribute("data-status", "error");
  expect(await order(page)).toEqual(moved);
  await expect(page.locator("#orderingUndo")).toBeEnabled();
  await expect(page.locator("#orderingRedo")).toBeDisabled();
  await page.locator("#orderingSaveMode").selectOption("success");
  await page.locator("#orderingUndo").click();
  await expect(page.locator("#orderingStatus")).toHaveAttribute("data-status", "saved");
  expect(await order(page)).toEqual(initial);
  await expect(page.locator(grid)).toHaveAttribute("data-order-operation", "undo");
  await expect(page.locator(grid)).toHaveAttribute("data-order-operations", "2");
  await expect(page.locator("#orderingUndo")).toBeDisabled();
  await page.locator("#orderingRedo").click();
  await expect(page.locator("#orderingStatus")).toHaveAttribute("data-status", "saved");
  expect(await order(page)).toEqual(moved);
});

test("a conflict rolls back locally and reload installs the server order and revision", async ({ page }) => {
  await page.locator("#orderingSaveMode").selectOption("conflict");
  await drag(page, "TASK-101", "TASK-106");
  await expect(page.locator("#orderingStatus")).toHaveAttribute("data-status", "conflict");
  expect(await order(page)).toEqual(initial);
  await page.locator("#orderingReload").click();
  expect(await order(page)).toEqual([...initial].reverse());
  await expect(page.locator("#orderingStatus")).toContainText("客户端 r2 · 服务器 r2");
  await page.locator("#orderingSaveMode").selectOption("success");
  await drag(page, "TASK-106", "TASK-101");
  await expect(page.locator("#orderingStatus")).toHaveAttribute("data-status", "saved");
  await expect(page.locator("#orderingIntent")).toContainText("请求版本 r2");
});

test("reset and owner teardown cancel pending persistence without a late write or rejected event promise", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.clock.install();
  await drag(page, "TASK-101", "TASK-106");
  await expect(page.locator("#orderingStatus")).toHaveAttribute("data-status", "saving");
  await page.locator("#orderingReset").click();
  await page.clock.runFor(900);
  expect(await order(page)).toEqual(initial);
  await expect(page.locator("#orderingStatus")).toHaveAttribute("data-status", "idle");
  await drag(page, "TASK-101", "TASK-106");
  await expect(page.locator("#orderingStatus")).toHaveAttribute("data-status", "saving");
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await page.clock.runFor(900);
  await expect(page.locator("#orderingDemo")).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme} drag feedback and a short rejection reason remain legible`, async ({ page }, testInfo) => {
    await page.locator("#orderingMode").selectOption("tree");
    if (theme === "dark") await page.locator("#btnTheme").click();
    await page.locator("#orderingDemo").scrollIntoViewIfNeeded();
    await beginDrag(page, "TASK-101", "PHASE-REVIEW", "inside");
    const preview = page.locator(`${grid} .mach-row-drag-preview`);
    await expect(preview).toBeVisible();
    await expect(page.locator(`${grid} .mach-row-drop-indicator`)).toHaveCount(3);
    await expect(page.locator(`${grid} .mach-row-drop-indicator[data-drop-position="inside"]:visible`)).toHaveCount(2);
    await expect(page.locator(`${grid} .mach-row-drop-indicator[data-drop-position="inside"]:visible`).first()).toHaveCSS("background-color", /(?:\/|,)\s*0\.12\s*\)/);
    const targetLabel = page.locator(`${grid} .mach-pane--center .mach-row[data-id="PHASE-REVIEW"] .mach-cell[data-col-id="id"]`);
    await expect(targetLabel).toBeVisible();
    await expect(targetLabel).toHaveText("PHASE-REVIEW");
    const colors = await preview.evaluate(element => ({ foreground: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }));
    expect(colors.foreground).not.toBe(colors.background);
    await page.locator(grid).screenshot({ path: testInfo.outputPath(`ordering-${theme}-inside.png`), animations: "disabled" });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect(await order(page)).toEqual(treeInitial);
    await beginDrag(page, "PHASE-PLAN", "TASK-101", "inside");
    await expect(preview).toHaveText("Cannot target own subtree.");
    const fits = await preview.evaluate(element => element.scrollWidth <= element.clientWidth);
    expect(fits).toBe(true);
    await page.locator(grid).screenshot({ path: testInfo.outputPath(`ordering-${theme}-rejected.png`), animations: "disabled" });
    await page.mouse.up();
    expect(await order(page)).toEqual(treeInitial);
  });
}
