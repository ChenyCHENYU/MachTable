/** Persist relative business IDs instead of viewport indexes or fractional ranks. */
export interface RowOrderIntent {
  rowIds: readonly string[];
  targetId: string;
  position: "before" | "after" | "inside";
  expectedRevision?: string | number;
  beforeId?: string | null;
  afterId?: string | null;
}

export interface RowOrderConstraint<TData> {
  row: TData;
  previousParent: TData | null;
  parent: TData | null;
  target: TData;
  intent: RowOrderIntent;
}

export interface RowOrderOptions<TData> {
  rowKey: string | ((row: TData) => string | number);
  /** Direct child-array property. Defaults to `children` for tree operations. */
  childrenKey?: keyof TData & string;
  /** Return a reason to make an invalid destination explainable to the user. */
  canMove?(context: RowOrderConstraint<TData>): boolean | string;
}

export interface RowOrderPlan<TData> {
  before: readonly TData[];
  after: readonly TData[];
  intent: RowOrderIntent;
  /** Selected descendants travel with their selected ancestor exactly once. */
  rowIds: readonly string[];
  changed: boolean;
}
