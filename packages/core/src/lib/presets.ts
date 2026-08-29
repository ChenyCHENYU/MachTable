import type { GridOptions } from "../types/options";

function mergeSwitchableObject<T extends object>(
  base: boolean | T | undefined,
  next: boolean | T | undefined
): boolean | T | undefined {
  if (next === undefined) return base;
  if (typeof next !== "object" || next === null || typeof base !== "object" || base === null) return next;
  return { ...base, ...next };
}

function composeHandlers(base: unknown, next: unknown): unknown {
  if (typeof base !== "function") return next;
  if (typeof next !== "function") return base;
  return (...args: unknown[]) => {
    let firstError: unknown;
    try {
      base(...args);
    } catch (error) {
      firstError = error;
    }
    try {
      next(...args);
    } catch (error) {
      firstError ??= error;
    }
    if (firstError !== undefined) throw firstError;
  };
}

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
  if (base.columnTypes || next.columnTypes) {
    const columnTypes: Record<string, Record<string, unknown>> = {};
    for (const name of new Set([...Object.keys(base.columnTypes ?? {}), ...Object.keys(next.columnTypes ?? {})])) {
      columnTypes[name] = {
        ...(base.columnTypes?.[name] as Record<string, unknown> | undefined),
        ...(next.columnTypes?.[name] as Record<string, unknown> | undefined)
      };
    }
    merged.columnTypes = columnTypes;
  }
  if (base.aggFuncs || next.aggFuncs) {
    merged.aggFuncs = { ...base.aggFuncs, ...next.aggFuncs };
  }
  merged.pagination = mergeSwitchableObject(base.pagination, next.pagination);
  merged.statusBar = mergeSwitchableObject(base.statusBar, next.statusBar);
  merged.watermark = mergeSwitchableObject(base.watermark, next.watermark);

  for (const key of new Set([...Object.keys(base), ...Object.keys(next)])) {
    if (!/^on[A-Z]/.test(key)) continue;
    const previousHandler = (base as Record<string, unknown>)[key];
    const nextHandler = (next as Record<string, unknown>)[key];
    if (typeof previousHandler === "function" && typeof nextHandler === "function") {
      (merged as Record<string, unknown>)[key] = composeHandlers(previousHandler, nextHandler);
    }
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

/** Compile-time helper for a reusable partial preset. */
export function defineMachTablePreset<TData>(
  preset: Partial<GridOptions<TData>>
): Partial<GridOptions<TData>> {
  return preset;
}

/** Compile-time helper for reusable, typed grid option objects. */
export function defineGridOptions<TData>(options: GridOptions<TData>): GridOptions<TData> {
  return options;
}
