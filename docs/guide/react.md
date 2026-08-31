# React 18+ 接入

`@agile-team/mach-table-react` 要求 React 与 React DOM ≥ 18。适配包自动依赖 Core，并重导出公共类型和能力。

```bash
pnpm add @agile-team/mach-table-react
```

```ts
// 应用入口只引入一次
import "@agile-team/mach-table-react/styles.css";
```

## 基础用法

```tsx
import { useMemo } from "react";
import { MachTable, useMachTable, type ColDef } from "@agile-team/mach-table-react";

interface Employee { id: string; name: string; salary: number }

export function Employees({ rows }: { rows: Employee[] }) {
  const table = useMachTable<Employee>();
  const columns = useMemo<ColDef<Employee>[]>(() => [
    { colId: "select", width: 46, checkboxSelection: true },
    { field: "name", headerName: "姓名", flex: 1, editable: true },
    { field: "salary", headerName: "薪资", width: 140, filter: "number", align: "right" }
  ], []);

  return (
    <div style={{ height: 600 }}>
      <MachTable<Employee>
        apiRef={table.apiRef}
        columnDefs={columns}
        rowData={rows}
        rowKey="id"
        rowSelection="multiple"
        enableColumnResize
        persistence={{ key: "tenant:user:employees" }}
        onSelectionChanged={(event) => console.log(event.selectedRows.length)}
      />
    </div>
  );
}
```

`useMachTable()` 返回：

- `apiRef`：传给组件，不触发不必要渲染。
- `api`：挂载后的响应式领域 API，适合渲染按钮状态。
- `ready`：首个布局帧和 `gridReady` 完成后为 `true`。

```tsx
<button disabled={!table.ready} onClick={() => table.api?.editing.undo()}>
  撤销
</button>
```

对象型列定义和配置建议使用 `useMemo` 保持引用稳定。适配器会比较 Option 值，仅把实际变化合并为一次 `updateOptions()`；事件调用始终读取最新闭包。组件卸载与 StrictMode 重挂载会安全销毁实例。

## 应用与路由配置

React 不提供全局组件注册，使用类型安全的 Provider 管理应用约定：

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

Provider 可以按路由/布局嵌套，最近一层覆盖外层，表格 props 优先级最高。配置对象放在模块级或用 `useMemo` 稳定引用。详见[配置中心](/guide/configuration)。

## 路由级按需加载

路由本身懒加载时，页面内普通 import 已进入路由 chunk。需要表格独立边界时可直接使用默认导出：

```tsx
import { lazy, Suspense } from "react";

const MachTable = lazy(() => import("@agile-team/mach-table-react"));

<Suspense fallback={<TableSkeleton />}>
  <MachTable columnDefs={columns} rowData={rows} rowKey="id" />
</Suspense>
```

## Props 与事件

`MachTableReactProps<T>` 包含全部 `GridOptions<T>`，并增加：

- `className`、`style`：React 宿主元素。
- `gridClassName`：内部 grid 根元素。
- `gridAriaLabel/gridAriaLabelledBy/gridAriaDescribedBy`：内部可访问语义。
- `apiRef`：`MutableRefObject<GridApi<T> | null>`。

事件可通过 `onCellClicked`、`onGridReady` 等 props 接收，也可以用 `api.on()` 动态订阅。

## 远程查询、编辑与控制器

页面工作流位于独立子入口：

```tsx
import {
  useMachTableQuery,
  useMachTableEditing,
  useMachTableController
} from "@agile-team/mach-table-react/workflows";
import { MachTableToolbar } from "@agile-team/mach-table-react/ui";
```

React Hook 必须无条件调用，因此先创建 query，再传给 controller：

```tsx
const query = useMachTableQuery<Order, Filters>({
  query: filters,
  queryKey: filters,
  rowKey: "id",
  request: orderApi.page,
  mode: "manual"
});

const controller = useMachTableController<Order>({ query });

return <>
  <MachTableToolbar
    api={controller.table.api}
    commands={controller.commands}
    search={controller.search}
    onSearchChange={controller.setSearch}
    loading={controller.busy}
  />
  <MachTable<Order>
    apiRef={controller.table.apiRef}
    columnDefs={columns}
    {...controller.bindings}
  />
</>;
```

`useMachTableQuery` 管理请求取消、过期响应、服务端分页、加载/空/错状态与跨页选择；`useMachTableEditing` 管理脏数据、部分成功、失败定位和乐观锁冲突。

## 自定义 renderer

React 桥接函数从 `/adapters` 导入：

```tsx
import { reactCellRenderer, reactDetailRenderer } from "@agile-team/mach-table-react/adapters";

function SalaryCell({ value }: { value: number }) {
  return <strong>¥{value.toLocaleString()}</strong>;
}

const columns = [
  { field: "salary", cellRenderer: reactCellRenderer(SalaryCell) }
];
```

简单文本和格式优先使用 `valueFormatter` 或普通函数 renderer。React 组件适合低频、富交互单元格；适配器会优先调用 renderer 的刷新路径，不能刷新时才重建 root。

## 大型本地数据 Worker

```ts
import { createWorkerDataProcessor } from "@agile-team/mach-table-react/worker";
```

该入口只在需要大型本地排序/过滤的页面加载，不进入普通列表 chunk。
