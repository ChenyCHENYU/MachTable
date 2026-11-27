import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

const core = resolve(import.meta.dirname, "../../packages/core");

test("page jump remains accessible in a narrow server-paged grid", async ({ page }) => {
  const url = "http://127.0.0.1:4173/__pagination-jump";
  const dataUrl = `${url}/orders`;
  const requestedPages: string[] = [];
  await page.route(`${dataUrl}*`, async (route) => {
    const target = new URL(route.request().url()).searchParams.get("page")!;
    requestedPages.push(target);
    await route.fulfill({ json: [{ id: `ORDER-${target}` }] });
  });
  await page.route(url, (route) => route.fulfill({ contentType: "text/html", body: `<!doctype html>
    <link rel="stylesheet" href="/@fs${core}/styles/mach-table.css">
    <style>#grid{width:260px}</style>
    <form><div id="grid"></div></form>
    <script type="module">
      import { createGrid } from '/@fs${core}/src/index.ts';
      createGrid(document.getElementById('grid'), {
        columnDefs: [{ field: 'id', width: 360 }], rowKey: 'id', rowData: [{ id: 'ORDER-1' }],
        domLayout: 'autoHeight', maxBodyHeight: 180,
        pagination: { mode: 'server', page: 1, pageSize: 20, total: 200, showPageJump: true },
        onPaginationChanged: ({api, page}) => {
          fetch('${dataUrl}?page=' + page).then(response => response.json()).then(rows => api.rows.setData(rows));
        }
      });
    </script>` }));
  await page.goto(url);

  const pagination = page.getByRole("navigation");
  const input = pagination.getByRole("textbox", { name: "跳至页码" });
  const confirm = pagination.getByRole("button", { name: "跳至页码" });
  const orderCell = page.getByRole("gridcell", { name: /^ORDER-/ });
  await expect(input).toHaveValue("1");
  const viewport = page.locator(".mach-body-viewport--scroll");
  await expect.poll(async () => viewport.evaluate((body) => body.scrollWidth > body.clientWidth)).toBe(true);
  const barBox = (await pagination.boundingBox())!;
  const viewportBox = (await viewport.boundingBox())!;
  expect(barBox.y).toBeGreaterThanOrEqual(viewportBox.y + viewportBox.height - 1);
  expect(await pagination.evaluate((bar) => bar.scrollWidth <= bar.clientWidth)).toBe(true);

  await input.fill("7");
  await input.press("Enter");
  await expect(orderCell).toHaveText("ORDER-7");
  await expect(input).toHaveValue("7");
  await input.fill("bad");
  await input.press("Enter");
  await expect(input).toHaveValue("7");
  await confirm.click();
  expect(requestedPages).toEqual(["7"]);

  await input.fill("99");
  await confirm.click();
  await expect(orderCell).toHaveText("ORDER-10");
  expect(requestedPages).toEqual(["7", "10"]);
});
