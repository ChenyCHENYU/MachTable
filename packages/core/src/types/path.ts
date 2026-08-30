type Callable = (...args: never[]) => unknown;
type Primitive = string | number | boolean | bigint | symbol | null | undefined | Date | Callable;
type Depth = 0 | 1 | 2 | 3 | 4;
type Previous = { 0: 0; 1: 0; 2: 1; 3: 2; 4: 3 };

/** Dot-separated path to a serializable field, capped to keep editor inference fast. */
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
