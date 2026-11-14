import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import type { GridApi } from "../../packages/core/src/index";

declare global { interface Window { selectionPresentation: GridApi } }
const core = resolve(import.meta.dirname, "../../packages/core");

test.beforeEach(async ({ page }) => {
  const url = "http://127.0.0.1:4173/__selection-presentation";
  await page.route(url, route => route.fulfill({ contentType: "text/html", body: `<!doctype html><meta charset="UTF-8">
    <link rel="stylesheet" href="/@fs${core}/dist/mach-table.css">
    <div id="grid" style="width:600px;height:260px"></div>
    <script type="module">
      import{createGrid,selectionColumn}from'/@fs${core}/dist/index.js';
      window.selectionPresentation=createGrid(document.getElementById('grid'),{
        rowKey:'id',rowSelection:'multiple',rowNumber:false,pagination:false,size:'compact',stripedRows:true,
        columnDefs:[selectionColumn(),{field:'id',width:400},{field:'name',width:400,pinned:'right'}],
        rowData:Array.from({length:60},(_,id)=>({id:String(id),name:'生产计划 '+id}))
      });
    </script>` }));
  await page.goto(url);
  await expect(page.locator('.mach-row[data-id="1"] .mach-row-checkbox')).toBeVisible();
});

test("selected stripes, leading marker and white checkmarks stay consistent across themes and recycling", async ({ page }, info) => {
  const row = page.locator('.mach-pane--left .mach-row[data-id="1"]');
  const checkbox = row.locator('input');
  await checkbox.check();
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate(theme => window.selectionPresentation.updateOptions({ theme }), theme);
    await expect.poll(() => row.locator('.mach-cell').evaluate(element => getComputedStyle(element).backgroundColor))
      .toBe(theme === "light" ? "rgb(239, 246, 255)" : "rgb(20, 48, 79)");
    expect(await checkbox.evaluate(input => getComputedStyle(input, '::before').backgroundColor)).toBe("rgb(255, 255, 255)");
    expect(await row.evaluate(row => getComputedStyle(row, '::after').width)).toBe("2px");
    expect(await page.locator('.mach-pane--right .mach-row[data-id="1"]').evaluate(row => getComputedStyle(row, '::after').content)).toBe("none");
    const selectAll = page.locator('.mach-select-all');
    await expect(selectAll).toHaveJSProperty("indeterminate", true);
    expect(await selectAll.evaluate(input => getComputedStyle(input, '::before').height)).toBe("2px");
    await page.locator('.mach-root').screenshot({ path: info.outputPath(`selection-${theme}.png`) });
  }
  await checkbox.uncheck();
  expect(await row.evaluate(row => getComputedStyle(row, '::after').content)).toBe("none");
  await page.evaluate(() => { document.querySelector('.mach-body-viewport--scroll')!.scrollTop = 1200; });
  await expect(page.locator('.mach-pane--left .mach-row[data-id="40"]')).toBeVisible();
  await expect(page.locator('.mach-row--selected')).toHaveCount(0);
});

test("marker follows the leading pane and controls preserve keyboard, radio and forced-color semantics", async ({ page }) => {
  await page.evaluate(() => window.selectionPresentation.updateOptions({
    rowSelection: 'single', columnDefs: [
      {colId:'select',checkboxSelection:true,width:40}, {field:'id',width:400}, {field:'name',width:400}
    ]
  }));
  const checkbox = page.locator('.mach-pane--center .mach-row[data-id="1"] input');
  await checkbox.focus();
  await page.keyboard.press("Space");
  await expect(checkbox).toBeChecked();
  await expect(checkbox).toHaveAttribute("type", "radio");
  const row = checkbox.locator('..').locator('..');
  expect(await row.evaluate(row => getComputedStyle(row, '::after').width)).toBe("2px");
  await page.locator('.mach-body-viewport--scroll').evaluate(element => { element.scrollLeft = 180; });
  // The marker remains sticky in the leading viewport after horizontal scrolling.
  expect(await row.evaluate(row => getComputedStyle(row, '::after').position)).toBe("sticky");
  await page.evaluate(() => window.selectionPresentation.view.getRoot()!.style.setProperty('--mach-row-selected-marker-width','0px'));
  expect(await row.evaluate(row => getComputedStyle(row, '::after').width)).toBe("0px");
  await page.emulateMedia({ forcedColors: 'active' });
  if (await page.evaluate(() => matchMedia('(forced-colors: active)').matches)) {
    await expect(checkbox).toHaveCSS("appearance", "auto");
    await expect(checkbox).toBeChecked();
  }
});
