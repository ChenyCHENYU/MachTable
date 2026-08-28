# React 接入

`@agile-team/mach-table-react` 提供 `<RobotGrid>` 组件（并导出语义化别名 `<MachTable>`）与 React 适配器，要求 react/react-dom ≥ 18。

## 安装

```bash
pnpm add @agile-team/mach-table @agile-team/mach-table-react
```

## 基础用法

```tsx
import { useRef, useState } from "react";
import "@agile-team/mach-table/styles/mach-table.css";
import { RobotGrid } from "@agile-team/mach-table-react";
import type { GridApi, ColDef } from "@agile-team/mach-table";

interface Employee { id: string; name: string; salary: number }

export default function Page() {
  const [count, setCount] = useState(0);
  const apiRef = useRef<GridApi<Employee> | null>(null);

  const columnDefs: ColDef<Employee>[] = [
    { colId: "sel", headerName: "", width: 46, checkboxSelection: true },
    { field: "name", headerName: "姓名", flex: 1, editable: true },
    { field: "salary", headerName: "薪资", width: 140, filter: "number", type: "rightAligned" }
  ];

  return (
    <div style={{ height: 600 }}>
      <RobotGrid<Employee>
        apiRef={apiRef}
        columnDefs={columnDefs}
        rowData={rows}
        rowSelection="multiple"
        getRowId={(p) => p.data.id}
        stripedRows
        onSelectionChanged={(e) => setCount(e.selectedRows.length)}
        onCellValueChanged={(e) => console.log(e.colDef.field, e.oldValue, "→", e.newValue)}
      />
      <span>已选 {count} 行</span>
    </div>
  );
}
```

## Props

`RobotGridReactProps<TData> = Omit<GridOptions<TData>, "className"> & { className?, gridClassName?, style?, apiRef? }`

- **所有 GridOptions 项都是 props**（camelCase），完整清单见 [GridOptions](/api/grid-options)
- 事件既可用 `onCellClicked` 等 props，也可 `api.addEventListener`
- `apiRef`（`MutableRefObject<GridApi | null>`）在 grid ready 后被赋值；也可用 `onGridReady` 事件
- `className` 作用于 React 宿主，`gridClassName` 作用于内部 `.mach-root`

## 响应式更新语义

| Prop 变化 | 行为 |
| --- | --- |
| `rowData`（引用变化） | `api.setRowData` 全量替换 |
| `columnDefs`（引用变化） | `api.setColumnDefs`（列宽/顺序/显隐状态保留） |
| `quickFilterText` | `api.setQuickFilter` |
| 尺寸、主题、选择、摘要、固定行、提示、状态栏、覆盖层等行为项 | `api.updateOptions` 增量应用 |
| 事件回调变化 | 自动绑定最新闭包（无需 key 重挂） |

组件挂载时创建 grid、卸载时自动 `destroy`，StrictMode 双挂载安全。

## React 单元格渲染器

```tsx
import { reactCellRenderer } from "@agile-team/mach-table-react";

function SalaryCell(props: { value: number }) {
  const color = props.value > 25000 ? "#dc2626" : "#16a34a";
  return <strong style={{ color }}>¥{props.value.toLocaleString()}</strong>;
}

const columnDefs: ColDef<Employee>[] = [
  { field: "salary", headerName: "薪资", cellRenderer: reactCellRenderer(SalaryCell) }
];
```

::: warning 性能提示
`reactCellRenderer` 每个可见单元格一个 React root，适合低频/富交互单元格。纯文本格式化请优先用 `valueFormatter`（零开销），或 `cellRenderer` 返回字符串。
:::

## 明细行渲染 React 组件

```tsx
import { reactDetailRenderer } from "@agile-team/mach-table-react";

<RobotGrid
  masterDetail
  detailRowHeight={280}
  detailRowRenderer={reactDetailRenderer(OrderDetailPanel)}
  ...
/>
```

展开时挂载、收起时卸载，`destroy` 自动调用。

## useMachGrid Hook（推荐）

```tsx
import { RobotGrid, useMachGrid } from "@agile-team/mach-table-react";

function Page() {
  const grid = useMachGrid<Employee>();

  return (
    <>
      <RobotGrid<Employee> apiRef={grid.apiRef} columnDefs={defs} rowData={rows} rowSelection="multiple" />
      <button disabled={!grid.api} onClick={() => grid.api?.undo()}>撤销</button>
    </>
  );
}
```

挂载后 `grid.api` 可用（渲染期安全判空），`grid.apiRef` 兼容现有 props 协议。

## Hooks 风格（状态式）

当前推荐 `apiRef` + `onGridReady`。若偏好状态式：

```tsx
const [api, setApi] = useState<GridApi<Employee> | null>(null);
<RobotGrid onGridReady={(e) => setApi(e.api)} ... />
```
