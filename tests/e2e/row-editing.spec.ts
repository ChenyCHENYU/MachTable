import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import type { GridApi } from "../../packages/core/src/index";

declare global { interface Window { imeEditingApi: GridApi<{ id: string; name: string; age: number }> } }
const core = resolve(import.meta.dirname, "../../packages/core");
const url = "http://127.0.0.1:4173/__row-ime";

test.beforeEach(async ({ page }) => {
  await page.route(url, route => route.fulfill({ contentType: "text/html", body: `<!doctype html><meta charset="utf-8">
    <link rel="stylesheet" href="/@fs${core}/dist/mach-table.css">
    <div id="grid" style="width:640px;height:320px"></div>
    <script type="module">
      import {createGrid} from '/@fs${core}/dist/index.js';
      window.imeEditingApi=createGrid(document.getElementById('grid'),{
        rowKey:'id',editType:'fullRow',pagination:false,
        columnDefs:[{field:'name',editable:true},{field:'age',editable:true}],
        rowData:[{id:'one',name:'Before',age:20}]
      });
      window.imeEditingApi.editing.startRow(0);
    </script>` }));
  await page.goto(url);
  await expect(page.locator('.mach-cell[data-col-id="name"] .mach-editor-input')).toBeVisible();
});

for (const composition of [
  { key: "Enter", isComposing: true },
  { key: "Escape", isComposing: true },
  { key: "Tab", isComposing: true },
  { key: "Enter", keyCode: 229 }
]) {
  test(`full-row IME ${composition.key} (${composition.keyCode ?? "composition"}) retains its draft and focus`, async ({ page }) => {
    const input = page.locator('.mach-cell[data-col-id="name"] .mach-editor-input');
    await input.fill("中文输入尚未结束");
    await input.evaluate((element, eventInit) => element.dispatchEvent(new KeyboardEvent("keydown", {
      ...eventInit, bubbles: true, cancelable: true
    })), composition);

    expect(await page.evaluate(() => window.imeEditingApi.editing.isRowActive(0))).toBe(true);
    expect(await page.evaluate(() => window.imeEditingApi.rows.getById("one")?.data?.name)).toBe("Before");
    await expect(input).toHaveValue("中文输入尚未结束");
    await expect(input).toBeFocused();

    await input.press("Enter");
    await expect(input).toHaveCount(0);
    expect(await page.evaluate(() => window.imeEditingApi.rows.getById("one")?.data?.name)).toBe("中文输入尚未结束");
  });
}
