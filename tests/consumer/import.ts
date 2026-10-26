import type { ColDef, GridApi, ImportMatrixOptions, ValueParserParams, ValueSerializerParams } from "@agile-team/mach-table";
import { createImportPlan, type ImportPlan, type ImportPreview, type ImportResult } from "@agile-team/mach-table/import";
import { createImportPlan as vueImport, type ImportPlan as VueImportPlan } from "@agile-team/mach-table-vue/import";
import { createImportPlan as reactImport, type ImportPlan as ReactImportPlan } from "@agile-team/mach-table-react/import";

interface Row { id: string; amount: number }
export const column: ColDef<Row> = {
  field: "amount", editable: true,
  valueParser: (params: ValueParserParams<Row>) => Number(params.value) + (params.data?.amount ?? 0),
  valueSerializer: (params: ValueSerializerParams<Row>) => params.target === "xlsx" ? params.value : String(params.value)
};
export const matrixOptions: ImportMatrixOptions = { mode: "append", columns: ["id", "amount"], headerRowIndex: -1 };
export function plan(api: GridApi<Row>): ImportPlan {
  api.io.importMatrix([["a", 1]], matrixOptions);
  const matrix: unknown[][] = api.io.exportMatrix({ target: "xlsx" });
  return createImportPlan(api, { kind: "matrix", rows: matrix }, { mode: "replace" });
}
export const vuePlan: (api: GridApi<Row>) => VueImportPlan = api => vueImport(api, { kind: "rows", rows: [{ id: "a", amount: 1 }] });
export const reactPlan: (api: GridApi<Row>) => ReactImportPlan = api => reactImport(api, { kind: "rows", rows: [{ id: "a", amount: 1 }] });
export async function previewAndApply(plan: ImportPlan): Promise<ImportResult | ImportPreview> {
  const preview = await plan.preview();
  preview.cells.forEach(cell => cell.colId.toUpperCase());
  return preview.status === "ready" ? plan.commit() : preview;
}
