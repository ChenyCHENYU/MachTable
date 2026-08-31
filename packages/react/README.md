<p align="center">
  <img src="https://raw.githubusercontent.com/ChenyCHENYU/MachTable/main/assets/mach-table-logo.svg" alt="MachTable" width="760" />
</p>

# @agile-team/mach-table-react

MachTable 0.28 的官方 React 18+ 适配包。一个依赖即可获得 Core、泛型 `<MachTable>`、应用/路由配置、按需工作流、StrictMode 安全清理和最新闭包事件处理。

```bash
pnpm add @agile-team/mach-table-react
```

应用入口只引入一次样式：

```ts
import "@agile-team/mach-table-react/styles.css";
```

## 基础接入

```tsx
import { useMemo } from "react";
import { MachTable, useMachTable, type ColDef } from "@agile-team/mach-table-react";

interface Row { id: string; name: string }

export function Customers({ rows }: { rows: Row[] }) {
  const table = useMachTable<Row>();
  const columns = useMemo<ColDef<Row>[]>(
    () => [{ field: "name", flex: 1, editable: true }],
    []
  );

  return (
    <div style={{ height: 520 }}>
      <MachTable<Row>
        apiRef={table.apiRef}
        rowData={rows}
        columnDefs={columns}
        rowKey="id"
        enableColumnResize
        persistence={{ key: "customers:list", sections: ["columns"] }}
      />
    </div>
  );
}
```

对象型列和配置建议用 `useMemo` 保持引用稳定。`useMachTable()` 同时提供 `apiRef`、响应式 `api` 与 `ready`。

## 应用配置

```ts
// src/config/mach-table.config.ts
import { defineMachTableConfig, defineMachTablePreset } from "@agile-team/mach-table-react";

export default defineMachTableConfig({
  defaults: {
    size: "compact",
    columnLayout: "fit",
    enableColumnResize: true,
    defaultColDef: { sortable: true, filter: true, resizable: true }
  },
  defaultPreset: "list",
  presets: {
    list: defineMachTablePreset({ stripedRows: true }),
    crud: defineMachTablePreset({ rowSelection: "multiple", editType: "fullRow" })
  }
});
```

```tsx
<MachTableProvider config={machTableConfig}>
  <App />
</MachTableProvider>
```

Provider 可按路由/布局嵌套，最近一层覆盖外层，表格 props 优先级最高。

## 按需加载

React 不模拟全局组件注册。路由本身懒加载时普通 import 已自然拆包；需要独立边界时：

```tsx
const MachTable = lazy(() => import("@agile-team/mach-table-react"));
```

可选能力使用子入口：

```tsx
import { useMachTableQuery, useMachTableEditing } from "@agile-team/mach-table-react/workflows";
import { MachTableToolbar } from "@agile-team/mach-table-react/ui";
import { reactCellRenderer } from "@agile-team/mach-table-react/adapters";
import { createWorkerDataProcessor } from "@agile-team/mach-table-react/worker";
```

- `/workflows`：请求取消、防过期覆盖、服务端分页、跨页选择、脏数据和冲突保存；`reset()` 清空全部表格过滤且只请求一次。
- `/ui`：可选标准工具栏。
- `/adapters`：自定义 React cell/detail renderer 桥接。
- `/worker`：大型本地过滤/排序的独立 Worker 能力。

```tsx
const query = useMachTableQuery({
  query: filters,
  queryKey: filters,
  rowKey: "id",
  request: orderApi.page,
  mode: "manual"
});

<MachTable<Row> apiRef={table.apiRef} columnDefs={columns} {...query.bindings} />;
```

该包自动依赖 `@agile-team/mach-table` 并重导出 Core 类型；宿主只需提供 `react` 和 `react-dom >= 18`。

文档：[React 指南](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/react.md) · [企业接入](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/enterprise-integration.md) · [SSR](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/ssr.md)

Source-available © ChenyCHENYU (Agile Team). 任何使用均须事先取得书面授权。详见 [LICENSE](https://github.com/ChenyCHENYU/MachTable/blob/main/LICENSE) 与[授权流程](https://github.com/ChenyCHENYU/MachTable/blob/main/LICENSING.md)。
