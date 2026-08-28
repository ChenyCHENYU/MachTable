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
    await page.goto(example.url);
    await expect(page).toHaveTitle(example.title);
    const grid = page.getByRole("grid").first();
    await expect(grid).toBeVisible();
    await expect(page.locator(".mach-row[data-index]").first()).toBeVisible();
    await grid.focus();
    await expect(grid).toBeFocused();
    expect(errors).toEqual([]);
  });
}
