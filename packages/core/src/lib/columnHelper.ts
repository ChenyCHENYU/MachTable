import type { ColDef, ColDefGroup } from "../types/colDef";
import type { FieldPath, FieldPathValue } from "../types/path";

export type { FieldPath, FieldPathValue } from "../types/path";

export interface ColumnHelper<TData> {
  accessor<TPath extends FieldPath<TData>>(
    field: TPath,
    definition?: Omit<ColDef<TData, FieldPathValue<TData, TPath>>, "field">
  ): ColDef<TData, FieldPathValue<TData, TPath>>;
  display<TValue = unknown>(
    definition: Omit<ColDef<TData, TValue>, "field"> & Required<Pick<ColDef<TData, TValue>, "colId">>
  ): ColDef<TData, TValue>;
  group(definition: ColDefGroup<TData>): ColDefGroup<TData>;
}

/** Creates strongly typed column definitions without repeating TData/TValue. */
export function createColumnHelper<TData>(): ColumnHelper<TData> {
  return {
    accessor: (field, definition = {}) => ({ ...definition, field }),
    display: (definition) => ({ ...definition }),
    group: (definition) => ({ ...definition, children: [...definition.children] })
  };
}

/** Identity helper that retains literal types while checking GridOptions elsewhere. */
export function defineColumns<TData>(columns: readonly (ColDef<TData> | ColDefGroup<TData>)[]): (ColDef<TData> | ColDefGroup<TData>)[] {
  return [...columns];
}
