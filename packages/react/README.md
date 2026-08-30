<p align="center">
  <img src="https://raw.githubusercontent.com/ChenyCHENYU/MachTable/main/assets/mach-table-logo.svg" alt="MachTable" width="760" />
</p>

# @agile-team/mach-table-react

Official React 18+ adapter for MachTable 0.15. It provides a generic `<MachTable>`, full app/route configuration, remote query and editing workflows, a cohesive controller, optional and persistent column resizing, a standard toolbar, React cell/detail renderer factories, latest-closure event handling and StrictMode-safe cleanup. `RobotGrid` remains a deprecated 0.x alias.

## Install

```bash
pnpm add @agile-team/mach-table-react
```

Import the stylesheet once from your application entry:

```ts
import "@agile-team/mach-table-react/styles.css";
```

## Direct import

```tsx
import { useMemo } from "react";
import { MachTable, useMachGrid, type ColDef } from "@agile-team/mach-table-react";

interface Row { id: string; name: string }

export function App({ rows }: { rows: Row[] }) {
  const grid = useMachGrid<Row>();
  const columns = useMemo<ColDef<Row>[]>(
    () => [{ field: "name", headerName: "Name", flex: 1 }],
    []
  );

  return (
    <div style={{ height: 520 }}>
      <MachTable<Row>
        apiRef={grid.apiRef}
        rowData={rows}
        columnDefs={columns}
        rowKey="id"
        stateKey="customer-list"
        enableColumnResize
      />
    </div>
  );
}
```

## Route-level lazy loading

React intentionally has no global component registry. MachTable provides a default component export so the standard `React.lazy` API works without a mapping wrapper:

```tsx
import { lazy, Suspense } from "react";

const MachTable = lazy(() => import("@agile-team/mach-table-react"));

export function OrdersPage() {
  return (
    <Suspense fallback={<div>Loading table...</div>}>
      <MachTable columnDefs={columns} rowData={rows} />
    </Suspense>
  );
}
```

When the page itself is route-lazy, a normal named import inside that page already produces the same route-level split. Use `React.lazy` when the grid should be split independently from the page.

## Application and route defaults

Keep table conventions in one file. Providers can be nested; the nearest configuration is merged, named presets are reusable, and explicit table props win:

```tsx
// mach-table.config.ts
import { defineMachTableConfig, defineMachTablePreset } from "@agile-team/mach-table-react";
export default defineMachTableConfig({
  defaults: {
    size: "compact",
    enableColumnResize: true,
    defaultColDef: { sortable: true, resizable: true, filter: true }
  },
  defaultPreset: "list",
  presets: {
    list: defineMachTablePreset({ pagination: false }),
    crud: defineMachTablePreset({ rowSelection: "multiple", editType: "fullRow" })
  }
});

// main.tsx
<MachTableProvider config={machTableConfig}>
  <App />
</MachTableProvider>
```

The adapter installs the matching `@agile-team/mach-table` core automatically and re-exports its complete API and types. Only `react >= 18` and `react-dom >= 18` remain peer dependencies supplied by the host application.

## Remote lists and standard workflows

Import heavier page workflows from the tree-shakeable subpath:

```tsx
import { useMachTableQuery, useMachTableController } from "@agile-team/mach-table-react/workflows";
import { MachTable, MachTableToolbar } from "@agile-team/mach-table-react";

const query = useMachTableQuery({
  query: filters,
  queryKey: filters,
  rowKey: "id",
  request: orderApi.page,
  mode: "manual"
});
const controller = useMachTableController({ query });

<MachTableToolbar
  api={controller.table.api}
  commands={controller.commands}
  search={controller.search}
  onSearchChange={controller.setSearch}
  loading={controller.busy}
/>;
<MachTable apiRef={controller.table.apiRef} {...controller.bindings} />;
```

The query hook cancels superseded requests, ignores stale responses, exposes an error overlay and supports cross-page or select-all-matching selection. `useMachTableEditing()` adds dirty state, guarded saves, rollback and reveal helpers.

## Cell and full-row editing

```tsx
import { MachTable, rowActionsColumn } from "@agile-team/mach-table-react";

const columns = [
  { field: "name", editable: true },
  { field: "age", editable: true, cellEditor: "number" },
  rowActionsColumn({ onView, onDelete, overflow: "drawer" })
];

<MachTable editType="fullRow" columnDefs={columns} rowData={rows} />;
```

Cell mode is the default and provides a pencil plus inline confirm/cancel controls. Use `editableIndicator="always" | "hover" | "none"` to match the page density.

Documentation: [React guide](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/react.md) · [Enterprise integration](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/enterprise-integration.md) · [Next.js / SSR](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/ssr.md)

Source-available © ChenyCHENYU (Agile Team). Any use requires prior written authorization. See the [license](https://github.com/ChenyCHENYU/MachTable/blob/main/LICENSE) and [authorization process](https://github.com/ChenyCHENYU/MachTable/blob/main/LICENSING.md).
