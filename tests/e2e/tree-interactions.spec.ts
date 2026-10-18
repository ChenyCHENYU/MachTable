import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../packages/core");
const fixtureUrl = "http://127.0.0.1:4173/__tree-interactions";

test("tree labels remain readable and real clicks expand with range selection enabled", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.route(fixtureUrl, route => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html><head><meta charset="UTF-8">
      <link rel="stylesheet" href="/@fs${root}/styles/mach-table.css">
      <style>body{margin:24px}#grid{height:420px}</style></head><body><div id="grid"></div>
      <script type="module">
      import {createGrid, selectionColumn, indexColumn} from '/@fs${root}/dist/index.js';
      createGrid(document.getElementById('grid'), {
        treeData:true, rowKey:'id', enableRangeSelection:true, enableColumnResize:true,
        rowSelection:'multiple', pagination:false, defaultColDef:{align:'center'},
        columnDefs:[selectionColumn(),indexColumn(),
          {field:'name',headerName:'订单编号',width:300,minWidth:180},
          {field:'status',headerName:'状态',flex:1}],
        rowData:[{id:'east',name:'华东区域订单汇总',status:'履约中',children:[
          {id:'customer',name:'星海科技客户订单',status:'履约中',children:[
            {id:'order',name:'MT-2026-00001',status:'已完成'}]}]},
          {id:'south',name:'华南区域订单汇总',status:'履约中'}]
      });
      </script></body></html>`
  }));
  await page.goto(fixtureUrl);
  const east = page.locator('.mach-row[data-id="east"] .mach-cell[data-col-id="name"]');
  await expect(east.locator(".mach-tree-text")).toHaveText("华东区域订单汇总");
  const geometry = await east.evaluate(element => {
    const toggle = element.querySelector<HTMLElement>(".mach-tree-toggle")!;
    const text = element.querySelector<HTMLElement>(".mach-tree-text")!;
    const bounds = element.getBoundingClientRect();
    const toggleBounds = toggle.getBoundingClientRect();
    const textBounds = text.getBoundingClientRect();
    return {
      toggleWidth: toggleBounds.width,
      leadingSpace: toggleBounds.left - bounds.left,
      textGap: textBounds.left - toggleBounds.right,
      textWidth: textBounds.width,
      truncated: text.scrollWidth > text.clientWidth
    };
  });
  expect(geometry.toggleWidth).toBe(20);
  expect(geometry.leadingSpace).toBeLessThan(16);
  expect(geometry.textGap).toBeLessThanOrEqual(5);
  expect(geometry.textWidth).toBeGreaterThan(200);
  expect(geometry.truncated).toBe(false);

  await east.getByRole("button", { name: "Expand row" }).click();
  await expect(east).toHaveAttribute("aria-expanded", "true");
  const customer = page.locator('.mach-row[data-id="customer"] .mach-cell[data-col-id="name"]');
  await expect(customer.locator(".mach-tree-text")).toHaveText("星海科技客户订单");
  await customer.getByRole("button", { name: "Expand row" }).click();
  await expect(page.locator('.mach-row[data-id="order"] .mach-tree-text')).toHaveText("MT-2026-00001");
  await east.getByRole("button", { name: "Collapse row" }).click();
  await expect(page.locator('.mach-row[data-id="customer"]')).toHaveCount(0);
  await expect(east).toHaveAttribute("aria-expanded", "false");

  const handle = page.locator('.mach-header-cell[data-col-id="name"] .mach-header-resize');
  const box = await handle.boundingBox();
  if (!box) throw new Error("tree column resize handle is missing");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 4 });
  await expect(page.locator(".mach-column-resize-guide")).toBeVisible();
  await expect(page.locator(".mach-column-resize-label")).toHaveText("380 px");
  await expect(handle).toHaveClass(/mach-header-resize--active/);
  const guide = await page.locator(".mach-column-resize-guide").boundingBox();
  expect(guide!.height).toBeGreaterThan(300);
  await page.mouse.up();
  await expect(page.locator(".mach-column-resize-guide")).toHaveCount(0);
  await expect(east).toHaveCSS("width", "380px");
});
