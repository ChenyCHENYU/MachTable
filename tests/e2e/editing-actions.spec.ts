import { expect, test, type Locator, type Page } from "@playwright/test";

async function expectOpaqueSelect(page: Page, trigger: Locator): Promise<void> {
  await trigger.click();
  const listbox = page.locator(".mach-select-listbox--open");
  await expect(listbox).toBeVisible();
  const visual = await listbox.evaluate((element) => {
    const styles = getComputedStyle(element);
    return {
      opacity: styles.opacity,
      visibility: styles.visibility,
      backgroundColor: styles.backgroundColor
    };
  });
  expect(visual).toEqual(expect.objectContaining({ opacity: "1", visibility: "visible" }));
  expect(visual.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  await page.keyboard.press("Escape");
  await expect(listbox).toHaveCount(0);
}

test("React selection cells stay vertically centered and outside the data-cell range", async ({ page }) => {
  await page.goto("http://127.0.0.1:4174");
  const headerCell = page.locator(".mach-header-cell--selection").first();
  const selectAll = headerCell.locator(".mach-select-all");
  const cell = page.locator('.mach-row[data-index="0"] .mach-cell--selection').first();
  const checkbox = cell.locator(".mach-row-checkbox");
  await expect(selectAll).toBeVisible({ timeout: 30_000 });
  await expect(checkbox).toBeVisible();
  const headerOrder = await page.locator(".mach-header-cell--leaf").evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-col-id"))
  );
  expect(headerOrder.slice(0, 3)).toEqual(["select", "idx", "id"]);
  expect(await page.locator(".mach-header-cell--leaf:not(.mach-header-cell--selection)").evaluateAll((elements) =>
    elements.every((element) => element.classList.contains("mach-header-cell--center"))
  )).toBe(true);
  expect(await page.locator('.mach-row[data-index="0"] .mach-cell:not(.mach-cell--selection)').evaluateAll((elements) =>
    elements.every((element) => element.classList.contains("mach-cell--center"))
  )).toBe(true);
  await expect(page.locator('.mach-row[data-index="0"] .mach-cell[data-col-id="idx"]')).toHaveText("1");
  const [headerBox, selectAllBox, cellBox, checkboxBox] = await Promise.all([
    headerCell.boundingBox(),
    selectAll.boundingBox(),
    cell.boundingBox(),
    checkbox.boundingBox()
  ]);
  if (!headerBox || !selectAllBox || !cellBox || !checkboxBox) {
    throw new Error("selection cell geometry is unavailable");
  }
  expect(Math.abs(headerBox.y + headerBox.height / 2 - selectAllBox.y - selectAllBox.height / 2)).toBeLessThan(1);
  expect(Math.abs(cellBox.y + cellBox.height / 2 - checkboxBox.y - checkboxBox.height / 2)).toBeLessThan(1);
  await cell.click({ position: { x: 3, y: cellBox.height / 2 } });
  await expect(checkbox).toBeChecked();
  await expect(cell.locator("xpath=..")).toHaveAttribute("aria-selected", "true");
  await expect(cell).toHaveClass(/mach-cell--focus/);
  await expect(cell).not.toHaveClass(/mach-cell--range/);
  expect(await cell.evaluate((element) => getComputedStyle(element).boxShadow)).toBe("none");
});

test("React cell editing exposes a pencil and local confirm/cancel controls", async ({ page }, testInfo) => {
  // WebKit needs additional cold-start headroom when the virtualized React and
  // Vue scenarios share constrained CI workers; actionability stays enabled.
  test.setTimeout(testInfo.project.name === "webkit" ? 90_000 : 45_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:4174");
  await expect(page.getByRole("grid", { name: "MachTable data grid" })).toBeVisible({ timeout: 30_000 });
  const nameCell = page.locator('.mach-cell[data-col-id="name"]').first();
  const trigger = nameCell.getByRole("button", { name: "Edit cell" });
  // Cold WebKit startup can finish the grid shell before the virtual rows mount.
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  await expect(trigger).toBeEnabled();
  await trigger.click();
  await expect(nameCell.locator(".mach-cell-editor-controls")).toBeVisible();
  await expect(nameCell.getByRole("button", { name: "Confirm edit" })).toBeVisible();
  await expect(nameCell.getByRole("button", { name: "Cancel edit" })).toBeVisible();
  await nameCell.locator("input").fill("单元格就地编辑");
  await page.mouse.move(24, 24);
  const levelCell = page.locator('.mach-cell[data-col-id="level"]').first();
  await levelCell.dblclick();
  await expect(nameCell.locator(".mach-cell-editor-controls")).toHaveCount(0);
  await expect(nameCell).toContainText("单元格就地编辑");
  await expect(levelCell.locator("select")).toBeHidden();
  await expect(levelCell.locator('.mach-editor-select-control [role="combobox"]')).toBeVisible();
  if (process.env.MACH_VISUAL_REVIEW) {
    await page.screenshot({ path: testInfo.outputPath("cell-editing-visual.png"), fullPage: false });
  }
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});

test("React dropdown surfaces use one opaque themed listbox instead of native popups", async ({ page }, testInfo) => {
  test.setTimeout(testInfo.project.name === "webkit" ? 90_000 : 55_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:4174");
  await expect(page.getByRole("grid", { name: "MachTable data grid" })).toBeVisible({ timeout: 30_000 });

  const density = page.locator(".mach-toolbar__select-control");
  await expect(density.locator("select")).toBeHidden();
  await expectOpaqueSelect(page, density.getByRole("combobox"));

  const pagination = page.locator(".mach-pagination-size-control");
  await expect(pagination.locator("select")).toBeHidden();
  await expectOpaqueSelect(page, pagination.getByRole("combobox"));

  await page.locator(".mach-toolbar__button").nth(1).click();
  const workbench = page.locator(".mach-column-panel");
  await expect(workbench).toBeVisible();
  const pinTrigger = workbench.locator(".mach-column-workbench-pin-control .mach-select-trigger:not(:disabled)").first();
  const pin = pinTrigger.locator("..");
  await expect(pin.locator("select")).toBeHidden();
  await expectOpaqueSelect(page, pinTrigger);
  await page.keyboard.press("Escape");

  const levelCell = page.locator('.mach-cell[data-col-id="level"]').first();
  await levelCell.dblclick();
  const editor = levelCell.locator(".mach-editor-select-control");
  await expect(editor.locator("select")).toBeHidden();
  await expectOpaqueSelect(page, editor.getByRole("combobox"));
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});

test("Vue column workbench and drag preview retain grid-scoped visual tokens", async ({ page }) => {
  await page.goto("http://127.0.0.1:4175");
  await page.locator(".mach-toolbar__button").nth(1).click();
  const workbench = page.locator(".mach-column-panel");
  await expect(workbench).toBeVisible();
  await expect(workbench).toHaveClass(/mach-portal/);
  expect(await workbench.evaluate((element) => getComputedStyle(element).position)).toBe("fixed");
  expect(await workbench.evaluate((element) => getComputedStyle(element).backgroundColor))
    .not.toBe("rgba(0, 0, 0, 0)");
  await page.keyboard.press("Escape");

  const header = page.locator('.mach-header-cell[data-col-id="product"]');
  const box = await header.boundingBox();
  if (!box) throw new Error("product header geometry is unavailable");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 60, box.y + box.height / 2, { steps: 4 });
  await expect(page.locator(".mach-column-drag-ghost")).toBeVisible();
  await expect(page.locator(".mach-column-drag-ghost")).toContainText("产品");
  await page.mouse.up();
  await expect(page.locator(".mach-column-drag-ghost")).toHaveCount(0);
});

test("Vue full-row editing presents staged inputs and save/cancel actions", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:4175");

  const firstRow = page.locator('.mach-row[data-index="0"]');
  await firstRow.getByRole("button", { name: "编辑" }).click();
  await expect(firstRow.locator(".mach-row-editor-shell")).toHaveCount(2);
  await expect(firstRow.getByRole("button", { name: "保存" })).toBeVisible();
  await expect(firstRow.getByRole("button", { name: "取消" })).toBeVisible();
  await expect(firstRow.locator(".mach-cell-editor-controls")).toHaveCount(0);

  const product = firstRow.locator(".mach-row-editor-shell input").first();
  await product.fill("整行草稿-取消");
  await firstRow.getByRole("button", { name: "取消" }).click();
  const productCell = page.locator('.mach-row[data-index="0"] .mach-cell[data-col-id="product"]');
  await expect(productCell).not.toContainText("整行草稿-取消");

  await firstRow.getByRole("button", { name: "编辑" }).click();
  const rowInputs = firstRow.locator(".mach-row-editor-shell input");
  await rowInputs.first().fill("整行草稿-保存");
  await rowInputs.nth(1).click();
  await expect(rowInputs.nth(1)).toBeFocused();
  await rowInputs.nth(1).fill("32");
  await expect(rowInputs.first()).toHaveValue("整行草稿-保存");
  if (process.env.MACH_VISUAL_REVIEW) {
    await page.screenshot({ path: testInfo.outputPath("editing-visual.png"), fullPage: false });
  }
  await firstRow.getByRole("button", { name: "保存" }).click();
  await expect(productCell).toContainText("整行草稿-保存");
  await expect(firstRow.locator(".mach-row-editor-shell")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Vue action overflow drawer is keyboard dismissible", async ({ page }) => {
  await page.goto("http://127.0.0.1:4175");
  const firstRow = page.locator('.mach-row[data-index="0"]');
  const more = firstRow.getByRole("button", { name: "更多操作" });
  await more.click();
  const drawer = page.getByRole("dialog", { name: "订单操作" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("button", { name: "复制订单号" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(more).toBeFocused();
});
