// Consume only this framework package: optional wrappers must carry both values
// and generic contracts without requiring application imports from Core.
import { type GridApi, type GridOptions, type RowDragPolicy, resolveSaveConflict } from "@agile-team/mach-table-react";
import {
  mountAdvancedFilterBuilder, mountChangeReview, mountDiagnostics, inspectGridRow,
  type AdvancedFilterBuilder, type FilterField, type WorkbenchHandle,
  type GridRowInspection, type GridRowDiagnosticCode, type GridExecutionMode
} from "@agile-team/mach-table-react/workbench";
import {
  createGridPreferenceStore, migrateGridState, GridPreferenceConflictError,
  type GridPreferenceIdentity, type GridPreferenceStore
} from "@agile-team/mach-table-react/preferences";
import {
  createRowOrderController, reorderRows, moveTreeNodes, RowOrderConflictError,
  type RowOrderController, type RowOrderIntent, type RowOrderOptions, type RowOrderSaveResult,
  type RowOrderSaveContext, type RowOrderOperation
} from "@agile-team/mach-table-react/ordering";
import {
  createServerSideStore, bindServerSideGrid, createServerSideGroupColumn, serverSideDataColumn,
  ServerSideVersionConflictError, type ServerSideProjection, type ServerSideStore
} from "@agile-team/mach-table-react/server-side";
import {
  evaluateFormulas, createPivot, mountAnalysis,
  type FormulaIssue, type PivotOptions, type PivotResult
} from "@agile-team/mach-table-react/analysis";
import { createMultiRangeSelection, type MultiRangeSelection } from "@agile-team/mach-table-react/multi-range";
import "@agile-team/mach-table-react/styles/workbench.css";
import "@agile-team/mach-table-react/styles/server-side.css";

interface Row { id: string; team: string; amount: number; children?: Row[] }
const identity: GridPreferenceIdentity = { tenantId: "tenant", userId: "user", pageId: "orders", schemaId: "v1" };
export const preferenceStore: GridPreferenceStore = createGridPreferenceStore({
  columns: ["team", "amount"], renameColumns: { total: "amount" },
  columnTypes: { team: "text", amount: "number", id: false }, identity: () => identity,
  load: request => ({ state: null, revision: request.identity.schemaId }),
  save: request => ({ revision: request.expectedRevision ?? "1" }),
  onMigration: result => result.report.forEach(issue => issue.code.toLowerCase())
});
export const preferenceConflict = new GridPreferenceConflictError(null, "server-v2");
export const orderConflict = new RowOrderConflictError("Changed", 2);
export const serverConflict = new ServerSideVersionConflictError("1", "2");
export const range: MultiRangeSelection = createMultiRangeSelection();
export const gridOptions: GridOptions<Row> = {
  rowKey: "id", enableRangeSelection: true, features: [range],
  columnDefs: [{ field: "amount", editable: true }],
  rowDragPolicy: { canDrop: ({ intent, targetNode }) => intent.targetId === targetNode?.id }
};
export const dragPolicy: RowDragPolicy<Row> | undefined = gridOptions.rowDragPolicy;
export const pivotOptions: PivotOptions = {
  rowFields: ["team"], columnFields: [], values: [{ field: "net", aggregate: "sum" }]
};
export const fields: FilterField[] = [{ colId: "amount", type: "number" }];

export function createOrdering(): RowOrderController<Row> {
  let rows: readonly Row[] = [{ id: "a", team: "A", amount: 1 }, { id: "b", team: "A", amount: 2 }];
  const intent: RowOrderIntent = { rowIds: ["a"], targetId: "b", position: "after", expectedRevision: 1 };
  const options: RowOrderOptions<Row> = {
    rowKey: row => row.id, childrenKey: "children", canMove: ({ row, target }) => row.team === target.team
  };
  reorderRows(rows, intent, options).after.forEach(row => row.amount.toFixed(2));
  moveTreeNodes(rows, intent, options).rowIds.forEach(id => id.toUpperCase());
  return createRowOrderController({
    ...options, getRows: () => rows, applyRows: next => { rows = next; }, getRevision: () => 1,
    save: async (_intent, context: RowOrderSaveContext<Row>): Promise<RowOrderSaveResult> => {
      const operation: RowOrderOperation = context.operation;
      context.operations.forEach(intent => intent.rowIds.forEach(id => id.toUpperCase()));
      if (operation === "undo") context.signal.throwIfAborted();
      context.plan.after.forEach(row => row.amount.toFixed(2));
      return { status: "saved", revision: 2 };
    }
  });
}

export function orderingOptions(controller: RowOrderController<Row>): GridOptions<Row> {
  return { ...controller.bindings, columnDefs: [{ field: "amount", editable: true }] };
}

export async function exerciseHistory(controller: RowOrderController<Row>): Promise<void> {
  if (controller.state.canUndo) (await controller.undo()).after.forEach(row => row.amount.toFixed());
  if (controller.state.canRedo) (await controller.redo()).after.forEach(row => row.amount.toFixed());
}

export function mountOptional(api: GridApi<Row>, host: HTMLElement): () => void {
  const filter: AdvancedFilterBuilder = mountAdvancedFilterBuilder(host, { api, fields });
  filter.setDraft({ version: 1, root: { kind: "condition", colId: "amount", filter: { type: "number", conditions: [{ match: "greaterThan", value: 0 }] } } });
  const review: WorkbenchHandle = mountChangeReview(host, {
    api, save: async changes => ({ savedRowIds: changes.filter(change => change.data.amount >= 0).map(change => change.rowId) })
  });
  const diagnostics = mountDiagnostics(host, { api });
  const inspection: GridRowInspection = inspectGridRow(api, "a");
  const sorting: GridExecutionMode | undefined = inspection.execution?.sorting;
  sorting?.toUpperCase();
  inspection.drag.reasons.forEach(reason => {
    const code: GridRowDiagnosticCode = reason.code;
    code.toLowerCase();
  });
  const analysis = mountAnalysis(host, { api, pivot: pivotOptions, formulas: { net: "[amount] * 0.9" } });
  const calculated = evaluateFormulas([{ id: "a", team: "A", amount: 10 }], { net: "[amount] * 0.9" });
  const issues: FormulaIssue[] = calculated.errors;
  const pivot: PivotResult = createPivot(calculated.rows, pivotOptions);
  pivot.rows.forEach(row => row.dimensions.forEach(String));
  issues.forEach(issue => issue.code.toLowerCase());
  migrateGridState(api.state.get(), { columns: ["team", "amount"], columnTypes: { amount: "number" } })
    .report.forEach(issue => { if (issue.code === "TYPE_CHANGED") issue.to?.toLowerCase(); });
  resolveSaveConflict(api, { rowId: "a", message: "Changed on server", serverData: { id: "a", team: "A", amount: 10 } }, "keepLocal");
  range.setRanges([{ row1: 0, row2: 1, colId1: "team", colId2: "amount" }]);
  range.getText().toUpperCase();
  return () => { filter.destroy(); review.destroy(); diagnostics.destroy(); analysis.destroy(); range.clear(); };
}

export function bindServer(api: GridApi<ServerSideProjection<Row>>): () => void {
  const store: ServerSideStore<Row> = createServerSideStore({
    blockSize: 20, query: { rowGroupCols: [{ colId: "team" }], valueCols: [{ colId: "amount", aggFunc: "sum" }] },
    getRows: async request => ({
      rows: [{ id: String(request.startRow), data: { id: "a", team: "A", amount: 1 } }], rowCount: 1, revision: "1"
    }),
    transact: async transaction => ({ revision: transaction.expectedRevision + "1" })
  });
  createServerSideGroupColumn(store, { label: row => row.data.team });
  serverSideDataColumn<Row>("amount", { headerName: "Amount" });
  // @ts-expect-error Field paths stay checked through the optional wrapper.
  serverSideDataColumn<Row>("missingField");
  return bindServerSideGrid(api, store);
}
