import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import type { GridApi } from "../../packages/core/src/index";

declare global { interface Window { textOverflow:GridApi } }
const core = resolve(import.meta.dirname,"../../packages/core");

test("plain text uses a readable prefix and trailing ellipsis without changing rich cells or editors", async ({page},info) => {
  const url = new URL("/__text-overflow",info.project.use.baseURL ?? "http://127.0.0.1:4173").href;
  await page.route(url,route => route.fulfill({contentType:"text/html",body:`<!doctype html><meta charset="utf-8">
    <link rel="stylesheet" href="/@fs${core}/styles/mach-table.css"><style>#grid{width:1100px;height:300px}</style><div id="grid"></div>
    <script type="module">
    import{createGrid}from'/@fs${core}/src/index.ts';
    const text='BEGIN-工业订单完整名称-ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789-END';
    window.textOverflow=createGrid(document.getElementById('grid'),{
      rowKey:'id',rowNumber:false,pagination:false,rowHeight:36,columnMenu:false,editableIndicator:'always',
      defaultColDef:{width:140,sortable:false,filter:false},
      columnDefs:[{field:'center',headerName:'居中',rowSpan:p=>p.rowIndex===0?2:1},
        {field:'left',headerName:'左侧',align:'left'},{field:'right',headerName:'右侧',align:'right'},
        {field:'string',headerName:'自定义',cellRenderer:p=>String(p.value)},
        {field:'fallback',headerName:'回退',cellRenderer:()=>{throw Error('expected')}},
        {field:'edit',headerName:'编辑',editable:true},
        {field:'rich',headerName:'操作',cellRenderer:()=>{const button=document.createElement('button');button.textContent='Action';return button}}],
      rowData:[{id:'one',center:text,left:text,right:text,string:text,fallback:text,edit:text},
        {id:'two',center:text,left:'短',right:'短',string:'短',fallback:'短',edit:'短'}]
    });</script>`}));
  await page.goto(url);
  const row=page.locator('.mach-row[data-id="one"]');
  await expect(row.locator('.mach-cell[data-col-id="center"]')).toBeVisible();
  const samples=await row.locator('.mach-cell:not([data-col-id="rich"])').evaluateAll(cells=>cells.map(cell=>{
    const label=cell.querySelector<HTMLElement>(':scope > .mach-cell-text');
    const text=label?.firstChild;
    const range=document.createRange();
    if(text){range.setStart(text,0);range.setEnd(text,5)}
    const prefix=text?range.getBoundingClientRect():null;
    const bounds=label?.getBoundingClientRect();
    return {id:(cell as HTMLElement).dataset.colId,hasLabel:!!label,
      ellipsis:label?getComputedStyle(label).textOverflow:null,overflow:label?getComputedStyle(label).overflowX:null,
      clipped:label?label.scrollWidth>label.clientWidth:false,
      prefixVisible:!!(prefix&&bounds&&prefix.left>=bounds.left-1&&prefix.right<=bounds.right+1),
      verticalCenter:bounds?Math.abs((bounds.top+bounds.bottom-cell.getBoundingClientRect().top-cell.getBoundingClientRect().bottom)/2):null};
  }));
  await info.attach('text-overflow-geometry.json',{body:JSON.stringify(samples,null,2),contentType:'application/json'});
  for(const sample of samples){
    expect(sample.hasLabel,sample.id).toBe(true);
    expect(sample.ellipsis,sample.id).toBe('ellipsis');
    expect(sample.overflow,sample.id).toBe('hidden');
    expect(sample.clipped,sample.id).toBe(true);
    expect(sample.prefixVisible,sample.id).toBe(true);
    expect(sample.verticalCenter!,sample.id).toBeLessThanOrEqual(1);
  }
  const identity=await row.locator('[data-col-id="left"] > .mach-cell-text').evaluate(label=>{
    (window as any).retainedText=label;return label.textContent;
  });
  await page.evaluate(()=>window.textOverflow.view.refreshCells());
  expect(await row.locator('[data-col-id="left"] > .mach-cell-text').evaluate(label=>label===(window as any).retainedText)).toBe(true);
  expect(identity).toContain('BEGIN-');
  await expect(row.locator('[data-col-id="rich"] > button')).toHaveText('Action');
  await expect(row.locator('[data-col-id="rich"] .mach-cell-text')).toHaveCount(0);
  await expect(row.locator('[data-col-id="edit"] > .mach-cell-text + .mach-cell-edit-trigger')).toBeVisible();
  await row.locator('[data-col-id="edit"] .mach-cell-edit-trigger').click();
  const input=row.locator('[data-col-id="edit"] input');
  await expect(input).toHaveValue(/BEGIN-/);
  await expect(row.locator('[data-col-id="edit"] .mach-cell-text')).toHaveCount(0);
  await input.press('Escape');
  await expect(row.locator('[data-col-id="edit"] > .mach-cell-text')).toContainText('BEGIN-');
  await page.screenshot({path:info.outputPath('text-overflow.png')});
});
