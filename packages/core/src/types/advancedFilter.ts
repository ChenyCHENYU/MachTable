import type { ColumnFilter } from "./colDef";

export interface AdvancedFilterCondition {
  kind: "condition";
  colId: string;
  filter: ColumnFilter;
}

export interface AdvancedFilterGroup {
  kind: "group";
  operator: "and" | "or";
  children: AdvancedFilterNode[];
  /** Negates the complete group without changing its children. */
  not?: boolean;
}

export type AdvancedFilterNode = AdvancedFilterCondition | AdvancedFilterGroup;

/** Serializable, backend-friendly nested filter expression. */
export interface AdvancedFilterModel {
  version: 1;
  root: AdvancedFilterNode;
}
