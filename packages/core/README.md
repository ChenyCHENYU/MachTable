<p align="center">
  <img src="https://raw.githubusercontent.com/ChenyCHENYU/MachTable/main/assets/mach-table-logo.svg" alt="MachTable" width="760" />
</p>

# @agile-team/mach-table

Enterprise-grade, framework-independent TypeScript data grid. Zero runtime dependencies, virtualized rows and columns, editing, selection, grouping, tree data, master-detail, infinite loading and composable extensions.

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
  getRowId: ({ data }) => data.id
});

// Required for native integrations when the host is removed.
api.destroy();
```

For framework applications use the official adapters:

- Vue 3: [`@agile-team/mach-table-vue`](https://www.npmjs.com/package/@agile-team/mach-table-vue)
- React 18+: [`@agile-team/mach-table-react`](https://www.npmjs.com/package/@agile-team/mach-table-react)

Documentation: [Quick start](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/getting-started.md) · [Enterprise integration](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/enterprise-integration.md) · [API](https://github.com/ChenyCHENYU/MachTable/tree/main/docs/api)

> Overlay strings render as text by default. Prefer HTMLElement factories for rich content; enable `allowUnsafeOverlayHtml` only for fully trusted static markup.

MIT © Agile Team
