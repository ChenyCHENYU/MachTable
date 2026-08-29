import { createXlsxExtension, type XlsxEngine } from "@agile-team/mach-table-xlsx";
import type { GridApi } from "@agile-team/mach-table";

declare const engine: XlsxEngine;
declare const api: GridApi<{ id: string }>;

const extension = createXlsxExtension(engine);
void extension.export(api, { fileName: "rows.xlsx", onlySelected: true });
