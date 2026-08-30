import type {
  CellClassParams,
  CellEditorParams,
  CellRendererParams,
  EditableParams,
  HeaderComponentParams,
  ICellEditor,
  ICellRendererResult,
  ValueFormatterParams,
  ValueGetterParams,
  ValueSetterParams
} from "./params";
import type { CellClickEvent, CellDoubleClickEvent } from "./events";
import type { RowNode } from "./row";

export type SortDirection = "asc" | "desc";
export type PinnedDirection = "left" | "right";
export type FilterType = "text" | "number" | "date" | "set";
export type CellAlign = "left" | "center" | "right";

export type TextFilterMatch =
  | "contains"
  | "notContains"
  | "equals"
  | "notEquals"
  | "startsWith"
  | "endsWith"
  | "blank"
  | "notBlank";

export type NumberFilterMatch =
  | "equals"
  | "notEquals"
  | "lessThan"
  | "lessThanOrEqual"
  | "greaterThan"
  | "greaterThanOrEqual"
  | "inRange"
  | "blank"
  | "notBlank";

export type DateFilterMatch =
  | "equals"
  | "notEquals"
  | "lessThan"
  | "greaterThan"
  | "inRange"
  | "blank"
  | "notBlank";

export interface TextFilterCondition {
  match: TextFilterMatch;
  value?: string;
}

export interface NumberFilterCondition {
  match: NumberFilterMatch;
  value?: number;
  value2?: number;
}

export interface DateFilterCondition {
  match: DateFilterMatch;
  value?: string;
  value2?: string;
}

export interface SetFilterCondition {
  values: (string | number | null)[];
}

export interface TextColumnFilter {
  type: "text";
  operator?: "and" | "or";
  conditions: TextFilterCondition[];
}

export interface NumberColumnFilter {
  type: "number";
  operator?: "and" | "or";
  conditions: NumberFilterCondition[];
}

export interface DateColumnFilter {
  type: "date";
  operator?: "and" | "or";
  conditions: DateFilterCondition[];
}

export interface SetColumnFilter {
  type: "set";
  values: (string | number | null)[];
}

export type ColumnFilter = TextColumnFilter | NumberColumnFilter | DateColumnFilter | SetColumnFilter;
export type FilterModel = Record<string, ColumnFilter>;

export interface SortModelItem {
  colId: string;
  direction: SortDirection;
}
export type SortModel = SortModelItem[];

export interface SelectEditorParams {
  values: (string | number)[];
}

export interface SetFilterParams {
  values?: (string | number | null)[];
  maxValues?: number;
}

export type CellEditorFactory = (params: CellEditorParams) => ICellEditor;

export type CellRendererFn = (params: CellRendererParams) => string | HTMLElement | ICellRendererResult | null | undefined;

export type CellClassRule = string | string[] | ((params: CellClassParams) => string | string[] | null | undefined);

export type CellStyleRule = Partial<CSSStyleDeclaration> | ((params: CellClassParams<any, any>) => Partial<CSSStyleDeclaration> | null | undefined);

export interface ColDef<TData = any, TValue = any> {
  colId?: string;
  field?: string;
  headerName?: string;
  align?: CellAlign;
  headerAlign?: CellAlign;
  headerClass?: string | string[];
  headerTooltip?: string;
  headerComponent?: (params: HeaderComponentParams<TData>) => string | HTMLElement | ICellRendererResult | null | undefined;
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  flex?: number;
  /** Excludes the column from `columnLayout: "fit"` scaling. */
  suppressSizeToFit?: boolean;
  hide?: boolean;
  pinned?: PinnedDirection | boolean;
  sortable?: boolean;
  resizable?: boolean;
  movable?: boolean;
  filter?: boolean | FilterType;
  filterParams?: SetFilterParams;
  editable?: boolean | ((params: EditableParams<TData, TValue>) => boolean);
  cellEditor?: "text" | "number" | "date" | "select" | CellEditorFactory | string;
  cellEditorParams?: SelectEditorParams;
  wrapText?: boolean;
  checkboxSelection?: boolean;
  rowGroup?: boolean;
  aggFunc?: string;
  cellStyle?: CellStyleRule;
  selectable?: (params: CellClassParams<TData, TValue>) => boolean;
  singleClickEdit?: boolean;
  tooltipValueGetter?: (params: ValueFormatterParams<TData, TValue>) => string | null | undefined;
  rowSpan?: (params: CellClassParams<TData, TValue>) => number;
  autoRowSpan?: boolean;
  colSpan?: (params: CellClassParams<TData, TValue>) => number;
  autoHeight?: boolean;
  validate?: (
    newValue: TValue,
    params: ValueSetterParams<TData, TValue>
  ) => string | true | null | undefined | Promise<string | true | null | undefined>;
  rowDrag?: boolean;
  valueGetter?: (params: ValueGetterParams<TData, TValue>) => TValue;
  valueSetter?: (params: ValueSetterParams<TData, TValue>) => boolean;
  valueFormatter?: (params: ValueFormatterParams<TData, TValue>) => any;
  cellRenderer?: CellRendererFn | string;
  cellRendererParams?: Record<string, any>;
  cellClass?: CellClassRule;
  comparator?: (valueA: any, valueB: any, nodeA: RowNode<TData>, nodeB: RowNode<TData>) => number;
  /** Named column type(s), resolved left-to-right before this column definition. */
  type?: string | readonly string[];
  initialSort?: SortDirection;
  onCellClick?: (event: CellClickEvent<TData, TValue>) => void;
  onCellDoubleClick?: (event: CellDoubleClickEvent<TData, TValue>) => void;
}

export interface ColDefGroup<TData = any> {
  groupId?: string;
  headerName?: string;
  headerClass?: string | string[];
  children: (ColDefGroup<TData> | ColDef<TData>)[];
}

export type ColDefOrGroup<TData = any> = ColDefGroup<TData> | ColDef<TData>;

export function isColDefGroup<TData = any>(def: ColDefOrGroup<TData>): def is ColDefGroup<TData> {
  return Array.isArray((def as ColDefGroup<TData>).children);
}

export interface ColumnState {
  colId: string;
  hide?: boolean;
  width?: number;
  /** Active flex weight. A resize clears flex and turns width into a manual override. */
  flex?: number | null;
  /** Distinguishes responsive/definition width from an explicit user or API override. */
  widthMode?: "auto" | "manual";
  pinned?: "left" | "right" | null;
  sort?: SortDirection | null;
  sortIndex?: number | null;
}
