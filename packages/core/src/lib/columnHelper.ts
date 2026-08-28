import type { ColDef, ColDefGroup } from "../types/colDef";

type Callable = (...args: never[]) => unknown;
type Primitive = string | number | boolean | bigint | symbol | null | undefined | Date | Callable;
type Depth = 0 | 1 | 2 | 3 | 4;
type Previous = { 0: 0; 1: 0; 2: 1; 3: 2; 4: 3 };

export type FieldPath<T, D extends Depth = 4> = D extends 0
  ? never
  : T extends Primitive
    ? never
    : {
        [K in keyof T & string]: NonNullable<T[K]> extends Primitive | readonly unknown[]
          ? K
          : K | `${K}.${FieldPath<NonNullable<T[K]>, Previous[D]>}`;
      }[keyof T & string];

export type FieldPathValue<T, P extends string> = P extends keyof T
  ? T[P]
  : P extends `${infer Head}.${infer Tail}`
    ? Head extends keyof T
      ? FieldPathValue<NonNullable<T[Head]>, Tail>
      : unknown
    : unknown;

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
    accessor: (field, definition = {}) => ({ ...definition, field }) as never,
    display: (definition) => ({ ...definition }),
    group: (definition) => ({ ...definition, children: [...definition.children] })
  };
}

/** Identity helper that retains literal types while checking GridOptions elsewhere. */
export function defineColumns<TData>(columns: readonly (ColDef<TData> | ColDefGroup<TData>)[]): (ColDef<TData> | ColDefGroup<TData>)[] {
  return [...columns];
}
