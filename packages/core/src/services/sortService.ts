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
  const byId = new Map(columns.map((column) => [column.id, column]));
  // Keep the resolved column and comparator together: obsolete column IDs must
  // not shift the value slots of the remaining multi-sort clauses.
  const clauses = sortModel.flatMap((item) => {
    const column = byId.get(item.colId);
    return column ? [{ column, compare: column.colDef.comparator ?? defaultComparator, direction: item.direction }] : [];
  });
  const decorated = nodes.map((node) => ({
    node,
    values: clauses.map(({ column }) => getCellValue(node, column))
  }));

  decorated.sort((a, b) => {
    for (let i = 0; i < clauses.length; i++) {
      const clause = clauses[i];
      const compared = clause.compare(a.values[i], b.values[i], a.node, b.node);
      if (compared !== 0) return clause.direction === "asc" ? compared : -compared;
    }
    return 0;
  });

  return decorated.map(({ node }) => node);
}
