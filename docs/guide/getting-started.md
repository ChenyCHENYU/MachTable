# 快速开始

Vue/React 项目优先使用官方适配包；只有无框架或自研框架宿主才直接安装 Core。适配包会自动安装 Core，不需要写两个依赖。

```bash
pnpm add @agile-team/mach-table-vue
# 或
pnpm add @agile-team/mach-table-react
# 或原生
pnpm add @agile-team/mach-table
```

## 原生 TypeScript 最小示例

```html
<div id="grid" style="height: 600px"></div>
```

```ts
import { createGrid, type ColDef } from "@agile-team/mach-table";
import "@agile-team/mach-table/styles/mach-table.css";

interface Machine {
  id: string;
  code: string;
  status: "运行中" | "待机" | "故障";
  temperature: number;
}

const columnDefs: ColDef<Machine>[] = [
  { colId: "select", width: 46, checkboxSelection: true, pinned: "left" },
  { field: "code", headerName: "设备编号", width: 130, pinned: "left", filter: "text" },
  { field: "status", headerName: "状态", width: 110, filter: "set" },
  {
    field: "temperature",
    headerName: "温度",
    width: 110,
    filter: "number",
    align: "right",
    valueFormatter: ({ value }) => `${value} ℃`
  }
];

const api = createGrid<Machine>(document.querySelector("#grid")!, {
  columnDefs,
  rowData: machines,
  rowKey: "id",
  rowSelection: "multiple",
  stripedRows: true
});
```

## 四条接入约定

1. 默认虚拟布局的容器必须有明确高度，例如 `height: 600px`、`flex: 1` 或 `calc(...)`。
2. 主题 CSS 必须在应用入口引入一次。
3. 生产表格应提供稳定唯一的 `rowKey`；简单字段传路径，派生规则传函数。
4. 原生宿主卸载时调用 `api.destroy()`；Vue/React 适配器会自动销毁。

## 常用操作

```ts
api.rows.setData(nextRows);
api.rows.transact({ update: [changedRow] });
const selected = api.selection.getRows();
const csv = api.io.exportCsv({ prependBOM: true });
api.view.refreshLayout();
```

在弹窗或隐藏容器中挂载时，容器可见后调用 `api.view.refreshLayout()` 重新测量。

## 下一步

- [企业级项目接入手册](/guide/enterprise-integration)
- [Vue 3 接入](/guide/vue) / [React 接入](/guide/react)
- [配置中心](/guide/configuration)
- [GridOptions](/api/grid-options) / [GridApi](/api/grid-api)
