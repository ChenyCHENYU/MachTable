import { defaultComparator } from "../lib/compare";
import type { SortModel } from "../types/colDef";
import type { RowNode } from "../types/row";
import type { Column } from "./column";

export function sortNodes<TData>(
  nodes: RowNode<TData>[],
  sortModel: SortModel,
  columns: Column[],
  getCellValue: (node: RowNode<TData>, column: Column) => any
): RowNode<TData>[] {
  const colById = new Map<string, Column>();
  for (const c of columns) colById.set(c.id, c);

  const comparators: ((a: any, b: any, na: RowNode<TData>, nb: RowNode<TData>) => number)[] = [];
  const directions: ("asc" | "desc")[] = [];
  for (const item of sortModel) {
    const column = colById.get(item.colId);
    if (!column) continue;
    comparators.push(column.colDef.comparator ?? defaultComparator);
    directions.push(item.direction);
  }

  const decorated = nodes.map((node) => ({
    node,
    values: sortModel.map((s) => getCellValue(node, colById.get(s.colId)!))
  }));

  decorated.sort((a, b) => {
    for (let i = 0; i < comparators.length; i++) {
      const r = comparators[i](a.values[i], b.values[i], a.node, b.node);
      if (r !== 0) return directions[i] === "asc" ? r : -r;
    }
    return 0;
  });

  return decorated.map((d) => d.node);
}
