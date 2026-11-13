import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

const core = resolve(import.meta.dirname, "../../packages/core");

test("loading is compact, themed and static under reduced motion", async ({ page }, info) => {
  const url = "http://127.0.0.1:4173/__loading-theme";
  await page.route(url, route => route.fulfill({ contentType: "text/html", body: `<!doctype html>
    <link rel="stylesheet" href="/@fs${core}/dist/mach-table.css">
    <div id="grid" style="width:600px;height:300px"></div>
    <script type="module">
      import{createGrid}from'/@fs${core}/dist/index.js';
      window.grid=createGrid(document.getElementById('grid'),{
        columnDefs:[{field:'id'}],loading:true,theme:'auto',pagination:false
      });
    </script>` }));
  await page.goto(url);
  const loading = page.locator(".mach-loading");
  await expect(loading).toBeVisible();
  await expect(page.locator(".mach-root")).toHaveAttribute("aria-busy", "true");
  await expect(loading).toContainText("加载中");
  await expect(loading.locator(".mach-spinner")).toHaveCount(0);
  const row = loading.locator(".mach-loading__row").first();
  await expect(row).toHaveCSS("animation-name", "mach-loading-pulse");
  expect((await loading.boundingBox())!.width).toBeLessThan(200);
  expect((await loading.boundingBox())!.height).toBeLessThan(70);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    // matchMedia change is asynchronous; wait for the owning grid before reading its palette.
    const root = page.locator(".mach-root");
    if (colorScheme === "dark") await expect(root).toHaveClass(/mach-theme-dark/);
    else await expect(root).not.toHaveClass(/mach-theme-dark/);
    await expect(row).toHaveCSS("animation-name", "none");
    const color = await root.evaluate(root =>
      getComputedStyle(root).getPropertyValue("--mach-primary").trim());
    const expectedColor = await page.evaluate(value => {
      const element = document.createElement("span");
      element.style.color = value;
      document.body.append(element);
      const color = getComputedStyle(element).color;
      element.remove();
      return color;
    }, color);
    await expect(loading).toHaveCSS("color", expectedColor);
    await page.screenshot({ path: info.outputPath(`loading-${colorScheme}.png`) });
  }
});
