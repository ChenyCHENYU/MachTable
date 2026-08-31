# 分页 / 导入导出 / 打印 / 水印

表格内置的"完整一套"外围能力：分页器默认开启、CSV/模板下载、CSV 导入、打印、水印——不引第三方依赖，全部可开关。

## 分页器（内置，默认开启）

```ts
createGrid(host, {
  columnDefs,
  rowData,                    // 客户端数据自动本地分页
  // pagination: 默认开启（pageSize 20）
  // 关闭：pagination: false（大数据虚拟滚动场景推荐关闭或用 datasource）
});

// 配置项
createGrid(host, {
  pagination: {
    pageSize: 20,
    pageSizeOptions: [10, 20, 50, 100],
    showTotal: true,            // "共 55 条"
    showPageSizeSelector: true  // "20 条/页" 下拉
  }
});
```

行为语义（均按你的习惯设计）：

| 规则 | 行为 |
| --- | --- |
| 默认 | **开启**（客户端模式）；`datasource` 无限滚动模式自动关闭 |
| 无数据 | 分页条自动隐藏 |
| 单页数据 | 分页条正常显示（翻页按钮禁用）；`pagination: false` 完全关闭 |
| 翻页 | « ‹ 第 1 / 3 页 › »，边界自动禁用；翻页回到页首 |
| 每页条数 | 切换后保持首个可见行所在页 |
| 过滤/排序 | 应用后页码自动收敛（超出时回到第 1 页） |
| 序号列 | 跨页绝对编号（第 2 页首页显示 21） |
| CSV 导出 / 打印 | 始终覆盖**全部页**（不只当前页） |
| 事件 | `paginationChanged: { page, pageSize, pageCount, total }` |

API：`api.pagination.setPage(n)` `api.pagination.setPageSize(n)` `api.pagination.getPage()` `api.pagination.getPageCount()` `api.pagination.getTotalRowCount()` `api.pagination.isEnabled()` `api.pagination.setEnabled(bool)`；运行时 `api.updateOptions({ pagination: false })`。

服务端分页：用 `manualSorting` + `manualFiltering` + 自己的分页 UI，或走 [无限滚动](/recipes/infinite-scroll)。

## 导出

```ts
import { downloadFile } from "@agile-team/mach-table";

// 全量导出（跨页、含表头、防公式注入、Excel 中文 BOM）
const csv = api.io.exportCsv({ prependBOM: true });
downloadFile("设备清单.csv", csv, "text/csv;charset=utf-8");

// 仅选中行
api.io.exportCsv({ onlySelected: true, prependBOM: true });

// 模板下载：只有表头
downloadFile("导入模板.csv", api.io.exportCsv({ headersOnly: true, prependBOM: true }));
```

## 导入（CSV → 表格）

```ts
// 模式一：替换全部数据（表头自动映射到列：headerName / field / colId）
api.io.importCsv(csvText);

// 模式二：追加
api.io.importCsv(csvText, { mode: "append" });

// 模式三：走粘贴管线（只写可编辑格、支持撤销、逐格触发 cellValueChanged）
api.io.importCsv(csvText, { mode: "paste" });

// 自定义分隔符（默认逗号）
api.io.importCsv(text, { separator: ";" });
```

配合文件选择：

```html
<input type="file" accept=".csv" id="file" />
```

```ts
document.getElementById("file")!.addEventListener("change", async (e) => {
  const text = await (e.target as HTMLInputElement).files![0].text();
  api.io.importCsv(text);
});
```

数值自动转型（"88" → 88）、空串 → null、表头不识别时按列顺序映射。底层解析器 `parseCsv(text, separator?)` 已导出可独立使用。

## 打印

```ts
api.io.print({ title: "设备清单" });
// 打开新窗口：过滤/排序后的全部数据（跨页）、可见列、简洁表格样式，自动唤起打印
// 弹窗被拦截时返回 false
```

## 水印

```ts
createGrid(host, {
  watermark: { text: "内部资料 · 张三" }
  // fontSize?: 14, opacity?: 0.06, gap?: 160, angle?: -22, color?: 自动适配暗色
});

// watermark: true → 默认文本 "MachTable"
api.updateOptions({ watermark: { text: "新水印" } });   // 运行时切换
api.updateOptions({ watermark: false });                 // 关闭
```

canvas 平铺斜纹、`pointer-events: none` 不影响任何交互、覆盖表头与表体、暗色主题自动用浅色字。

## 滚动条

细 10px 圆角拖拽手柄（视觉 4px）、透明轨道、悬停主色渐显、按住加深——精致但不抢焦点。Firefox 走 `scrollbar-width: thin` 原生方案。颜色可调：`--mach-scrollbar-thumb`。
