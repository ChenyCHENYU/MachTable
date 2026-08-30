import type { ColDef } from "./colDef";
import type { FilterModel, SortModel } from "./colDef";
import type { AdvancedFilterModel } from "./advancedFilter";
import type { RowNode } from "./row";
import type { GridApi } from "./api";
import type { Column } from "../services/column";

export const EVENT_TYPES = [
  "gridReady",
  "gridDestroyed",
  "modelUpdated",
  "cellClicked",
  "cellDoubleClicked",
  "cellContextMenu",
  "rowClicked",
  "rowDoubleClicked",
  "selectionChanged",
  "sortChanged",
  "filterChanged",
  "columnResized",
  "columnMoved",
  "columnVisibilityChanged",
  "cellValueChanged",
  "cellEditingStarted",
  "cellEditingStopped",
  "rowEditingStarted",
  "rowEditingStopped",
  "detailToggled",
  "treeChildrenLoaded",
  "treeChildrenLoadFailed",
  "rowDragEnd",
  "rangeSelectionChanged",
  "paginationChanged",
  "displayedColumnsChanged",
  "gridError",
  "dirtyStateChanged"
] as const;

export type GridEventType = (typeof EVENT_TYPES)[number];

export type GridErrorCode =
  | "DATA_SOURCE_ERROR"
  | "DATA_INTEGRITY_ERROR"
  | "VALIDATION_ERROR"
  | "RENDERER_ERROR"
  | "EDITOR_ERROR"
  | "FEATURE_ERROR"
  | "STATE_ERROR"
  | "EVENT_HANDLER_ERROR"
  | "GRID_ERROR";

export interface GridEventBase<TData = any> {
  type: GridEventType;
  api: GridApi<TData>;
}

export interface GridReadyEvent<TData = any> extends GridEventBase<TData> {
  type: "gridReady";
}

export interface GridDestroyedEvent<TData = any> extends GridEventBase<TData> {
  type: "gridDestroyed";
}

export interface ModelUpdatedEvent<TData = any> extends GridEventBase<TData> {
  type: "modelUpdated";
  rowCount: number;
}

export interface CellClickEvent<TData = any, TValue = any> extends GridEventBase<TData> {
  type: "cellClicked";
  event: MouseEvent;
  rowNode: RowNode<TData>;
  rowIndex: number;
  column: Column<TData>;
  colDef: ColDef<TData, TValue>;
  value: TValue;
}

export interface CellDoubleClickEvent<TData = any, TValue = any> extends GridEventBase<TData> {
  type: "cellDoubleClicked";
  event: MouseEvent;
  rowNode: RowNode<TData>;
  rowIndex: number;
  column: Column<TData>;
  colDef: ColDef<TData, TValue>;
  value: TValue;
}

export interface CellContextMenuEvent<TData = any, TValue = any> extends GridEventBase<TData> {
  type: "cellContextMenu";
  event: MouseEvent;
  rowNode: RowNode<TData>;
  rowIndex: number;
  column: Column<TData>;
  colDef: ColDef<TData, TValue>;
  value: TValue;
}

export interface RowClickEvent<TData = any> extends GridEventBase<TData> {
  type: "rowClicked" | "rowDoubleClicked";
  event: MouseEvent;
  rowNode: RowNode<TData>;
  rowIndex: number;
}

export interface SelectionChangedEvent<TData = any> extends GridEventBase<TData> {
  type: "selectionChanged";
  selectedNodes: RowNode<TData>[];
  selectedRows: TData[];
}

export interface SortChangedEvent<TData = any> extends GridEventBase<TData> {
  type: "sortChanged";
  sortModel: SortModel;
}

export interface FilterChangedEvent<TData = any> extends GridEventBase<TData> {
  type: "filterChanged";
  filterModel: FilterModel;
  advancedFilterModel: AdvancedFilterModel | null;
}

export interface ColumnResizedEvent<TData = any> extends GridEventBase<TData> {
  type: "columnResized";
  colId: string;
  width: number;
  finished: boolean;
}

export interface ColumnMovedEvent<TData = any> extends GridEventBase<TData> {
  type: "columnMoved";
  colId: string;
  toIndex: number;
}

export interface ColumnVisibilityChangedEvent<TData = any> extends GridEventBase<TData> {
  type: "columnVisibilityChanged";
  colId: string;
  visible: boolean;
}

export interface CellValueChangedEvent<TData = any, TValue = any> extends GridEventBase<TData> {
  type: "cellValueChanged";
  oldValue: TValue;
  newValue: TValue;
  rowNode: RowNode<TData>;
  rowIndex: number;
  column: Column<TData>;
  colDef: ColDef<TData, TValue>;
  data: TData;
}

export interface CellEditingStartedEvent<TData = any> extends GridEventBase<TData> {
  type: "cellEditingStarted";
  rowIndex: number;
  colId: string;
  rowNode: RowNode<TData>;
}

export interface CellEditingStoppedEvent<TData = any> extends GridEventBase<TData> {
  type: "cellEditingStopped";
  rowIndex: number;
  colId: string;
  rowNode: RowNode<TData>;
  oldValue: any;
  newValue: any;
}

export interface RowEditChange {
  colId: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface RowEditingStartedEvent<TData = any> extends GridEventBase<TData> {
  type: "rowEditingStarted";
  rowIndex: number;
  rowNode: RowNode<TData>;
  data: TData;
}

export interface RowEditingStoppedEvent<TData = any> extends GridEventBase<TData> {
  type: "rowEditingStopped";
  rowIndex: number;
  rowNode: RowNode<TData>;
  data: TData;
  cancelled: boolean;
  changes: RowEditChange[];
}

export interface DetailToggledEvent<TData = any> extends GridEventBase<TData> {
  type: "detailToggled";
  rowId: string;
  rowNode: RowNode<TData>;
  expanded: boolean;
}

export interface TreeChildrenLoadedEvent<TData = any> extends GridEventBase<TData> {
  type: "treeChildrenLoaded";
  rowId: string;
  rowNode: RowNode<TData>;
  children: readonly TData[];
}

export interface TreeChildrenLoadFailedEvent<TData = any> extends GridEventBase<TData> {
  type: "treeChildrenLoadFailed";
  rowId: string;
  rowNode: RowNode<TData>;
  error: unknown;
}

export interface GridCellRange {
  row1: number;
  row2: number;
  colId1: string;
  colId2: string;
}

export interface RangeSelectionChangedEvent<TData = any> extends GridEventBase<TData> {
  type: "rangeSelectionChanged";
  range: GridCellRange | null;
}

export interface RowDragEndEvent<TData = any> extends GridEventBase<TData> {
  type: "rowDragEnd";
  rowNode: RowNode<TData>;
  fromIndex: number;
  toIndex: number;
}

export interface PaginationChangedEvent<TData = any> extends GridEventBase<TData> {
  type: "paginationChanged";
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
}

export interface DisplayedColumnsChangedEvent<TData = any> extends GridEventBase<TData> {
  type: "displayedColumnsChanged";
}

export interface GridErrorEvent<TData = any> extends GridEventBase<TData> {
  type: "gridError";
  code: GridErrorCode;
  error: unknown;
  source: string;
  context?: Record<string, unknown>;
}

export interface DirtyStateChangedEvent<TData = any> extends GridEventBase<TData> {
  type: "dirtyStateChanged";
  dirtyRowIds: string[];
}

export interface GridEventMap<TData = any> {
  gridReady: GridReadyEvent<TData>;
  gridDestroyed: GridDestroyedEvent<TData>;
  modelUpdated: ModelUpdatedEvent<TData>;
  cellClicked: CellClickEvent<TData>;
  cellDoubleClicked: CellDoubleClickEvent<TData>;
  cellContextMenu: CellContextMenuEvent<TData>;
  rowClicked: RowClickEvent<TData>;
  rowDoubleClicked: RowClickEvent<TData>;
  selectionChanged: SelectionChangedEvent<TData>;
  sortChanged: SortChangedEvent<TData>;
  filterChanged: FilterChangedEvent<TData>;
  columnResized: ColumnResizedEvent<TData>;
  columnMoved: ColumnMovedEvent<TData>;
  columnVisibilityChanged: ColumnVisibilityChangedEvent<TData>;
  cellValueChanged: CellValueChangedEvent<TData>;
  cellEditingStarted: CellEditingStartedEvent<TData>;
  cellEditingStopped: CellEditingStoppedEvent<TData>;
  rowEditingStarted: RowEditingStartedEvent<TData>;
  rowEditingStopped: RowEditingStoppedEvent<TData>;
  detailToggled: DetailToggledEvent<TData>;
  treeChildrenLoaded: TreeChildrenLoadedEvent<TData>;
  treeChildrenLoadFailed: TreeChildrenLoadFailedEvent<TData>;
  rowDragEnd: RowDragEndEvent<TData>;
  rangeSelectionChanged: RangeSelectionChangedEvent<TData>;
  paginationChanged: PaginationChangedEvent<TData>;
  displayedColumnsChanged: DisplayedColumnsChangedEvent<TData>;
  gridError: GridErrorEvent<TData>;
  dirtyStateChanged: DirtyStateChangedEvent<TData>;
}

export type GridEventHandler<K extends GridEventType, TData = any> = (event: GridEventMap<TData>[K]) => void;

export type EventHandlerName<K extends GridEventType> = `on${Capitalize<K>}`;
