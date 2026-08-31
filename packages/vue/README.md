<p align="center">
  <img src="https://raw.githubusercontent.com/ChenyCHENYU/MachTable/main/assets/mach-table-logo.svg" alt="MachTable" width="760" />
</p>

# @agile-team/mach-table-vue

Official Vue 3 adapter for MachTable 0.19. It provides a generic `<MachTable>`, native typed slots, dedicated app/route configuration, cohesive controllers, advanced-filter aware remote query, conflict-aware editing composables, persistent named views, optional and persistent column resizing, random-access remote blocks, batched/domain APIs, optional Worker processing, an optional standard toolbar, optional Element Plus editors, async boundaries, in-place renderer refresh and automatic lifecycle cleanup. `RobotGrid` remains a deprecated 0.x alias.

## Install

```bash
pnpm add @agile-team/mach-table-vue
```

Import the stylesheet once from your application entry:

```ts
import "@agile-team/mach-table-vue/styles.css";
```

Optional large local-data Worker helpers use the same installed package but a separate chunk:

```ts
import { createWorkerDataProcessor } from "@agile-team/mach-table-vue/worker";
```

## Integration modes

### Local, route-level import

Best when only a few routes use a grid. A lazy-loaded route naturally keeps MachTable in that route's chunk.

```vue
<script setup lang="ts">
import { ref } from "vue";
import { MachTable, useMachTable, type ColDef } from "@agile-team/mach-table-vue";

interface Row { id: string; name: string }
const grid = useMachTable<Row>();
const rows = ref<Row[]>([{ id: "1", name: "MachTable" }]);
const columns: ColDef<Row>[] = [{ field: "name", headerName: "Name", flex: 1 }];
</script>

<template>
  <div style="height: 520px">
    <MachTable
      :ref="grid.ref"
      :row-data="rows"
      :column-defs="columns"
      row-key="id"
      state-key="customer-list"
      enable-column-resize
      striped-rows
    />
  </div>
</template>
```

### Global synchronous plugin

Best when most screens render tables. Components are available in every template without page-level runtime imports.

```ts
// main.ts
import { createApp } from "vue";
import { MachTablePlugin } from "@agile-team/mach-table-vue";
import "@agile-team/mach-table-vue/styles.css";
import App from "./App.vue";

createApp(App).use(MachTablePlugin).mount("#app");
```

### Global async plugin

Best for large admin or low-code applications. The plugin is registered at startup, while the component and Core stay in a separate chunk until the first `<MachTable>` is rendered.

```ts
// main.ts
import { createApp } from "vue";
import AsyncMachTablePlugin, { preloadMachTable } from "@agile-team/mach-table-vue/async";
import "@agile-team/mach-table-vue/styles.css";
import App from "./App.vue";

createApp(App).use(AsyncMachTablePlugin).mount("#app");

// Optional route-hover prefetch; dynamic imports are cached and idempotent.
void preloadMachTable();
```

The standard toolbar is a separate, tree-shakeable entry. Register it globally only when needed:

```ts
import MachTableUiPlugin from "@agile-team/mach-table-vue/ui";
app.use(MachTableUiPlugin);
```

After either global plugin is installed, pages can use `<MachTable>` directly. Keep conventions in a dedicated `mach-table.config.ts`, then install it with one clean line:

```ts
// mach-table.config.ts
import { defineMachTableConfig, defineMachTablePreset } from "@agile-team/mach-table-vue";
export default defineMachTableConfig({
  defaults: {
    size: "compact",
    enableColumnResize: true,
    pagination: { pageSize: 20, pageSizeOptions: [20, 50, 100] },
    defaultColDef: { sortable: true, resizable: true, filter: true }
  },
  defaultPreset: "list",
  presets: { list: defineMachTablePreset({ stripedRows: true }) }
});

// main.ts
app.use(MachTablePlugin, machTableConfig);
```

Layouts can reactively refine defaults and presets with `provideMachTableConfig(...)`; direct table props always win. `provideMachTableDefaults(...)` remains as a smaller compatibility API. The async plugin also accepts `asyncComponentOptions` with `loadingComponent`, `errorComponent`, `delay`, `timeout` and `onError`.

The adapter installs the matching `@agile-team/mach-table` core automatically and re-exports its complete API and types. Only `vue >= 3.2` remains a peer dependency supplied by the host application. Existing local imports remain fully supported.

Remote B-side lists can bind `useMachTableQuery()` directly. Use `mode: "auto"` for live filters or `mode: "manual"` for a submit-to-search form. For the smallest composable-only chunk, import query/editing/controller helpers from `@agile-team/mach-table-vue/workflows`. They own controlled server pagination, AbortSignal cancellation, stale-response protection, retry state and cross-page selection without exposing `gridApi` to ordinary pages.

`useMachTableController()` composes table readiness, query, editing, selection, errors and standard commands. Pair it with `MachTableToolbar` from `/ui`, or bind `controller.commands` to your own design-system toolbar.

Million-row batch actions use `selectionScope: "query"` and compact `allMatching + excludedKeys` rules, so clients never download every matching row ID.

`useMachTableEditing()` exposes reactive dirty changes, detailed partial-save results, validation failures, version conflicts, failed-row reveal, rollback and an optional unsaved-page guard. `lastSaveResult`, `saveIssues`, `failedRowIds` and `resolveConflict()` keep page code small while preserving explicit business decisions. Semantic business types and cached dictionaries are configured once with `createBusinessColumnTypes()` and `createCachedDictionary()`.

```ts
const editing = useMachTableEditing(grid, { guardBeforeUnload: true });
const result = await editing.saveDetailed(orderApi.saveChanges);
if (result.conflicts.length) editing.reveal(result.conflicts[0].rowId);

async function saveCurrentView() {
  if (!grid.api.value) return;
  const views = createGridViewManager(grid.api.value, {
    scope: `${tenantId}:${userId}:orders`
  });
  await views.save("My pending orders");
}
```

Remote query requests include both `filterModel` and the serializable nested `advancedFilterModel`. See the [advanced filter](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/recipes/advanced-filter.md), [named views](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/recipes/saved-views.md), and [batch save](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/recipes/batch-save.md) guides.

Element Plus editors are optional and registered once without making EP a package dependency:

```ts
import { createElementPlusEditors } from "@agile-team/mach-table-vue/editors";

const ep = createElementPlusEditors({
  input: ElInput,
  inputNumber: ElInputNumber,
  select: ElSelect,
  datePicker: ElDatePicker
});
```

Use `api.openColumnWorkbench()` for the built-in column settings UI. Lazy trees opt in with `isTreeRowExpandable` plus `loadTreeChildren`; ordinary tree data is unchanged.

## Cell and full-row editing

Core helpers are re-exported, so no second package import is needed:

```vue
<script setup lang="ts">
import { rowActionsColumn } from "@agile-team/mach-table-vue";

const columns = [
  { field: "name", editable: true },
  { field: "age", editable: true, cellEditor: "number" },
  rowActionsColumn({ onView, onDelete, overflow: "drawer" })
];
</script>

<template>
  <MachTable edit-type="fullRow" :column-defs="columns" :row-data="rows" />
</template>
```

Cell mode is the default and provides a pencil plus inline confirm/cancel controls. Set `editable-indicator="always"`, `"hover"` or `"none"` to control the affordance.

Documentation: [Vue guide](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/vue.md) · [Enterprise integration](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/enterprise-integration.md) · [Element Plus](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/element-plus.md) · [Naive UI](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/naive-ui.md)

Source-available © ChenyCHENYU (Agile Team). Any use requires prior written authorization. See the [license](https://github.com/ChenyCHENYU/MachTable/blob/main/LICENSE) and [authorization process](https://github.com/ChenyCHENYU/MachTable/blob/main/LICENSING.md).
