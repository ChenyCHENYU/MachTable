import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import type { GridApi } from "../../packages/core/src/index";

declare global { interface Window { spanFixture: GridApi } }

const core = resolve(import.meta.dirname, "../../packages/core");
const url = "http://127.0.0.1:4173/__column-spans";

test("wide merged cells preserve their editor and width across the virtual viewport", async ({ page }) => {
  await page.route(url, (route) => route.fulfill({ contentType: "text/html", body: `<!doctype html>
    <link rel="stylesheet" href="/@fs${core}/dist/mach-table.css">
    <style>#grid { width: 540px; height: 320px; }</style><div id="grid"></div>
    <script type="module">
    import { createGrid } from '/@fs${core}/dist/index.js';
    window.spanFixture = createGrid(document.getElementById('grid'), {
      rowKey: 'id', rowNumber: false, pagination: false, columnMenu: false,
      defaultColDef: { sortable: false, filter: false },
      columnDefs: Array.from({ length: 500 }, (_, index) => ({
        field: 'c' + index, width: 80,
        colSpan: index === 0 ? ({data}) => data.span : undefined,
        editable: index === 0
      })),
      rowData: Array.from({ length: 100 }, (_, index) => ({
        id: String(index), c0: 'Anchor', c100: 'Covered', span: 110
      }))
    });
    </script>` }));
  await page.goto(url);
  const root = page.locator(".mach-root");
  const row = root.locator('.mach-pane--center .mach-row[data-index="0"]');
  const anchor = row.locator('[data-col-id="c0"]');
  const viewport = root.locator(".mach-body-viewport--scroll");
  await anchor.click({ position: { x: 20, y: 12 } });
  expect(await page.evaluate(() => window.spanFixture.editing.startCell({ rowIndex: 0, colId: "c0" }))).toBe(true);
  const editor = anchor.locator(".mach-editor-input");
  await expect(editor).toBeFocused();
  const mounted = await editor.elementHandle();

  await viewport.evaluate((element) => { element.scrollLeft = 8_005; });
  await expect(row.locator('[data-col-id="c100"]')).toHaveAttribute("aria-hidden", "true");
  await expect.poll(() => anchor.evaluate((element) => element.style.width)).toBe("8800px");
  expect(await row.locator(".mach-cell").count()).toBeLessThan(15);
  expect(await editor.evaluate((element, original) => element === original, mounted)).toBe(true);
  await expect(editor).toBeFocused();

  await page.evaluate(() => window.spanFixture.columns.setWidth("c20", 81));
  await expect.poll(() => anchor.evaluate((element) => element.style.width)).toBe("8801px");
  await expect(editor).toBeFocused();
  await page.evaluate(() => window.spanFixture.editing.stop({ cancel: true }));

  await page.evaluate(() => window.spanFixture.view.scrollToRow(50));
  await expect(row).toHaveCount(0);
  await expect(root).not.toHaveAttribute("aria-activedescendant", /.+/);
  await page.evaluate(() => window.spanFixture.view.scrollToRow(0));
  await expect(anchor).toHaveClass(/mach-cell--focus/);
});
