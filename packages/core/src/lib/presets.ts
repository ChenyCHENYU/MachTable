import type { GridOptions } from "../types/options";

function mergeOptions<TData>(base: GridOptions<TData>, next: Partial<GridOptions<TData>>): GridOptions<TData> {
  const merged: GridOptions<TData> = {
    ...base,
    ...next,
    features: next.features ?? base.features
  };
  if (base.defaultColDef || next.defaultColDef) {
    merged.defaultColDef = { ...base.defaultColDef, ...next.defaultColDef };
  }
  if (base.locale || next.locale) {
    merged.locale = { ...base.locale, ...next.locale };
  }
  if (base.components || next.components) {
    merged.components = {
      cellRenderers: { ...base.components?.cellRenderers, ...next.components?.cellRenderers },
      cellEditors: { ...base.components?.cellEditors, ...next.components?.cellEditors }
    };
  }
  return merged;
}

/** Merges reusable defaults left-to-right with nested defaults handled safely. */
export function createMachTablePreset<TData>(
  ...sources: readonly Partial<GridOptions<TData>>[]
): GridOptions<TData> {
  return sources.reduce<GridOptions<TData>>(mergeOptions, {});
}

/** Recommended defaults for editable enterprise back-office screens. */
export function createEnterprisePreset<TData>(
  overrides: Partial<GridOptions<TData>> = {}
): GridOptions<TData> {
  return createMachTablePreset<TData>({
    defaultColDef: { sortable: true, resizable: true, movable: true, filter: true },
    rowSelection: "multiple",
    columnMenu: true,
    contextMenu: true,
    enableRangeSelection: true,
    fillHandle: true,
    statusBar: true,
    stripedRows: true
  }, overrides);
}

/** Compile-time helper for reusable, typed grid option objects. */
export function defineGridOptions<TData>(options: GridOptions<TData>): GridOptions<TData> {
  return options;
}
