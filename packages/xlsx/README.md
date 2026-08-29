# @agile-team/mach-table-xlsx

Optional XLSX import/export for MachTable. The workbook engine is injected and can be dynamically imported, so normal table pages do not download Excel code.

```bash
pnpm add @agile-team/mach-table-xlsx xlsx
```

```ts
import { createXlsxExtension } from "@agile-team/mach-table-xlsx";

const xlsx = createXlsxExtension(() => import("xlsx"));
await xlsx.export(api, { fileName: "orders.xlsx", sheetName: "Orders" });

await xlsx.import(api, await file.arrayBuffer(), {
  sheet: 0,
  mode: "replace",
  coerceNumbers: true
});
```

The extension reuses Core CSV selection, header, formula-protection and safe import rules. `xlsx` is an example engine, not a bundled dependency; an approved compatible engine can be injected instead.

Documentation: [XLSX guide](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/recipes/xlsx.md) · [Enterprise integration](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/enterprise-integration.md)

Source-available © ChenyCHENYU (Agile Team). Any use requires prior written authorization. See the [license](https://github.com/ChenyCHENYU/MachTable/blob/main/LICENSE) and [authorization process](https://github.com/ChenyCHENYU/MachTable/blob/main/LICENSING.md).
