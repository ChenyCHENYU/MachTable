import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";
import type { GridApi } from "../../packages/core/src/index";
import type { ServerSideProjection, ServerSideStore } from "../../packages/core/src/server-side";

interface Row { name: string; amount: number }
interface Fixture {
  api: GridApi<ServerSideProjection<Row>>;
  store: ServerSideStore<Row>;
  hold(query: string): void;
  release(): void;
  pending(): number;
  lateWrites: number;
  destroy(): void;
}
declare global { interface Window { serverSideFixture: Fixture } }
const root = resolve(import.meta.dirname, "../../packages/core");
const url = "http://127.0.0.1:4173/__server-side-store";

async function openFixture(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1250, height: 800 });
  await page.route(url, route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
    <link rel="stylesheet" href="/@fs${root}/dist/mach-table.css"><link rel="stylesheet" href="/@fs${root}/styles/server-side.css">
    <style>body{margin:24px;font:14px system-ui;background:#f1f5f9}#grid{height:420px;width:1150px}nav{display:flex;gap:8px;margin-bottom:12px}#status{min-height:26px}</style></head>
    <body><h1>服务端分组 Store · 模拟传输</h1><nav><button id="bump">模拟服务端并发修改</button><button id="commit">提交事务</button>
    <button id="refresh">刷新</button><button id="saved">确认本地修改已保存</button><button id="cancel">取消编辑</button></nav><div id="status" role="status"></div><div id="grid"></div>
    <script type="module">
    import {createGrid} from '/@fs${root}/dist/index.js';
    import {createServerSideStore,bindServerSideGrid,createServerSideGroupColumn,serverSideDataColumn,ServerSideVersionConflictError} from '/@fs${root}/dist/server-side.js';
    let revision=1,increment=0;const held=new Set(),resolvers=[];let destroyed=false;
    const status=document.getElementById('status');
    const store=createServerSideStore({blockSize:2,maxBlocks:2,retryCount:0,
      query:{rowGroupCols:[{colId:'name'}],valueCols:[{colId:'amount',aggFunc:'sum'}]},
      async getRows(request){
        const query=request.quickFilterText||'base',version=String(revision),addition=increment;
        const rows=request.route.length?Array.from({length:3},(_,i)=>({id:String(i+1),data:{name:request.route[0]+' order '+(i+1),amount:(i+1)*10+addition}}))
          :['A','B','C'].map(key=>({id:key,groupKey:key,childCount:3,data:{name:query+' '+key,amount:0},aggValues:{amount:60+addition*3}}));
        if(held.has(query))await new Promise(resolve=>resolvers.push(resolve));
        return{rows:rows.slice(request.startRow,request.endRow),rowCount:rows.length,revision:version};
      },
      async transact(request){if(request.expectedRevision!==String(revision))throw new ServerSideVersionConflictError(request.expectedRevision,String(revision));
        revision++;increment=5;return{revision:String(revision)};},onError:error=>status.textContent=error.message});
    const amount={...serverSideDataColumn('amount',{headerName:'金额',width:160,sortable:true}),editable:({data})=>data?.groupKey===undefined,cellEditor:'number'};
    const api=createGrid(document.getElementById('grid'),{rowData:[],columnDefs:[createServerSideGroupColumn(store,{width:560}),serverSideDataColumn('name',{headerName:'名称',width:280}),amount],
      onModelUpdated:()=>{if(destroyed)window.serverSideFixture.lateWrites++;}});
    const fixture=window.serverSideFixture={api,store,lateWrites:0,hold:query=>held.add(query),release(){held.clear();for(const done of resolvers.splice(0))done();},
      pending:()=>resolvers.length,destroy(){destroyed=true;api.destroy();}};
    bindServerSideGrid(api,store);
    document.getElementById('bump').onclick=()=>{revision++;status.textContent='服务端版本已变化';};
    document.getElementById('commit').onclick=()=>{const route=store.getSnapshot().routes.find(item=>item.route[0]==='A');
      void store.transact({route:['A'],expectedRevision:route.revision,update:[{id:'1',data:{name:'A order 1',amount:15}}]})
      .then(()=>status.textContent='事务成功，父聚合已刷新').catch(error=>status.textContent=error.name);};
    document.getElementById('refresh').onclick=()=>{void store.refresh().catch(()=>undefined);};
    document.getElementById('saved').onclick=()=>api.editing.markSaved();
    document.getElementById('cancel').onclick=()=>{void api.editing.stop({cancel:true});};
    </script></body></html>` }));
  await page.goto(url);
  await expect(page.getByRole("button", { name: "展开 A", exact: true })).toBeVisible();
}

test("route controls page children, show aggregates and retain hierarchical selection", async ({ page }) => {
  await openFixture(page);
  await expect(page.locator('.mach-row[data-index="0"] .mach-cell[data-col-id="amount"]')).toHaveText("60");
  await page.getByRole("button", { name: "展开 A", exact: true }).click();
  await expect(page.locator('.mach-row[data-index="1"] .mach-cell[data-col-id="name"]')).toHaveText("A order 1");
  await page.getByRole("checkbox", { name: "选择 A", exact: true }).check();
  const group = page.locator('.mach-row[data-index="0"] .mach-cell[data-col-id="__server_group"]');
  await expect(group).toContainText("1–2 / 3");
  await group.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(group).toContainText("3–3 / 3");
  await expect(page.locator('.mach-row[data-index="1"] .mach-cell[data-col-id="name"]')).toHaveText("A order 3");
  expect(await page.evaluate(() => window.serverSideFixture.store.getSnapshot().selection.selectedRoutes)).toEqual([["A"]]);
  await page.getByRole("checkbox", { name: "选择 3", exact: true }).uncheck();
  expect(await page.evaluate(() => window.serverSideFixture.store.getSelection(window.serverSideFixture.store.getSnapshot().rows[0]))).toBe("partial");
  await page.getByRole("button", { name: "收起 A", exact: true }).click();
  await expect(page.locator('.mach-row[data-index="1"] .mach-cell[data-col-id="name"]')).toHaveText("base B");
});

test("server CAS conflicts remain explicit and successful transactions refresh parent aggregates", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "展开 A", exact: true }).click();
  await page.locator("#bump").click(); await page.locator("#commit").click();
  await expect(page.locator("#status")).toHaveText("ServerSideVersionConflictError");
  await expect(page.locator('.mach-row[data-index="0"] .mach-cell[data-col-id="amount"]')).toHaveText("60");
  await page.locator("#refresh").click();
  await expect.poll(() => page.evaluate(() => window.serverSideFixture.store.getSnapshot().routes.find(route => route.route[0] === "A")?.revision)).toBe("2");
  await page.locator("#commit").click();
  await expect(page.locator("#status")).toHaveText("事务成功，父聚合已刷新");
  await expect(page.locator('.mach-row[data-index="0"] .mach-cell[data-col-id="amount"]')).toHaveText("75");
});

test("rapid query changes reject late transport results and destroy prevents late writes", async ({ page }) => {
  await openFixture(page);
  await page.evaluate(() => { window.serverSideFixture.hold("old"); window.serverSideFixture.api.filtering.setQuickText("old"); });
  await expect.poll(() => page.evaluate(() => window.serverSideFixture.pending())).toBeGreaterThan(0);
  await page.evaluate(() => window.serverSideFixture.api.filtering.setQuickText("new"));
  await expect(page.locator('.mach-row[data-index="0"] .mach-cell[data-col-id="name"]')).toHaveText("new A");
  await page.evaluate(() => window.serverSideFixture.release());
  await expect(page.locator('.mach-row[data-index="0"] .mach-cell[data-col-id="name"]')).toHaveText("new A");
  await page.evaluate(() => { window.serverSideFixture.hold("destroy"); window.serverSideFixture.api.filtering.setQuickText("destroy"); });
  await expect.poll(() => page.evaluate(() => window.serverSideFixture.pending())).toBeGreaterThan(0);
  await page.evaluate(() => { window.serverSideFixture.destroy(); window.serverSideFixture.release(); });
  await expect(page.locator("#grid .mach-root")).toHaveCount(0);
  expect(await page.evaluate(() => window.serverSideFixture.lateWrites)).toBe(0);
  expect(await page.evaluate(() => window.serverSideFixture.store.getSnapshot().rows)).toEqual([]);
});

test("new route pages wait for local editing to finish without losing drafts", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "展开 A", exact: true }).click();
  await page.locator('.mach-row[data-index="1"] .mach-cell[data-col-id="amount"]').dblclick();
  await page.locator(".mach-editor-input").fill("99");
  await page.evaluate(() => window.serverSideFixture.store.load(["A"], 2));
  await expect(page.locator(".mach-server-sync-notice")).toBeVisible();
  await expect(page.locator(".mach-editor-input")).toHaveValue("99");
  await page.locator("#cancel").click();
  await expect(page.locator(".mach-server-sync-notice")).toHaveCount(0);
  await expect(page.locator('.mach-row[data-index="1"] .mach-cell[data-col-id="name"]')).toHaveText("A order 3");
});
