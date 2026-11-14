import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import type { GridApi } from "../../packages/core/src/index";

declare global { interface Window { adaptiveWidths: GridApi } }
const core = resolve(import.meta.dirname, "../../packages/core");

test("default automatic widths fill proportionally, preserve utilities and scroll without squeezing", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const url = new URL("/__adaptive-widths", info.project.use.baseURL ?? "http://127.0.0.1:4173").href;
  await page.route(url, route => route.fulfill({ contentType: "text/html", body: `<!doctype html><meta charset="utf-8">
    <link rel="stylesheet" href="/@fs${core}/styles/mach-table.css">
    <style>#grid{width:900px;height:300px}</style><div id="grid"></div><script type="module">
    import{createGrid,selectionColumn,indexColumn,actionsColumn}from'/@fs${core}/src/index.ts';
    window.adaptiveWidths=createGrid(document.getElementById('grid'),{
      rowKey:'id',rowNumber:true,pagination:false,enableColumnResize:true,defaultColDef:{resizable:true},
      columnDefs:[selectionColumn(),indexColumn(),
        {field:'name',headerName:'客户名称'}, {field:'note',headerName:'交付要求'},
        {field:'amount',headerName:'计划量',width:120},actionsColumn({width:90,actions:[]})],
      rowData:[{id:'one',name:'星海科技',note:'跨区域协同的较长交付说明',amount:12.5}]
    });</script>` }));
  await page.goto(url);
  const root = page.locator(".mach-root");
  const handle = root.locator('.mach-header-cell[data-col-id="name"] .mach-header-resize');
  await expect(handle).toBeVisible();
  const widths = () => page.evaluate(() => Object.fromEntries(window.adaptiveWidths.columns.getState().map(column => [column.colId, column.width!])));
  const sum = (values: Record<string, number>) => Object.values(values).reduce((total, value) => total + value, 0);
  const budget = () => root.locator(".mach-body").evaluate(element => element.clientWidth);
  const initial = await widths();
  expect(sum(initial)).toBeCloseTo(await budget(), 0);
  for (const id of ["sel", "idx", "op"]) await expect(root.locator(`.mach-header-cell[data-col-id="${id}"] .mach-header-resize`)).toHaveCount(0);
  expect(initial.amount).toBe(120);

  await page.evaluate(() => window.adaptiveWidths.updateOptions({ columnLayout: "normal" }));
  const natural = await widths();
  expect(sum(natural)).toBeLessThan(await budget());
  await page.evaluate(() => window.adaptiveWidths.updateOptions({ columnLayout: "auto" }));
  expect((await widths()).name / (await widths()).note).toBeCloseTo(natural.name / natural.note, 2);
  expect(sum(await widths())).toBeCloseTo(await budget(), 0);
  await page.screenshot({ path: info.outputPath("adaptive-few-columns.png") });

  const before = await widths();
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 1, y);
  await expect.poll(async () => (await widths()).name).toBeCloseTo(before.name + 1, 0);
  const others = (values: Record<string, number>) => Object.fromEntries(Object.entries(values).filter(([id]) => id !== "name"));
  expect(others(await widths())).toEqual(others(before));
  await page.mouse.move(x + 40, y, { steps: 5 });
  await expect.poll(async () => (await widths()).name).toBeCloseTo(before.name + 40, 0);
  expect(others(await widths())).toEqual(others(before));
  await page.mouse.up();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(others(await widths())).toEqual(others(before));

  await page.locator("#grid").evaluate(element => { (element as HTMLElement).style.width = "1200px"; });
  await expect.poll(async () => sum(await widths())).toBeCloseTo(await budget(), 0);
  expect((await widths()).name).toBeCloseTo(before.name + 40, 0);
  for (const id of ["sel", "idx", "op", "amount"]) expect((await widths())[id]).toBe(initial[id]);

  await page.evaluate(() => window.adaptiveWidths.columns.autoSizeAll());
  await page.locator("#grid").evaluate(element => { (element as HTMLElement).style.width = "320px"; });
  await expect.poll(() => root.locator(".mach-body").evaluate(element => element.clientWidth)).toBe(318);
  await expect.poll(() => root.locator(".mach-body-viewport--scroll").evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  // DOM 容器尺寸先变化；等待既有 ResizeObserver 完成该轮列布局。
  await expect.poll(async () => (await widths()).name).toBeCloseTo(natural.name, 0);
  await expect.poll(async () => (await widths()).note).toBeCloseTo(natural.note, 0);
  const narrow = await widths();
  expect(sum(narrow)).toBeGreaterThan(await budget());
  const clipped = await root.locator(".mach-header-label").evaluateAll(labels => labels.some(label => label.scrollWidth > label.clientWidth + 1));
  expect(clipped).toBe(false);
  await page.screenshot({ path: info.outputPath("adaptive-overflow.png") });
  expect(errors).toEqual([]);
});
