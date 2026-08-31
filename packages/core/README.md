<p align="center">
  <img src="https://raw.githubusercontent.com/ChenyCHENYU/MachTable/main/assets/mach-table-logo.svg" alt="MachTable" width="760" />
</p>

# @agile-team/mach-table

Enterprise-grade, framework-independent TypeScript data grid. Zero runtime dependencies, virtualized rows and columns, polished cell/full-row editing, async validation, action columns, change tracking, versioned state and resilient infinite loading.

```bash
pnpm add @agile-team/mach-table
```

```ts
import { createGrid } from "@agile-team/mach-table";
import "@agile-team/mach-table/styles/mach-table.css";

const api = createGrid(document.querySelector("#grid")!, {
  columnDefs: [
    { field: "id", headerName: "ID", width: 120 },
    { field: "name", headerName: "Name", flex: 1, editable: true }
  ],
  rowData: [{ id: "1", name: "MachTable" }],
  rowKey: "id",
  enableColumnResize: true,
  stateKey: "customer-list"
});

// Required for native integrations when the host is removed.
api.destroy();
```

Complex business workflows use first-class APIs instead of adapter-specific glue:

```ts
const state = api.getState();
await api.saveChanges((changes) => orderApi.save(changes));
api.rollbackChanges();
console.info(api.getDiagnostics());

await api.applyTransactionAsync({ update: realtimeRows });
api.applyState(state);
```

0.23 adds governed domain APIs, incremental update invalidation and bounded remote-resource scheduling without removing the flat 0.x API:

```ts
api.batch((grid) => {
  grid.rows.apply({ update: changedRows });
  grid.columns.setVisible("internalNote", false);
  grid.refreshCells({ rowIds: changedIds, columns: ["status"] });
});

console.info(api.diagnostics.get().updates);
```

For very large remote datasets, opt into random-access blocks. Sequential infinite loading remains the compatibility default:

```ts
const options = {
  datasource,
  datasourceMode: "block" as const,
  datasourceRowCount: 1_000_000,
  blockSize: 200,
  maxBlocksInCache: 12,
  blockPrefetch: 1
};

await api.rows.ensureLoaded(40_000, 40_200, { signal });
console.info(api.rows.getCacheSnapshot());
```

Worker runtime helpers are intentionally split from the default entry:

```ts
import { createWorkerDataProcessor, installGridDataWorker } from "@agile-team/mach-table/worker";
```

0.18 added governed runtime APIs, nested filters, named views, conflict-aware saves and performance evidence:

```ts
const views = createGridViewManager(api, { scope: "tenant:user:orders" });
await views.save("My pending orders");

const result = await api.saveChangesDetailed(orderApi.saveChanges);
console.table(result.failures);
console.table(result.conflicts);
console.info(api.getDiagnostics().performance);
```

`GridState` v1 inputs migrate to v2 automatically. `GridFeature` manifests can declare `version`, `requires` and `conflicts`; invalid graphs are isolated before setup side effects run. JavaScript/JSON option patches are sanitized from the same metadata registry used by Core and framework adapters.

0.13 added a built-in/headless column workbench and cancellable lazy trees:

```ts
api.openColumnWorkbench();
const columns = api.getColumnWorkbenchItems();

const treeOptions = {
  treeData: true,
  isTreeRowExpandable: ({ data }) => data.hasChildren,
  loadTreeChildren: ({ data, signal }) => catalogApi.children(data.id, { signal })
};
```

XLSX stays outside Core; install `@agile-team/mach-table-xlsx` only on Excel routes.

Polished editing and row actions are built in rather than adapter-specific:

```ts
import { rowActionsColumn } from "@agile-team/mach-table";

const options = {
  editType: "fullRow" as const,
  columnDefs: [
    { field: "name", editable: true },
    { field: "age", editable: true, cellEditor: "number" },
    rowActionsColumn({ onView, onDelete, overflow: "drawer" })
  ]
};
```

Cell mode remains the default and renders a subtle pencil plus inline confirm/cancel controls. Use `editableIndicator: "always" | "hover" | "none"` to match the page density.

0.14 removes common page glue with automatic GridState persistence, an explicit error overlay, compact row keys and framework-neutral toolbar commands:

```ts
import { createMachTableCommands } from "@agile-team/mach-table";

const commands = createMachTableCommands({ getApi: () => api });
commands.search("pending");
await commands.refresh();

api.setOverlay("error", () => "Request failed. Please retry.");
```

`rowKey: "id"` is shorthand for a stable field path; `getRowId` remains available for derived IDs and wins when both are present. `domLayout: "autoHeight"` is intended only for small client-side tables—normal virtual layout remains the large-data default.

Column resizing is deliberately opt-in. Set `enableColumnResize: true`; add `stateKey` to remember the complete workspace, or `columnStateKey` to remember only widths/order/visibility/pinning/sort. Pointer cancellation rolls back, completed drags persist once, and untouched automatic/flex columns remain responsive.

For framework applications use the official adapters:

- Vue 3: [`@agile-team/mach-table-vue`](https://www.npmjs.com/package/@agile-team/mach-table-vue)
- React 18+: [`@agile-team/mach-table-react`](https://www.npmjs.com/package/@agile-team/mach-table-react)

Documentation: [Quick start](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/getting-started.md) · [Enterprise integration](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/enterprise-integration.md) · [API](https://github.com/ChenyCHENYU/MachTable/tree/main/docs/api)

> Overlay strings render as text by default. Prefer HTMLElement factories for rich content; enable `allowUnsafeOverlayHtml` only for fully trusted static markup.

Source-available © ChenyCHENYU (Agile Team). Any use requires prior written authorization. See the [license](https://github.com/ChenyCHENYU/MachTable/blob/main/LICENSE) and [authorization process](https://github.com/ChenyCHENYU/MachTable/blob/main/LICENSING.md).
