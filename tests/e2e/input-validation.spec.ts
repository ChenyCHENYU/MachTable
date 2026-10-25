import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import type { GridApi } from "../../packages/core/src/index";

interface InputRow { id: string; name: string; quantity: number }
declare global {
  interface Window {
    inputFixtureApi: GridApi<InputRow>;
    inputFixtureErrors: string[];
    resolveInputValidation: () => void;
  }
}

const root = resolve(import.meta.dirname, "../../packages/core");
const url = "http://127.0.0.1:4173/__input-validation";

test("clipboard and delete share column/row validation, undo and async cancellation", async ({ page }) => {
  await page.route(url, route => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html><head>
      <link rel="stylesheet" href="/@fs${root}/styles/mach-table.css">
      <style>#grid{width:800px;height:400px}</style></head><body><div id="grid"></div>
      <script type="module">
      import {createGrid} from '/@fs${root}/dist/index.js';
      window.inputFixtureErrors=[];
      window.inputFixtureApi=createGrid(document.getElementById('grid'),{
        rowKey:'id',enableRangeSelection:true,
        columnDefs:[{field:'name',editable:true,width:220},
          {field:'quantity',editable:true,width:180,
            validate:value=>value==null||value<0?'Quantity must be positive':null}],
        rowData:[{id:'a',name:'Alpha',quantity:2},{id:'b',name:'Beta',quantity:3}],
        rowEditValidator:({values})=>values.name==='deferred'
          ?new Promise(resolve=>window.resolveInputValidation=()=>resolve(null))
          :values.name==='reserved'?{name:'Reserved name'}:null,
        onGridError:event=>window.inputFixtureErrors.push(event.code)
      });
      </script></body></html>`
  }));
  await page.goto(url);
  const name = page.locator('.mach-row[data-index="0"] .mach-cell[data-col-id="name"]');
  const quantity = page.locator('.mach-row[data-index="0"] .mach-cell[data-col-id="quantity"]');
  await expect(name).toHaveText("Alpha");
  const paste = (text: string) => page.locator(".mach-root").evaluate((element, content) => {
    // Exercise the native event path without requiring system clipboard permissions.
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { getData: () => content } });
    element.dispatchEvent(event);
  }, text);
  const data = () => page.evaluate(() => window.inputFixtureApi.rows.getById("a")!.data);

  await name.click();
  await paste("Changed\t-1");
  expect(await data()).toEqual({ id: "a", name: "Alpha", quantity: 2 });
  await paste("reserved\t4");
  expect(await data()).toEqual({ id: "a", name: "Alpha", quantity: 2 });
  await paste("Accepted\t4");
  await expect(name).toContainText("Accepted");
  expect(await data()).toEqual({ id: "a", name: "Accepted", quantity: 4 });
  await page.keyboard.press("ControlOrMeta+z");
  await expect(name).toContainText("Alpha");
  expect(await data()).toEqual({ id: "a", name: "Alpha", quantity: 2 });

  await quantity.click();
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Delete");
  expect((await data())!.quantity).toBe(2);
  await name.click();
  await paste("deferred\t9");
  await page.waitForFunction(() => typeof window.resolveInputValidation === "function");
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.resolveInputValidation());
  expect(await data()).toEqual({ id: "a", name: "Alpha", quantity: 2 });
  expect(await page.evaluate(() => window.inputFixtureErrors.length)).toBe(3);
});
