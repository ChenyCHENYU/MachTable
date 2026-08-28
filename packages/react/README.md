<p align="center">
  <img src="https://raw.githubusercontent.com/ChenyCHENYU/MachTable/main/assets/mach-table-logo.svg" alt="MachTable" width="760" />
</p>

# @agile-team/mach-table-react

Official React 18+ adapter for MachTable. It provides `<MachTable>` / `<RobotGrid>`, `useMachGrid`, React cell/detail renderer factories, latest-closure event handling and StrictMode-safe cleanup.

```bash
pnpm add @agile-team/mach-table-react
```

```tsx
import { useMemo } from "react";
import { MachTable, useMachGrid, type ColDef } from "@agile-team/mach-table-react";
import "@agile-team/mach-table-react/styles.css";

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
        getRowId={({ data }) => data.id}
      />
    </div>
  );
}
```

The adapter installs the matching `@agile-team/mach-table` core automatically and re-exports its complete API and types. Only `react >= 18` and `react-dom >= 18` remain peer dependencies supplied by the host application.

Documentation: [React guide](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/react.md) · [Enterprise integration](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/enterprise-integration.md) · [Next.js / SSR](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/ssr.md)

MIT © Agile Team
