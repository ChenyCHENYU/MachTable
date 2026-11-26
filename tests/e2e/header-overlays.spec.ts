import { expect, test, type Locator, type Page } from "@playwright/test";
import { resolve } from "node:path";

const core = resolve(import.meta.dirname, "../../packages/core");

async function expectAnchored(panel: Locator, trigger: Locator): Promise<void> {
  await expect(panel).toBeVisible();
  const anchor = (await trigger.boundingBox())!;
  const box = (await panel.boundingBox())!;
  expect(Math.abs(box.x - anchor.x)).toBeLessThan(3);
  const gap = box.y > anchor.y ? box.y - anchor.y - anchor.height : anchor.y - box.y - box.height;
  expect(gap).toBeGreaterThanOrEqual(1);
  expect(gap).toBeLessThan(8);
}

async function openGridDialog(page: Page, short = false): Promise<Locator> {
  await page.setViewportSize({ width: 920, height: short ? 400 : 600 });
  const url = "http://127.0.0.1:4173/__header-overlays";
  await page.route(url, route => route.fulfill({ contentType: "text/html", body: `<!doctype html><meta charset="utf-8">
    <link rel="stylesheet" href="/@fs${core}/dist/mach-table.css">
    <style>
      dialog { width: 460px; height: 190px; overflow: visible; transform: translate(38px, 105px) scale(.94); }
      dialog::backdrop { background: #0006; }
    </style>
    <dialog><div id="grid" style="height:160px"></div></dialog>
    <script type="module">
      import {createGrid} from '/@fs${core}/dist/index.js';
      document.querySelector('dialog').showModal();
      window.testGrid = createGrid(document.getElementById('grid'), {
        rowData: [{ id: 'B' }, { id: 'A' }],
        columnDefs: [{ field: 'id', headerName: '炉号', width: 160, filter: 'text' },
          ...Array.from({ length: ${short ? 12 : 0} }, (_, i) => ({ field: 'id', colId: 'extra-' + i, width: 130 }))],
        columnMenu: true, pagination: false
      });
    </script>` }));
  await page.goto(url);
  return page.locator("dialog");
}

test("column tools stay anchored and usable inside a translated modal", async ({ page }) => {
  const dialog = await openGridDialog(page);
  const menuTrigger = dialog.locator(".mach-menu-btn");
  const filterTrigger = dialog.locator(".mach-filter-btn");
  await expect(menuTrigger).toHaveAttribute("title", "炉号 · 列设置");
  await menuTrigger.click();
  const menu = dialog.locator(".mach-column-panel");
  await expectAnchored(menu, menuTrigger);
  await expect(menuTrigger).toHaveAttribute("aria-expanded", "true");
  await menuTrigger.click();
  await expect(menu).toHaveCount(0);
  await menuTrigger.press("Enter");
  const sort = menu.getByRole("button", { name: "升序", exact: true });
  await expect(sort).toBeFocused();
  await sort.press("Enter");
  await expect(menuTrigger).toBeFocused();
  await expect(menuTrigger).toHaveAttribute("aria-expanded", "false");
  const cells = dialog.getByRole("gridcell");
  await expect(cells).toHaveText(["A", "B"]);

  await expect(filterTrigger).toHaveAttribute("title", "炉号 · 筛选");
  await filterTrigger.click();
  const filter = dialog.locator(".mach-filter-panel");
  await expectAnchored(filter, filterTrigger);
  const condition = filter.getByRole("combobox");
  await expect(condition).toBeFocused();
  await condition.click();
  const list = dialog.getByRole("listbox");
  await expectAnchored(list, condition);
  await list.getByRole("option", { name: "等于", exact: true }).click();
  const input = filter.getByRole("textbox");
  await input.fill("B");
  await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await expect(filter).toBeVisible();
  await filter.getByRole("button", { name: "应用" }).click();
  await expect(filterTrigger).toBeFocused();
  await expect(menuTrigger).toHaveAttribute("title", "炉号 · 列设置");
  await expect(cells).toHaveText(["B"]);

  await filterTrigger.click();
  await page.keyboard.press("Escape");
  await expect(filter).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(filterTrigger).toBeFocused();

  await menuTrigger.click();
  await page.evaluate(() => Reflect.get(window, "testGrid").destroy());
  await expect(page.locator(".mach-filter-panel, .mach-select-listbox")).toHaveCount(0);
});

test("short modal column settings leave the button usable and follow horizontal scroll", async ({ page }) => {
  const dialog = await openGridDialog(page, true);
  const trigger = dialog.locator('.mach-header-cell[data-col-id="id"] .mach-menu-btn');
  const menu = dialog.locator(".mach-column-panel");
  const body = dialog.locator(".mach-body-viewport--scroll");
  await trigger.click();
  await expectAnchored(menu, trigger);
  expect(await menu.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  await trigger.click();
  await expect(menu).toHaveCount(0);

  await trigger.click();
  const before = (await menu.boundingBox())!.x;
  await body.evaluate((node) => { node.scrollLeft = 50; });
  await expect.poll(async () => (await menu.boundingBox())?.x).toBeLessThan(before - 25);
  await expectAnchored(menu, trigger);
  await body.evaluate((node) => { node.scrollLeft = 450; });
  await expect(menu).toHaveCount(0);
  await expect(dialog).toBeVisible();
});
