// NodeNext CJS must resolve the independently emitted .d.cts wrappers as well.
import type { GridApi as CoreGridApi } from "@agile-team/mach-table";
import type { GridApi as VueGridApi } from "@agile-team/mach-table-vue";
import type { GridApi as ReactGridApi } from "@agile-team/mach-table-react";
import coreWorkbench = require("@agile-team/mach-table/workbench");
import corePreferences = require("@agile-team/mach-table/preferences");
import coreOrdering = require("@agile-team/mach-table/ordering");
import coreServerSide = require("@agile-team/mach-table/server-side");
import coreAnalysis = require("@agile-team/mach-table/analysis");
import coreMultiRange = require("@agile-team/mach-table/multi-range");
import vueWorkbench = require("@agile-team/mach-table-vue/workbench");
import vuePreferences = require("@agile-team/mach-table-vue/preferences");
import vueOrdering = require("@agile-team/mach-table-vue/ordering");
import vueServerSide = require("@agile-team/mach-table-vue/server-side");
import vueAnalysis = require("@agile-team/mach-table-vue/analysis");
import vueMultiRange = require("@agile-team/mach-table-vue/multi-range");
import reactWorkbench = require("@agile-team/mach-table-react/workbench");
import reactPreferences = require("@agile-team/mach-table-react/preferences");
import reactOrdering = require("@agile-team/mach-table-react/ordering");
import reactServerSide = require("@agile-team/mach-table-react/server-side");
import reactAnalysis = require("@agile-team/mach-table-react/analysis");
import reactMultiRange = require("@agile-team/mach-table-react/multi-range");

interface Row { id: string; amount: number }
export const coreFeature: coreMultiRange.MultiRangeSelection = coreMultiRange.createMultiRangeSelection();
export const coreCalculated = coreAnalysis.evaluateFormulas<Row>([{ id: "a", amount: 2 }], { total: "amount * 2" });
export const corePivot: coreAnalysis.PivotResult = coreAnalysis.createPivot(coreCalculated.rows, {
  rowFields: ["id"], values: [{ field: "total", aggregate: "sum" }]
});
// Exported helpers name public contracts instead of inferred shared declaration chunks.
export const coreInspector: (api: CoreGridApi<Row>, rowId: string) => coreWorkbench.GridRowInspection = coreWorkbench.inspectGridRow<Row>;
export const coreMounts = [coreWorkbench.mountAdvancedFilterBuilder<Row>, coreWorkbench.mountChangeReview<Row>, coreWorkbench.mountDiagnostics<Row>];
export const corePreference: corePreferences.GridPreferenceStore = corePreferences.createGridPreferenceStore({
  columns: ["amount"], columnTypes: { amount: "number" }, identity: () => ({ tenantId: "t", userId: "u", pageId: "p", schemaId: "v1" }),
  load: () => null, save: () => ({ revision: "1" })
});
export const coreOrder: coreOrdering.RowOrderController<Row> = coreOrdering.createRowOrderController({
  rowKey: "id", getRows: () => [{ id: "a", amount: 1 }], applyRows: rows => rows.forEach(row => row.amount.toFixed())
});
export const coreServer: coreServerSide.ServerSideStore<Row> = coreServerSide.createServerSideStore({
  getRows: async () => ({ rows: [{ id: "a", data: { id: "a", amount: 1 } }], revision: "1", rowCount: 1 })
});
export const vueFeature: vueMultiRange.MultiRangeSelection = vueMultiRange.createMultiRangeSelection();
export const vueCalculated = vueAnalysis.evaluateFormulas<Row>([{ id: "a", amount: 2 }], { total: "amount * 2" });
export const vuePivot: vueAnalysis.PivotResult = vueAnalysis.createPivot(vueCalculated.rows, {
  rowFields: ["id"], values: [{ field: "total", aggregate: "sum" }]
});
// Exported helpers name public contracts instead of inferred shared declaration chunks.
export const vueInspector: (api: VueGridApi<Row>, rowId: string) => vueWorkbench.GridRowInspection = vueWorkbench.inspectGridRow<Row>;
export const vueMounts = [vueWorkbench.mountAdvancedFilterBuilder<Row>, vueWorkbench.mountChangeReview<Row>, vueWorkbench.mountDiagnostics<Row>];
export const vuePreference: vuePreferences.GridPreferenceStore = vuePreferences.createGridPreferenceStore({
  columns: ["amount"], columnTypes: { amount: "number" }, identity: () => ({ tenantId: "t", userId: "u", pageId: "p", schemaId: "v1" }),
  load: () => null, save: () => ({ revision: "1" })
});
export const vueOrder: vueOrdering.RowOrderController<Row> = vueOrdering.createRowOrderController({
  rowKey: "id", getRows: () => [{ id: "a", amount: 1 }], applyRows: rows => rows.forEach(row => row.amount.toFixed())
});
export const vueServer: vueServerSide.ServerSideStore<Row> = vueServerSide.createServerSideStore({
  getRows: async () => ({ rows: [{ id: "a", data: { id: "a", amount: 1 } }], revision: "1", rowCount: 1 })
});
export const reactFeature: reactMultiRange.MultiRangeSelection = reactMultiRange.createMultiRangeSelection();
export const reactCalculated = reactAnalysis.evaluateFormulas<Row>([{ id: "a", amount: 2 }], { total: "amount * 2" });
export const reactPivot: reactAnalysis.PivotResult = reactAnalysis.createPivot(reactCalculated.rows, {
  rowFields: ["id"], values: [{ field: "total", aggregate: "sum" }]
});
// Exported helpers name public contracts instead of inferred shared declaration chunks.
export const reactInspector: (api: ReactGridApi<Row>, rowId: string) => reactWorkbench.GridRowInspection = reactWorkbench.inspectGridRow<Row>;
export const reactMounts = [reactWorkbench.mountAdvancedFilterBuilder<Row>, reactWorkbench.mountChangeReview<Row>, reactWorkbench.mountDiagnostics<Row>];
export const reactPreference: reactPreferences.GridPreferenceStore = reactPreferences.createGridPreferenceStore({
  columns: ["amount"], columnTypes: { amount: "number" }, identity: () => ({ tenantId: "t", userId: "u", pageId: "p", schemaId: "v1" }),
  load: () => null, save: () => ({ revision: "1" })
});
export const reactOrder: reactOrdering.RowOrderController<Row> = reactOrdering.createRowOrderController({
  rowKey: "id", getRows: () => [{ id: "a", amount: 1 }], applyRows: rows => rows.forEach(row => row.amount.toFixed())
});
export const reactServer: reactServerSide.ServerSideStore<Row> = reactServerSide.createServerSideStore({
  getRows: async () => ({ rows: [{ id: "a", data: { id: "a", amount: 1 } }], revision: "1", rowCount: 1 })
});
export async function coreHistory(controller: coreOrdering.RowOrderController<Row>): Promise<void> {
  if (controller.state.canUndo) await controller.undo();
  if (controller.state.canRedo) await controller.redo();
}
export function coreSaveContext(context: coreOrdering.RowOrderSaveContext<Row>): coreOrdering.RowOrderOperation {
  context.operations.forEach(intent => intent.rowIds.forEach(id => id.toUpperCase()));
  return context.operation;
}
export async function vueHistory(controller: vueOrdering.RowOrderController<Row>): Promise<void> {
  if (controller.state.canUndo) await controller.undo();
  if (controller.state.canRedo) await controller.redo();
}
export function vueSaveContext(context: vueOrdering.RowOrderSaveContext<Row>): vueOrdering.RowOrderOperation {
  context.operations.forEach(intent => intent.rowIds.forEach(id => id.toUpperCase()));
  return context.operation;
}
export async function reactHistory(controller: reactOrdering.RowOrderController<Row>): Promise<void> {
  if (controller.state.canUndo) await controller.undo();
  if (controller.state.canRedo) await controller.redo();
}
export function reactSaveContext(context: reactOrdering.RowOrderSaveContext<Row>): reactOrdering.RowOrderOperation {
  context.operations.forEach(intent => intent.rowIds.forEach(id => id.toUpperCase()));
  return context.operation;
}
