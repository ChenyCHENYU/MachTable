import type { ColDef } from "@agile-team/mach-table";
import * as core from "@agile-team/mach-table/business";
import * as vue from "@agile-team/mach-table-vue/business";
import * as react from "@agile-team/mach-table-react/business";
// @ts-expect-error Removed field services must not re-enter the grid API.
import { createDictionaryColumn as accidentalRootPolicy } from "@agile-team/mach-table";
void accidentalRootPolicy;
// @ts-expect-error Value services belong to applications rather than optional grid modules.
import { createDictionaryColumn as removedPolicy } from "@agile-team/mach-table/business";
void removedPolicy;

interface Row { id: string; code: string; amount: number; currency: string; unit: string }
const rows: Row[] = [{ id: "a", code: "A", amount: 12, currency: "CNY", unit: "t" }];
// Applications own value mapping; the grid receives only generic column callbacks.
const labels = new Map([["A", "Ready"]]);
export const column: ColDef<Row> = {
  field: "code",
  valueFormatter: ({ value }) => labels.get(value) ?? value,
  valueSerializer: ({ value, target }) => target === "xlsx" ? value : labels.get(value) ?? value
};
export const result: core.SemanticSummaryResult = core.summarizeRows(rows, {
  scope: "page", groupBy: row => JSON.stringify([row.currency, row.unit]),
  metrics: [{ id: "amount", kind: "sum", value: row => row.amount }, { id: "count", kind: "count" }]
});
export const vueResult: vue.SemanticSummaryResult = vue.summarizeRows(rows, { scope: "selected", metrics: [{ id: "count", kind: "count" }] });
export const reactResult: react.SemanticSummaryResult = react.summarizeRows(rows, { scope: "query", metrics: [{ id: "count", kind: "count" }] });
