export interface RowNode<TData = any> {
  id: string;
  data: TData | null;
  rowIndex: number;
  selected: boolean;
  isDetail?: boolean;
  masterId?: string;
  isGroup?: boolean;
  groupLevel?: number;
  groupKey?: string;
  leafNodes?: RowNode<TData>[];
  aggValues?: Record<string, any>;
  /** Lazy tree request state. These fields are read-only from application code. */
  treeLoading?: boolean;
  treeChildrenLoaded?: boolean;
  treeLoadError?: unknown;
}
