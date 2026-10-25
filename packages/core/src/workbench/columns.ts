import type { ColDef, ColDefGroup } from "../types/colDef";

/** Preserve definition order without allocating a flattened copy of wide column trees. */
export function* leafColumns<TData>(definitions: readonly (ColDef<TData> | ColDefGroup<TData>)[]): Generator<ColDef<TData>> {
  for (const column of definitions) {
    if ("children" in column) yield* leafColumns(column.children);
    else yield column;
  }
}
