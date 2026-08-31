import { expect, test } from "@playwright/test";

const examples = [
  { name: "vanilla", url: "http://127.0.0.1:4173", title: /MachTable.*Vanilla/i },
  { name: "react", url: "http://127.0.0.1:4174", title: /MachTable.*React/i },
  { name: "vue", url: "http://127.0.0.1:4175", title: /MachTable.*Vue/i }
] as const;

for (const example of examples) {
  test(`${example.name} renders and supports keyboard focus`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(example.url, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle(example.title);
    const grid = page.getByRole("grid").first();
    await expect(grid).toBeVisible();
    await expect(page.locator(".mach-row[data-index]").first()).toBeVisible();
    await grid.focus();
    await expect(grid).toBeFocused();
    expect(errors).toEqual([]);
  });

  test(`${example.name} supports keyboard navigation, editing and filter lifecycle`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(example.url, { waitUntil: "domcontentloaded" });
    const grid = page.getByRole("grid").first();
    await expect(grid).toHaveAttribute("aria-label", /.+/);

    const firstCell = page.locator('.mach-row[data-index="0"] .mach-cell:not(.mach-cell--selection):visible').first();
    await firstCell.click();
    const before = await page.locator(".mach-cell--focus").getAttribute("data-col-id");
    await grid.press("ArrowRight");
    const focused = page.locator(".mach-cell--focus");
    await expect(focused).toHaveCount(1);
    expect(await focused.getAttribute("data-col-id")).not.toBe(before);
    await expect(grid).toHaveAttribute("aria-activedescendant", await focused.getAttribute("id") ?? "__missing__");

    const editable = page.locator('.mach-row[data-index="0"] .mach-cell[aria-readonly="false"]:visible').first();
    const editTrigger = editable.getByRole("button", { name: "Edit cell" });
    if (await editTrigger.count()) await editTrigger.click();
    else await editable.dblclick();
    const editor = page.locator(".mach-cell--editing input").first();
    await expect(editor).toBeVisible();
    await editor.fill("E2E-EDITED");
    await editor.press("Enter");
    await expect(editable).toContainText("E2E-EDITED");

    const filterButton = page.locator(".mach-filter-btn").first();
    await filterButton.click();
    await expect(page.locator(".mach-filter-panel")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".mach-filter-panel")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test("vanilla resizes a column and restores the completed width", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });

  const header = page.locator('.mach-header-cell[data-col-id="code"]').first();
  const handle = header.locator(".mach-header-resize");
  await expect(handle).toBeAttached();
  const before = await header.boundingBox();
  const box = await handle.boundingBox();
  if (!before || !box) throw new Error("column resize geometry is unavailable");

  const pointerX = box.x + box.width / 2;
  const pointerY = box.y + box.height / 2;
  await page.mouse.move(pointerX, pointerY);
  await page.mouse.down();
  await expect(page.locator(".mach-root").first()).toHaveClass(/mach-root--resizing/);
  await page.mouse.move(pointerX + 56, pointerY, { steps: 4 });
  await expect.poll(async () => (await header.boundingBox())?.width).toBeCloseTo(before.width + 56, 0);
  await page.mouse.up();

  await expect.poll(async () => (await header.boundingBox())?.width).toBeCloseTo(before.width + 56, 0);
  const readSavedWidth = () => page.evaluate(() => {
    const raw = localStorage.getItem("mach-table:grid-state:demo-main-grid");
    const payload = raw ? JSON.parse(raw) : null;
    return payload?.state?.columns?.find((column: { colId: string }) => column.colId === "code")?.width as number | undefined;
  });
  await expect.poll(readSavedWidth).toBeCloseTo(before.width + 56, 0);
  const savedWidth = await readSavedWidth();
  if (savedWidth == null) throw new Error("resized column width was not persisted");

  await page.reload({ waitUntil: "domcontentloaded" });
  const restored = await page.locator('.mach-header-cell[data-col-id="code"]').first().boundingBox();
  expect(restored?.width).toBeCloseTo(savedWidth, 0);
});
