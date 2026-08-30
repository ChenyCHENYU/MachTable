import { expect, test } from "@playwright/test";

test("React cell editing exposes a pencil and local confirm/cancel controls", async ({ page }, testInfo) => {
  // WebKit needs additional cold-start headroom when the virtualized React and
  // Vue scenarios share constrained CI workers; actionability stays enabled.
  test.setTimeout(testInfo.project.name === "webkit" ? 90_000 : 45_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:4174");
  await expect(page.getByRole("grid", { name: "MachTable data grid" })).toBeVisible();
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
  if (process.env.MACH_VISUAL_REVIEW) {
    await page.screenshot({ path: testInfo.outputPath("cell-editing-visual.png"), fullPage: false });
  }
  await nameCell.getByRole("button", { name: "Confirm edit" }).click();
  await expect(nameCell).toContainText("单元格就地编辑");
  expect(errors).toEqual([]);
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
  await firstRow.locator(".mach-row-editor-shell input").first().fill("整行草稿-保存");
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
