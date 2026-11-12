import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";
import type { GridApi } from "../../packages/core/src/index";

interface SceneRow { id: string; name: string; amount: number | null; note: string | null }
interface SceneFixture {
  main: GridApi<SceneRow>;
  details: GridApi<SceneRow>[];
  changing: GridApi<SceneRow>;
  ready: boolean;
  initializationMs: number;
  changeScene(scene: "list" | "detail" | false): void;
}
declare global { interface Window { machSceneFixture: SceneFixture } }

const root = resolve(import.meta.dirname, "../../packages/core");
const url = "http://127.0.0.1:4173/__table-scenes";
const centerRows = ".mach-body-pane.mach-pane--center .mach-row[data-id]";

async function sceneDiagnostics(page: Page) {
  return page.evaluate(() => ({
    initializationMs: window.machSceneFixture.initializationMs,
    grids: document.querySelectorAll(".mach-root").length,
    centerRows: document.querySelectorAll(".mach-body-pane.mach-pane--center .mach-row[data-id]").length,
    gridDomNodes: [...document.querySelectorAll(".mach-root")].reduce((sum, grid) => sum + grid.querySelectorAll("*").length, 0)
  }));
}

async function openScenes(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route(url, route => route.fulfill({ contentType: "text/html", body: `<!doctype html>
    <html lang="zh-CN"><head><meta charset="utf-8">
    <link rel="stylesheet" href="/@fs${root}/dist/mach-table.css">
    <style>
      body{margin:24px;background:${theme === "dark" ? "#0b1220" : "#f3f6fb"};font:13px system-ui}
      main{display:grid;gap:16px;min-width:0}h1,h2{margin:0;font-size:15px;color:${theme === "dark" ? "#e2e8f0" : "#26303f"}}
      #main{height:360px}#changing{height:260px}
      .details{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;align-items:start}
      article{min-width:0}article h2{padding:0 0 6px}.detail-host{width:100%;min-width:0}
    </style></head><body><main><h1>产销主列表与只读对照</h1><div id="main"></div>
    <section class="details" aria-label="只读实绩对照"></section><div id="changing"></div></main>
    <script type="module">
      import {createGrid} from '/@fs${root}/dist/index.js';
      import {normalizeMachTableConfig,resolveMachTableGridOptions} from '/@fs${root}/dist/adapter.js';
      const started=performance.now();
      const config=normalizeMachTableConfig({defaults:{theme:'${theme}',size:'compact',columnLayout:'fit',
        stripedRows:true,showCellBorders:true,rowHeight:30,headerHeight:36}});
      const columns=[{field:'name',headerName:'设备完整名称'},
        {field:'amount',headerName:'目标重量（吨）'},{field:'note',headerName:'检查结果'}];
      const rows=(count,prefix)=>Array.from({length:count},(_,index)=>({
        id:prefix+'-'+index,name:prefix+' '+String(index+1).padStart(3,'0'),
        amount:index===0?0:index===1?null:index,note:index===0?null:'核对正常'}));
      const options=(scene,explicit)=>resolveMachTableGridOptions(config,scene,explicit).options;
      // No scene argument on the main list, and no per-card interaction flag bundle.
      const main=createGrid(document.getElementById('main'),options(undefined,{
        rowKey:'id',columnDefs:columns,rowData:rows(50,'主表').map((row,index)=>({...row,amount:50-index}))}));
      const details=Array.from({length:12},(_,index)=>{
        const count=[1,3,0,500][index%4],card=document.createElement('article');
        card.innerHTML='<h2>实绩对照 '+(index+1)+'</h2><div id="detail-'+index+'" class="detail-host"></div>';
        document.querySelector('.details').append(card);
        return createGrid(card.querySelector('.detail-host'),options('detail',{
          rowKey:'id',columnDefs:columns,rowData:rows(count,'明细'+index)}));
      });
      const changing=createGrid(document.getElementById('changing'),options('detail',{
        rowKey:'id',columnDefs:columns,rowData:rows(3,'切换')}));
      window.machSceneFixture={main,details,changing,ready:false,initializationMs:0,
        // Scene changes update configuration, never replace business rows or sort state.
        changeScene(scene){changing.updateOptions(options(scene,{}));}};
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      window.machSceneFixture.initializationMs=performance.now()-started;
      window.machSceneFixture.ready=true;
    </script></body></html>` }));
  await page.goto(url);
  await expect.poll(() => page.evaluate(() => window.machSceneFixture?.ready)).toBe(true);
  await expect(page.locator(".mach-root")).toHaveCount(14);
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: built-in scenes keep fourteen tables compact, isolated and bounded`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await openScenes(page, theme);
    const initialDiagnostics = await sceneDiagnostics(page);

    const main = page.locator("#main");
    const details = page.locator(".details");
    const changing = page.locator("#changing");
    const appearance = await page.locator(".mach-root").evaluateAll(elements => elements.map(element => ({
      compact: element.classList.contains("mach-size--compact"),
      borders: element.classList.contains("mach-cell-borders"),
      background: getComputedStyle(element.querySelector(".mach-header")!).backgroundColor
    })));
    expect(appearance.every(table => table.compact && table.borders)).toBe(true);
    expect(new Set(appearance.map(table => table.background)).size).toBe(1);
    expect(appearance[0].background).toBe(theme === "dark" ? "rgb(16, 26, 46)" : "rgb(244, 247, 251)");

    // Verify the mounted renderer, not the resolver's returned option object.
    await expect(main.locator(".mach-pagination")).toBeVisible();
    const mainHeader = main.locator('.mach-header-cell[data-col-id="amount"]');
    await mainHeader.hover();
    await expect(mainHeader.locator(".mach-filter-btn")).toBeVisible();
    await expect(mainHeader.locator(".mach-menu-btn")).toBeVisible();
    await expect(mainHeader.locator(".mach-header-resize")).toBeVisible();
    await expect(main.locator(`${centerRows} .mach-cell[data-col-id="amount"]`).first()).toHaveText("50");
    await expect(details.locator(".mach-pagination:visible")).toHaveCount(0);
    await expect(details.locator(".mach-filter-btn, .mach-menu-btn, .mach-header-resize, .mach-sort-indicator svg")).toHaveCount(0);
    expect(await details.locator(".mach-header-label").evaluateAll(labels =>
      labels.every(label => getComputedStyle(label).cursor === "default")
    )).toBe(true);

    const clippedHeaders = await page.locator(".mach-header-cell--leaf").evaluateAll(headers => headers.flatMap(header => {
      const label = header.querySelector(".mach-header-label")!;
      const range = document.createRange();
      range.selectNodeContents(label);
      const text = range.getBoundingClientRect(), bounds = header.getBoundingClientRect();
      return text.left < bounds.left - 1 || text.right > bounds.right + 1 || getComputedStyle(label).textOverflow === "ellipsis"
        ? [label.textContent] : [];
    }));
    expect(clippedHeaders).toEqual([]);

    for (const index of [0, 4, 8]) {
      const one = page.locator(`#detail-${index}`), three = page.locator(`#detail-${index + 1}`);
      await expect(one.locator(centerRows)).toHaveCount(1);
      await expect(three.locator(centerRows)).toHaveCount(3);
      await expect(one.locator(".mach-body")).toHaveCSS("height", "30px");
      await expect(three.locator(".mach-body")).toHaveCSS("height", "90px");
      const heights = await Promise.all([one.locator(".mach-root").boundingBox(), three.locator(".mach-root").boundingBox()]);
      expect(heights[1]!.height - heights[0]!.height).toBeCloseTo(60, 0);
      await expect(one.locator(`${centerRows} .mach-cell[data-col-id="amount"]`)).toHaveText("0");
      await expect(one.locator(`${centerRows} .mach-cell[data-col-id="note"]`)).toHaveText("");
      await expect(three.locator(`${centerRows}[data-id="明细${index + 1}-1"] .mach-cell[data-col-id="amount"]`)).toHaveText("");
      const empty = page.locator(`#detail-${index + 2}`);
      await expect(empty.locator(".mach-empty__icon")).toBeVisible();
      await expect(empty.locator(".mach-empty__title")).toHaveText("没有可显示的行");
      expect((await empty.locator(".mach-root").boundingBox())!.height).toBeLessThanOrEqual(240);
    }

    const tall = page.locator("#detail-3"), scroller = tall.locator(".mach-body-viewport--scroll");
    await expect(tall.locator(".mach-body")).toHaveCSS("height", "330px");
    expect(await tall.locator(centerRows).count()).toBeLessThan(40);
    expect(await scroller.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(tall.locator(`${centerRows}[data-id="明细3-499"] .mach-cell[data-col-id="name"]`)).toHaveText("明细3 500");
    expect(await tall.locator(centerRows).count()).toBeLessThan(40);
    const overflow = await page.locator(".mach-body-viewport--scroll").evaluateAll(viewports =>
      viewports.filter(viewport => viewport.scrollWidth > viewport.clientWidth + 1).length
    );
    expect(overflow).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    // Sorting/filtering one list must not alter any of the twelve detail instances.
    const detailSnapshot = await details.locator(centerRows).allTextContents();
    await mainHeader.locator(".mach-header-label").click();
    await expect(main.locator(`${centerRows} .mach-cell[data-col-id="amount"]`).first()).toHaveText("1");
    await page.evaluate(() => window.machSceneFixture.main.filtering.setQuickText("主表 050"));
    await expect(main.locator(centerRows)).toHaveCount(1);
    await expect(main.locator(`${centerRows} .mach-cell[data-col-id="name"]`)).toHaveText("主表 050");
    expect(await details.locator(centerRows).allTextContents()).toEqual(detailSnapshot);

    // A business sort remains effective even while a read-only scene hides its controls.
    await page.evaluate(() => window.machSceneFixture.changing.sorting.setModel([{ colId: "name", direction: "desc" }]));
    const firstChangingName = changing.locator(`${centerRows} .mach-cell[data-col-id="name"]`).first();
    await expect(firstChangingName).toHaveText("切换 003");
    await expect(changing.locator(".mach-sort-indicator svg")).toHaveCount(0);
    await page.evaluate(() => window.machSceneFixture.changeScene("list"));
    await expect(changing.locator(".mach-root")).not.toHaveClass(/mach-dom-layout--auto-height/);
    await expect(changing.locator(".mach-pagination")).toBeVisible();
    expect((await changing.locator(".mach-body").boundingBox())!.height).toBeGreaterThan(90);
    await expect(changing.locator('.mach-header-cell[data-col-id="name"] .mach-sort-indicator svg')).toHaveCount(1);
    await changing.locator('.mach-header-cell[data-col-id="name"]').hover();
    await expect(changing.locator('.mach-header-cell[data-col-id="name"] .mach-filter-btn')).toBeVisible();
    await expect(changing.locator('.mach-header-cell[data-col-id="name"] .mach-menu-btn')).toBeVisible();
    await expect(firstChangingName).toHaveText("切换 003");
    await page.evaluate(() => window.machSceneFixture.changeScene(false));
    await expect(changing.locator(".mach-root")).not.toHaveClass(/mach-dom-layout--auto-height/);
    await expect(changing.locator(".mach-pagination")).toBeVisible();
    expect((await changing.locator(".mach-body").boundingBox())!.height).toBeGreaterThan(90);
    await expect(changing.locator(".mach-filter-btn, .mach-menu-btn, .mach-header-resize")).toHaveCount(0);
    await expect(firstChangingName).toHaveText("切换 003");
    expect(await page.evaluate(() => window.machSceneFixture.changing.sorting.getModel())).toEqual([{ colId: "name", direction: "desc" }]);
    await expect(page.locator("#detail-0 .mach-body")).toHaveCSS("height", "30px");
    await expect(main.locator(centerRows)).toHaveCount(1);

    const finalDiagnostics = await sceneDiagnostics(page);
    await testInfo.attach(`scene-composition-${theme}`, {
      body: JSON.stringify({ initial: initialDiagnostics, final: finalDiagnostics }, null, 2), contentType: "application/json"
    });
    // This new multi-instance budget leaves all existing performance budgets untouched.
    expect(initialDiagnostics.initializationMs).toBeLessThan(3000);
    for (const diagnostics of [initialDiagnostics, finalDiagnostics]) {
      expect(diagnostics.centerRows).toBeLessThan(160);
      expect(diagnostics.gridDomNodes).toBeLessThan(6000);
    }
    expect(errors).toEqual([]);
  });
}
