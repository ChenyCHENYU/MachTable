import type { ImportContext } from "../lib/importContext";
import type { GridApi } from "../types/api";
import type { ImportPlanOptions, ImportSource } from "./types";
import { prepareMatrixImport, type PreparedImport } from "../lib/importData";
import { getByPath } from "../lib/path";
import { snapshotImportValue } from "./snapshot";

/** Snapshot only incoming records. Unmapped fields and nested paths survive without mutating the caller. */
export function prepareImport(api: GridApi, core: ImportContext, source: ImportSource<any>, options: ImportPlanOptions): PreparedImport {
  if (api.rows.isRemote()) throw new TypeError("Import plans require local records");
  if (options.mode !== "paste" && api.getOption("treeData")) throw new TypeError("Import plans require a flat-record model for replace/append");
  if (core.isEditing()) throw new TypeError("Finish active editing before importing");
  if (options.mode !== "paste" && api.editing.getDirtyRowIds().length) throw new TypeError("Save or roll back pending changes before loading records");
  const input = snapshotImportValue(source);
  const targets = options.mode === "paste" ? core.pasteRows(input.rows.length) : undefined;
  let matrix: readonly (readonly unknown[])[], records: readonly Record<string, any>[] | undefined;
  if (input.kind === "rows") {
    records = input.rows;
    const columns = options.columns ?? core.columns().filter(column => column.colDef.field).map(column => column.id);
    const lookup = new Map(core.columns().map(column => [column.id, column.colDef.field]));
    const fields = columns.map(id => lookup.get(id) ?? id);
    matrix = input.rows.map(record => fields.map(field => getByPath(record, field)));
    options = { ...options, columns, headerRowIndex: -1 };
  } else matrix = input.rows;
  const prepared = prepareMatrixImport(core, matrix, options, targets, true, records);
  if (!targets && prepared.rows.some(row => row.changes.some(change => change.column.colDef.valueGetter || change.column.colDef.valueSetter))) throw new TypeError("New records require ordinary field columns; custom getters/setters are ambiguous");
  return prepared;
}
