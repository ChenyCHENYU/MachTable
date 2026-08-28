# 快速开始（原生 TS / JS）

任何框架、甚至无框架环境都可使用 core 包。

## 安装

```bash
pnpm add @agile-team/mach-table
# 或 npm i @agile-team/mach-table / yarn add @agile-team/mach-table
```

## 最小示例

```html
<div id="grid" style="height: 600px"></div>
```

```ts
import "@agile-team/mach-table/styles/mach-table.css";
import { createGrid } from "@agile-team/mach-table";
import type { GridApi, ColDef } from "@agile-team/mach-table";

interface Machine {
  id: string;
  code: string;
  status: "运行中" | "待机" | "故障";
  temperature: number;
}

const columnDefs: ColDef<Machine>[] = [
  {
    colId: "sel",
    headerName: "",
    width: 46,
    pinned: "left",
    checkboxSelection: true,
    sortable: false,
    resizable: false,
    movable: false
  },
  { field: "code", headerName: "设备编号", width: 130, pinned: "left", filter: "text" },
  { field: "status", headerName: "状态", width: 110, filter: "set" },
  {
    field: "temperature",
    headerName: "温度",
    width: 110,
    filter: "number",
    type: "rightAligned",
    valueFormatter: (p) => `${p.value} ℃`,
    cellStyle: (p) => (Number(p.value) > 70 ? { color: "red", fontWeight: "700" } : {})
  }
];

const api: GridApi<Machine> = createGrid<Machine>(document.getElementById("grid")!, {
  columnDefs,
  rowData: machines,          // 直接给 1 万行也流畅
  rowSelection: "multiple",
  getRowId: (p) => p.data.id, // 推荐：稳定行 id
  stripedRows: true
});
```

## 关键约定

1. **容器必须有高度**：`height: 600px`、`flex: 1`、`calc(100vh - xx)` 均可，表格自适应填满
2. **必须引入主题 CSS**：`@agile-team/mach-table/styles/mach-table.css`
3. **强烈建议提供 `getRowId`**：行编辑、选择保持、撤销、无限滚动都依赖稳定 id；缺失时使用自动 id，`setRowData` 后选中态会重置
4. **销毁**：`api.destroy()` 移除 DOM 与全部事件监听（SPA 路由切换时务必调用）

## 常用后续操作

```ts
api.setRowData(nextRows);                        // 全量替换（清空撤销栈）
api.applyTransaction({ update: [row] });         // 增量 增/删/改
api.getSelectedRows();                           // 选中数据
api.getDataAsCsv({ prependBOM: true });          // 导出 CSV
api.destroy();                                   // 销毁
```

## 弹窗 / 隐藏容器中使用

表格挂载时若容器不可见（如 el-dialog 打开前），尺寸测量为 0。在容器可见后刷新一次：

```ts
const onDialogOpen = () => {
  nextTick(() => api.refreshLayout());
};
```

## 下一步

- [企业级项目接入手册](/guide/enterprise-integration)
- [React 接入](/guide/react) / [Vue 3 接入](/guide/vue)
- [Element Plus 集成](/guide/element-plus) / [Naive UI 集成](/guide/naive-ui)
- [GridOptions 全量配置](/api/grid-options)
