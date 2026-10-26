import type { AdvancedFilterModel, AdvancedFilterNode } from "../types/advancedFilter";
import type { FilterModel, SortModel } from "../types/colDef";
import type { Column } from "../services/column";
import type { RowNode } from "../types/row";
import { getByPath } from "./path";

function advancedColumns(model: AdvancedFilterModel | null, ids: Set<string>): void {
  const pending: AdvancedFilterNode[] = model ? [model.root] : [];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.kind === "condition") ids.add(node.colId);
    else for (const child of node.children) pending.push(child);
  }
}

interface ProjectionInput {
  columns: readonly Column[];
  sortModel: SortModel;
  filterModel: FilterModel;
  advancedFilter: AdvancedFilterModel | null;
  quickFilter: string | null;
  customAggregates?: Readonly<Record<string, unknown>>;
}

/** Only declared, primitive field dependencies are safe to reuse without invoking application code. */
export function projectionFields(input: ProjectionInput): string[] | null {
  const ids = new Set(Object.keys(input.filterModel));
  advancedColumns(input.advancedFilter, ids);
  const sorting = new Set(input.sortModel.map((item) => item.colId));
  for (const id of sorting) ids.add(id);
  const grouping = input.columns.some((column) => column.colDef.rowGroup === true);
  const searching = Boolean(input.quickFilter?.trim());
  const dependent = input.columns.filter((column) => ids.has(column.id) || searching || column.colDef.rowGroup === true
    || (grouping && column.colDef.aggFunc != null));
  const fields = new Set<string>();
  for (const column of dependent) {
    const def = column.colDef;
    if (grouping && def.rowGroup !== true && def.aggFunc != null && input.customAggregates?.[def.aggFunc]) return null;
    if (def.valueGetter || (sorting.has(column.id) && def.comparator) || !def.field) return null;
    fields.add(def.field);
  }
  return [...fields];
}

function opaque(value: unknown): boolean {
  return value != null && (typeof value === "object" || typeof value === "function");
}

export function captureProjectionValues<T>(rows: readonly RowNode<T>[], fields: readonly string[]): WeakMap<RowNode<T>, readonly unknown[]> {
  const values = new WeakMap<RowNode<T>, readonly unknown[]>();
  for (const node of rows) {
    if (node.data == null) continue;
    const projected = fields.map((field) => getByPath(node.data, field));
    if (!projected.some(opaque)) values.set(node, projected);
  }
  return values;
}

export function projectionFieldsChanged(before: unknown, after: unknown, fields: readonly string[], projected: readonly unknown[] | undefined): boolean {
  if (!fields.length) return false;
  if (!projected || before === after || before == null || after == null) return true;
  return fields.some((field, index) => {
    const current = getByPath(after, field);
    return opaque(current) || !Object.is(projected[index], current);
  });
}
