import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";
import type { AdvancedFilterModel, GridApi } from "../../packages/core/src/index";

interface Row { id: string; amount: number; region: string; year: number; name: string }
interface WorkbenchFixture {
  api: GridApi<Row>;
  seedChanges(count?: number): Promise<void>;
  saveCalls: string[][];
  setPendingSave(): void;
  resolveSave(): void;
  replaceRows(): void;
  getDraft(): AdvancedFilterModel | null;
  raiseError(): void;
}
declare global { interface Window { workbenchFixture: WorkbenchFixture; workbenchXss?: number } }
const root = resolve(import.meta.dirname, "../../packages/core");
const url = "http://127.0.0.1:4173/__workbench-fixture";

/** Separate page and data keep the original virtual-grid and framework E2E fixtures independent. */
async function openFixture(page: Page): Promise<void> {
  await page.route(url, (route) => route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
    <link rel="stylesheet" href="/@fs${root}/styles/mach-table.css">
    <link rel="stylesheet" href="/@fs${root}/styles/workbench.css">
    <style>body{font:14px system-ui;margin:16px;background:#f1f5f9}#grid{width:900px;height:280px}#panels{width:900px;margin-top:12px}nav{display:flex;gap:8px;margin-bottom:10px}button{min-height:32px}#status{min-height:24px}</style>
    </head><body><h1>MachTable 工作台回归</h1><nav aria-label="工作台入口">
    <button id="filter">高级筛选</button><button id="review">修改审阅</button><button id="analysis">数据分析</button><button id="diagnostics">诊断</button><button id="theme">切换主题</button>
    <button id="save-view">保存当前视图</button><button id="restore-view">恢复命名视图</button></nav>
    <div id="grid"></div><div id="status" role="status"></div><div id="panels"></div>
    <script type="module">
    import {createGrid,createGridViewManager} from '/@fs${root}/dist/index.js';
    import {mountAdvancedFilterBuilder,mountChangeReview,mountDiagnostics} from '/@fs${root}/dist/workbench.js';
    import {mountAnalysis} from '/@fs${root}/dist/analysis.js';
    const rows=()=>Array.from({length:120},(_,i)=>({id:String(i+1),amount:i+1,region:'地区 '+String(i+1).padStart(3,'0'),year:2025+i%2,name:'Row '+(i+1)}));
    const api=createGrid(document.getElementById('grid'),{rowKey:'id',pagination:false,rowSelection:'multiple',enableRangeSelection:true,
      columnDefs:[{field:'amount',headerName:'金额',width:140,editable:true,cellEditor:'number',validate:value=>value>=0||'金额不能为负'},
        {field:'region',headerName:'地区',width:160},{field:'year',headerName:'年度',width:110,filter:'set',filterParams:{values:[2025,2026]}},
        {field:'name',headerName:'<img src=x onerror=window.workbenchXss=1>',width:300,filter:'text'}],rowData:rows(),
      rowStyleRules:[{when:({data})=>data.amount>50,tone:'warning'},{when:({data})=>data.amount%2===0,tone:'success'}]});
    const host=document.getElementById('panels'); const status=document.getElementById('status');
    let active=null;let savedView=null;let calls=0;let pending=false;let resolver=null;
    const views=createGridViewManager(api,{scope:'workbench-browser-fixture'});
    const close=()=>{active?.destroy();active=null;};
    const fixture=window.workbenchFixture={api,saveCalls:[],
      getDraft:()=>active?.getDraft?.()??null,
      async seedChanges(count=4){for(let i=0;i<count;i++){api.view.scrollToRow(i,'nearest');api.editing.startCell({rowIndex:i,colId:'amount'});const input=document.querySelector('#grid .mach-editor-input');input.value=String(i+101);input.dispatchEvent(new Event('input',{bubbles:true}));await api.editing.stop();}},
      setPendingSave(){pending=true;},resolveSave(){resolver?.();},replaceRows(){api.rows.setData(rows());},
      raiseError(){const off=api.on('selectionChanged',()=>{throw new Error('<img src=x onerror=window.workbenchXss=1> diagnostic text');});api.selection.setById('1',true);off();}};
    const save=async changes=>{fixture.saveCalls.push(changes.map(row=>row.rowId));calls++;
      if(pending){await new Promise(resolve=>resolver=resolve);return {failures:changes.map(row=>({rowId:row.rowId,message:'过期保存错误'}))};}
      await new Promise(resolve=>setTimeout(resolve,30));
      if(calls===1)return {savedRowIds:['1'],failures:[{rowId:'2',message:'额度校验失败',colIds:['amount']}],conflicts:['3','4'].map(id=>({rowId:id,message:'服务端版本已更新',serverVersion:id==='3'?2:5,serverData:{...api.rows.getById(id).data,amount:80+Number(id)}}))};
      if(calls===2)return {savedRowIds:['2'],conflicts:changes.filter(row=>row.rowId==='3'||row.rowId==='4').map(row=>({rowId:row.rowId,message:'再次发生冲突',serverVersion:9,serverData:{...row.data,amount:90+Number(row.rowId)}}))};};
    const open=(id,mount)=>{const trigger=document.getElementById(id);trigger.onclick=()=>{close();trigger.focus();active=mount();};};
    open('filter',()=>mountAdvancedFilterBuilder(host,{api,onClose:close}));
    open('review',()=>mountChangeReview(host,{api,save,onClose:close}));
    open('analysis',()=>mountAnalysis(host,{api,pivot:{rowFields:['region'],values:[{field:'amount',aggregate:'sum'}]},onClose:close}));
    open('diagnostics',()=>mountDiagnostics(host,{api,onClose:close}));
    document.getElementById('theme').onclick=()=>{api.updateOptions({theme:api.getOption('theme')==='dark'?'light':'dark'});active?.refresh();};
    document.getElementById('save-view').onclick=async()=>{savedView=await views.save('金额视图','browser-view');status.textContent='命名视图已保存';};
    document.getElementById('restore-view').onclick=async()=>{await views.apply(savedView);status.textContent='命名视图已恢复';};
    </script></body></html>` }));
  await page.goto(url);

  await expect(page.locator('#grid .mach-row[data-index="0"] .mach-cell[data-col-id="amount"]')).toContainText("1");
}


test("filter drafts, keyboard cancel and named views share one AST", async ({ page, browserName }) => {
  await openFixture(page);
  await page.locator("#filter").click();
  const panel = page.getByRole("region", { name: "高级筛选", exact: true });
  await expect(panel).toBeFocused();
  // Safari uses Option+Tab for native navigation through all controls.
  await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
  await expect(panel.getByRole("button", { name: "关闭", exact: true })).toBeFocused();
  await panel.getByRole("button", { name: "添加条件", exact: true }).click();
  await panel.getByRole("combobox", { name: "匹配方式" }).selectOption("greaterThan");
  await panel.getByRole("spinbutton", { name: "筛选值", exact: true }).fill("50");
  expect(await page.evaluate(() => window.workbenchFixture.api.filtering.getAdvancedModel())).toBeNull();
  await panel.getByRole("button", { name: "应用筛选", exact: true }).click();
  await expect(page.locator('#grid .mach-row[data-index="0"] .mach-cell[data-col-id="amount"]')).toContainText("51");
  const applied = await page.evaluate(() => window.workbenchFixture.api.filtering.getAdvancedModel());
  await page.locator("#save-view").click();
  await expect(page.locator("#status")).toHaveText("命名视图已保存");
  await panel.getByRole("spinbutton", { name: "筛选值", exact: true }).fill("90");
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page.locator("#filter")).toBeFocused();
  expect(await page.evaluate(() => window.workbenchFixture.api.filtering.getAdvancedModel())).toEqual(applied);
  await page.locator("#filter").click();
  await panel.getByRole("button", { name: "清空草稿", exact: true }).click();
  await panel.getByRole("button", { name: "应用筛选", exact: true }).click();
  await page.locator("#restore-view").click();
  await expect(page.locator("#status")).toHaveText("命名视图已恢复");
  expect(await page.evaluate(() => window.workbenchFixture.api.filtering.getAdvancedModel())).toEqual(applied);
  expect(await page.evaluate(() => window.workbenchFixture.getDraft())).toEqual(applied);
  const accessibility = await panel.ariaSnapshot();
  expect(accessibility).toContain('button "应用筛选"');
  expect(accessibility).toContain('combobox "筛选字段"');
});

test("review partially saves, retries only failures and resolves repeated conflicts", async ({ page }) => {
  await openFixture(page);
  await page.evaluate(() => window.workbenchFixture.seedChanges());
  await page.locator("#review").click();
  const panel = page.getByRole("region", { name: "修改审阅", exact: true });
  await expect(panel.locator("article")).toHaveCount(4);
  await panel.getByRole("button", { name: "保存全部修改", exact: true }).click();
  await expect(panel).toContainText("额度校验失败");
  await expect(panel).toContainText("服务端版本 2");
  await expect(panel).toContainText("服务端版本 5");
  await panel.getByRole("button", { name: "仅重试失败与冲突", exact: true }).click();
  await expect(panel).toContainText("再次发生冲突");
  expect(await page.evaluate(() => window.workbenchFixture.saveCalls[1])).toEqual(["2", "3", "4"]);
  const third = panel.locator("article").filter({ has: page.getByRole("heading", { name: "记录 3 · 1 处修改", exact: true }) });
  await third.getByRole("button", { name: "采用服务端记录", exact: true }).click();
  await expect(third).toHaveCount(0);
  const fourth = panel.locator("article").filter({ has: page.getByRole("heading", { name: "记录 4 · 1 处修改", exact: true }) });
  await fourth.getByRole("button", { name: "保留本地并重试", exact: true }).click();
  await expect(panel).toContainText("当前没有未保存的修改");
  expect(await page.evaluate(() => window.workbenchFixture.saveCalls[2])).toEqual(["4"]);
  expect(await page.evaluate(() => window.workbenchFixture.api.rows.getById("3")?.data?.amount)).toBe(93);
});

test("review ignores a late response after same-ID data replacement", async ({ page }) => {
  await openFixture(page);
  await page.evaluate(async () => { window.workbenchFixture.setPendingSave(); await window.workbenchFixture.seedChanges(1); });
  await page.locator("#review").click();
  const panel = page.getByRole("region", { name: "修改审阅", exact: true });
  await panel.getByRole("button", { name: "保存全部修改", exact: true }).click();
  await expect(panel).toHaveAttribute("aria-busy", "true");
  await page.evaluate(async () => { window.workbenchFixture.replaceRows(); await window.workbenchFixture.seedChanges(1); window.workbenchFixture.resolveSave(); });
  await expect(panel).toHaveAttribute("aria-busy", "false");
  await expect(panel).not.toContainText("过期保存错误");
  expect(await page.evaluate(() => window.workbenchFixture.api.editing.getDirtyRowIds())).toEqual(["1"]);
});

test("analysis authors formulas, pivots, switches charts and paginates the accessible data table", async ({ page }) => {
  await openFixture(page);
  await page.locator("#analysis").click();
  const panel = page.getByRole("region", { name: "数据分析", exact: true });
  await panel.getByRole("button", { name: "添加公式", exact: true }).click();
  await panel.getByRole("textbox", { name: "公式结果列", exact: true }).fill("doubleAmount");
  await panel.getByRole("textbox", { name: "公式表达式", exact: true }).fill("[amount] * 2");
  await panel.getByRole("button", { name: "运行分析", exact: true }).click();
  await panel.getByRole("combobox", { name: "指标字段", exact: true }).selectOption("doubleAmount");
  await panel.getByRole("button", { name: "运行分析", exact: true }).click();
  await expect(panel.locator("tfoot")).toContainText("14,520");
  await expect(panel.locator("tbody tr")).toHaveCount(50);
  await expect(panel.getByRole("img")).toHaveAccessibleName(/柱状图/);
  await expect(panel.locator("svg rect")).toHaveCount(40);
  await panel.getByRole("combobox", { name: "图表类型", exact: true }).selectOption("line");
  await expect(panel.getByRole("img")).toHaveAccessibleName(/折线图/);
  await expect(panel.getByRole("combobox", { name: "图表类型", exact: true })).toBeFocused();
  await panel.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(panel.getByRole("navigation", { name: "分析结果分页" })).toContainText("第 2 / 3 页");
  await expect(panel.getByRole("button", { name: "下一页", exact: true })).toBeFocused();
  await panel.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(panel.locator("tbody tr")).toHaveCount(20);
  const accessibility = await panel.ariaSnapshot();
  expect(accessibility).toContain("透视结果数据表");
  expect(accessibility).toContain('button "运行分析"');
  await panel.getByRole("textbox", { name: "公式表达式", exact: true }).fill("1 / 0");
  await panel.getByRole("button", { name: "运行分析", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("DIV_ZERO");
  await expect(panel.getByRole("table")).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme} workbench uses theme tokens and safely displays diagnostics`, async ({ page }, testInfo) => {
    await openFixture(page);
    await page.locator("#diagnostics").click();
    if (theme === "dark") await page.locator("#theme").click();
    const panel = page.getByRole("region", { name: "表格诊断", exact: true });
    await expect(panel).toHaveAttribute("data-theme", theme);
    await expect(panel).toContainText("未知（未传入配置解析器的 explain）");
    await panel.getByRole("textbox", { name: "检查记录 ID", exact: true }).fill("60");
    await panel.getByRole("button", { name: "检查记录", exact: true }).click();
    await expect(panel).toContainText("规则 1 · warning · 命中");
    await expect(panel).toContainText("前序规则已命中");
    await page.evaluate(() => window.workbenchFixture.raiseError());
    await panel.getByRole("button", { name: "刷新诊断", exact: true }).click();
    await expect(panel).toContainText("diagnostic text");
    await expect(panel.locator("img")).toHaveCount(0);
    expect(await page.evaluate(() => window.workbenchXss)).toBeUndefined();
    const colors = await panel.evaluate((node) => { const style = getComputedStyle(node); return [style.color, style.backgroundColor]; });
    expect(colors[0]).not.toBe(colors[1]);
    await page.screenshot({ path: testInfo.outputPath(`workbench-${theme}.png`), fullPage: true });
    await page.keyboard.press("Escape");
    await expect(page.locator("#diagnostics")).toBeFocused();
  });
}

test("Chromium forced-colors preserves borders, focus and textual rule meaning", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "This engine does not expose the same forced-colors emulation contract");
  await page.emulateMedia({ forcedColors: "active" });
  await openFixture(page);
  await page.locator("#filter").click();
  const panel = page.getByRole("region", { name: "高级筛选", exact: true });
  await page.keyboard.press("Tab");
  const close = panel.getByRole("button", { name: "关闭", exact: true });
  await expect(close).toBeFocused();
  expect(await close.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe("solid");
  expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(true);
  await panel.getByRole("button", { name: "添加条件组", exact: true }).click();
  await expect(panel.getByRole("checkbox", { name: "排除整组 NOT" })).toBeVisible();
  const colors = await panel.evaluate((node) => { const style = getComputedStyle(node); return [style.borderTopColor, style.backgroundColor]; });
  expect(colors[0]).not.toBe(colors[1]);
});
