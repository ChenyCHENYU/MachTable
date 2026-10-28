import type { ColDef } from "@agile-team/mach-table";
import * as core from "@agile-team/mach-table/business";
import * as vue from "@agile-team/mach-table-vue/business";
import * as react from "@agile-team/mach-table-react/business";
// @ts-expect-error Optional policies are intentionally absent from the existing root API.
import { createDictionaryColumn as accidentalRootPolicy } from "@agile-team/mach-table";
void accidentalRootPolicy;

interface Row { id: string; code: string; amount: number; currency: string; unit: string }
const rows: Row[] = [{ id: "a", code: "A", amount: 12, currency: "CNY", unit: "t" }];
const source: core.DictionaryColumnSource<string> = { get: key => key === "A" ? "Ready" : undefined };
export const column: ColDef<Row> = { field: "code", ...core.createDictionaryColumn<Row, string>(source, {
  options: [{ value: "A", label: "Ready" }], display: "label", output: { xlsx: "code", csv: "code-label" }
}) };
export const result: core.SemanticSummaryResult = core.summarizeRows(rows, {
  scope: "page", groupBy: row => JSON.stringify([row.currency, row.unit]),
  metrics: [{ id: "amount", kind: "sum", value: row => row.amount }, { id: "count", kind: "count" }]
});
export const vueColumn = vue.createDictionaryColumn<Row, string>(source);
export const reactColumn = react.createDictionaryColumn<Row, string>(source);
export const vueResult: vue.SemanticSummaryResult = vue.summarizeRows(rows, { scope: "selected", metrics: [{ id: "count", kind: "count" }] });
export const reactResult: react.SemanticSummaryResult = react.summarizeRows(rows, { scope: "query", metrics: [{ id: "count", kind: "count" }] });
