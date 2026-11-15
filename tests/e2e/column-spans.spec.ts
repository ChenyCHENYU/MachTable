import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";
import type { GridApi } from "../../packages/core/src/index";

declare global { interface Window { spanFixture: GridApi } }

const core = resolve(import.meta.dirname, "../../packages/core");
const url = "http://127.0.0.1:4173/__column-spans";

async function settleLayout(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
}

for (const merged of [false, true]) for (const fullRow of [false, true]) for (const custom of [false, true]) {
test(`wide ${merged ? "merged cells" : "columns"} preserve ${fullRow ? "row" : "cell"} ${custom ? "custom" : "text"} editors while scrolling and resizing`, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(url, (route) => route.fulfill({ contentType: "text/html", body: `<!doctype html>
    <link rel="stylesheet" href="/@fs${core}/dist/mach-table.css">
    <style>#grid { width: 540px; height: 320px; }.compound { display:grid; width:100%; min-width:0; gap:2px; }
      .compound input { width:100%; min-width:0; box-sizing:border-box; height:21px; }</style><div id="grid"></div>
    <script type="module">
    import { createGrid } from '/@fs${core}/dist/index.js';
    function editor({value}) {
      const el = document.createElement('div'); el.className = 'compound';
      const input = document.createElement('input'), time = document.createElement('input');
      input.value = value; time.value = '08:30'; el.append(input, time);
      const probe = document.createElement('span'); probe.className = 'fixed-probe';
      probe.style.cssText = 'position:fixed;left:10px;top:0;width:1px;height:1px;pointer-events:none'; el.append(probe);
      return {el, getValue: () => input.value, focus: () => input.focus()};
    }
    window.spanFixture = createGrid(document.getElementById('grid'), {
      rowKey: 'id', rowNumber: false, pagination: false, columnMenu: false,
      editType: '${fullRow ? "fullRow" : "cell"}', rowHeight: ${custom ? 52 : 30},
      defaultColDef: { sortable: false, filter: false },
      columnDefs: Array.from({ length: 500 }, (_, index) => ({
        field: 'c' + index, width: index === 0 && ${!merged} ? 8800 : 80,
        colSpan: index === 0 && ${merged} ? ({data}) => data.span : undefined,
        cellEditor: ${custom ? "editor" : "'text'"},
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
  const editor = anchor.locator("input").first();
  await expect(editor).toBeFocused();
  const mounted = await editor.elementHandle();
  await editor.fill("Anchor draft");
  await editor.evaluate((element: HTMLInputElement) => element.setSelectionRange(1, 4, "backward"));
  const expectVisibleEditor = async () => {
    const visible = await editor.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const pane = element.closest('.mach-body-viewport')!;
      const clip = pane.getBoundingClientRect();
      return box.left >= clip.left - 1 && box.right <= clip.left + pane.clientWidth + 1 && box.width >= 40;
    });
    expect(visible).toBe(true);
    await expect(editor).toBeFocused();
    expect(await editor.evaluate((element, original) => element === original, mounted)).toBe(true);
    expect(await editor.evaluate((element: HTMLInputElement) => [element.selectionStart, element.selectionEnd, element.selectionDirection])).toEqual([1, 4, "backward"]);
  };

  let width = 80;
  for (const left of [8_005, 8_700, 4_000, 0, 8_005]) {
    await viewport.evaluate((element, value) => { element.scrollLeft = value; }, left);
    await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBe(left);
    // 真正修改合并宽度，不能只验证虚拟窗口重绘或编辑焦点。
    width = width === 80 ? 81 : 80;
    await page.evaluate(({ merged, width }) => window.spanFixture.columns.setWidth(merged ? "c20" : "c0", merged ? width : 8_800 + width - 80), { merged, width });
    await expect.poll(() => anchor.evaluate((element) => element.style.width)).toBe(`${8_800 + width - 80}px`);
    await settleLayout(page);
    await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBe(left);
    await expectVisibleEditor();
    await expect(editor).toHaveValue("Anchor draft");
    if (custom) {
      const offset = await anchor.locator(".fixed-probe").evaluate((element) =>
        element.getBoundingClientRect().left - element.closest(".mach-row")!.getBoundingClientRect().left);
      expect(offset).toBeCloseTo(10, 0);
    }
  }

  if (merged) await expect(row.locator('[data-col-id="c100"]')).toHaveAttribute("aria-hidden", "true");
  expect(await row.locator(".mach-cell").count()).toBeLessThan(15);
  for (const width of [1_000, 320, 9_000]) {
    await page.evaluate((width) => {
      document.getElementById("grid")!.style.width = `${width}px`;
      window.spanFixture.view.refreshLayout();
    }, width);
    await settleLayout(page);
    expect(await viewport.evaluate((element) => element.scrollLeft)).toBe(8_005);
    await expectVisibleEditor();
  }
  // A fresh partial-left edit must also fit after the wide-table styles were cleared at x=0.
  for (const left of [0, 8_005]) {
    await viewport.evaluate((element, value) => { element.scrollLeft = value; }, left);
    await settleLayout(page);
    await expectVisibleEditor();
  }
  await page.evaluate(() => {
    document.getElementById("grid")!.style.width = "540px";
    window.spanFixture.view.refreshLayout();
  });
  await settleLayout(page);
  await editor.evaluate((element) => element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true })));
  await expect(editor).toBeFocused();
  await page.evaluate(() => window.spanFixture.editing.stop({ cancel: true }));
  expect(await page.evaluate(() => window.spanFixture.rows.getById("0")!.data.c0)).toBe("Anchor");

  await page.evaluate(() => window.spanFixture.view.scrollToRow(50));
  await expect(row).toHaveCount(0);
  await expect(root).not.toHaveAttribute("aria-activedescendant", /.+/);
  await page.evaluate(() => window.spanFixture.view.scrollToRow(0));
  await expect(anchor).toHaveClass(/mach-cell--focus/);
  expect(errors).toEqual([]);
});
}
