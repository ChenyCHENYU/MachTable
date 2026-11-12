import { expect, test, type Locator } from "@playwright/test";
import { resolve } from "node:path";
import type { GridApi } from "../../packages/core/src/index";

declare global { interface Window { rowSpanFixture: GridApi } }

const core = resolve(import.meta.dirname, "../../packages/core");
const url = "http://127.0.0.1:4173/__row-spans";

/** Hit testing must reach the merged anchor, including beneath later rows. */
async function expectAnchor(cell: Locator, rowIndex: number, fraction = 0.75): Promise<void> {
  const column = await cell.getAttribute("data-col-id");
  await expect.poll(() => cell.evaluate((element, depth) => {
    const rect = element.getBoundingClientRect();
    const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height * depth);
    return {
      column: target?.closest<HTMLElement>(".mach-cell")?.dataset.colId,
      row: target?.closest<HTMLElement>(".mach-row")?.dataset.index
    };
  }, fraction)).toEqual({ column, row: String(rowIndex) });
}

test.beforeEach(async ({ page }) => {
  await page.route(url, route => route.fulfill({ contentType: "text/html", body: `<!doctype html>
    <link rel="stylesheet" href="/@fs${core}/styles/mach-table.css">
    <style>body { margin: 16px; } #grid { width: 860px; height: 350px; }</style><div id="grid"></div>
    <script type="module">
    import { createGrid } from '/@fs${core}/src/index.ts';
    window.rowSpanFixture = createGrid(document.getElementById('grid'), {
      rowKey: 'id', rowNumber: false, pagination: false, columnMenu: false,
      rowHeight: 32, rowSelection: 'multiple', rowBuffer: 8,
      defaultColDef: { width: 140, sortable: false, filter: false },
      columnDefs: [
        { field: 'left', pinned: 'left', autoRowSpan: true, editable: true },
        { field: 'leftOffset', pinned: 'left', autoRowSpan: true, cellStyle: { zIndex: '7' } },
        { field: 'center', autoRowSpan: true },
        { field: 'centerOffset', autoRowSpan: true },
        { field: 'name', editable: true }
      ],
      rowData: Array.from({ length: 80 }, (_, index) => ({
        id: 'r' + index, name: 'Row ' + index,
        left: 'L' + Math.floor(index / 4),
        leftOffset: index === 0 ? 'single' : 'P' + Math.floor((index - 1) / 5),
        center: 'C' + Math.floor(index / 6),
        centerOffset: index < 2 ? 'single' + index : 'S' + Math.floor((index - 2) / 4)
      }))
    });
    </script>` }));
  await page.goto(url);
  await expect(page.locator('.mach-pane--center .mach-row[data-index="0"]')).toBeVisible();
});

test("staggered pinned and center spans stay above later row backgrounds before and after recycling", async ({ page }) => {
  const cell = (pane: string, row: number, field: string) => page.locator(
    `.mach-pane--${pane} .mach-row[data-index="${row}"] > .mach-cell[data-col-id="${field}"]`
  );
  await expectAnchor(cell("left", 0, "left"), 0);
  await expectAnchor(cell("left", 1, "leftOffset"), 1);
  await expectAnchor(cell("center", 0, "center"), 0);
  await expectAnchor(cell("center", 2, "centerOffset"), 2);
  await expect(cell("left", 1, "leftOffset")).toHaveCSS("z-index", "7");
  await expectAnchor(cell("center", 3, "name"), 3, 0.5);

  await page.evaluate(() => window.rowSpanFixture.view.scrollToRow(40));
  await expect(cell("center", 40, "name")).toBeVisible();
  await expectAnchor(cell("left", 40, "left"), 40);
  await expectAnchor(cell("left", 41, "leftOffset"), 41);
  await expectAnchor(cell("center", 42, "center"), 42);
  await expectAnchor(cell("center", 42, "centerOffset"), 42);
  expect(await page.locator(".mach-pane--center .mach-row:visible").count()).toBeLessThan(35);

  await page.evaluate(() => window.rowSpanFixture.view.scrollToRow(0));
  await expect(cell("center", 0, "center")).toBeVisible();
  await expectAnchor(cell("left", 0, "left"), 0);
  await expectAnchor(cell("left", 1, "leftOffset"), 1);
  await expectAnchor(cell("center", 0, "center"), 0);
});

test("merged and ordinary cells remain selectable and editable with logical row identity", async ({ page }) => {
  const merged = page.locator('.mach-pane--left .mach-row[data-index="0"] > [data-col-id="left"]');
  await merged.dblclick({ position: { x: 30, y: 90 } });
  const editor = merged.locator(".mach-editor-input");
  await expect(editor).toBeFocused();
  await editor.fill("Changed anchor");
  await editor.press("Enter");
  await expect(merged).toHaveText("Changed anchor");
  await page.evaluate(() => window.rowSpanFixture.selection.setById("r3", true));
  const normal = page.locator('.mach-pane--center .mach-row[data-index="3"] > [data-col-id="name"]');
  await expectAnchor(normal, 3, 0.5);
  await normal.dblclick();
  await normal.locator(".mach-editor-input").fill("Changed ordinary");
  await normal.locator(".mach-editor-input").press("Enter");
  await expect(normal).toHaveText("Changed ordinary");
  expect(await page.evaluate(() => window.rowSpanFixture.selection.getIds())).toContain("r3");
});
