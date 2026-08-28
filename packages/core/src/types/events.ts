import type { ColDef } from "./colDef";
import type { FilterModel, SortModel } from "./colDef";
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
  "detailToggled",
  "rowDragEnd",
  "rangeSelectionChanged",
  "paginationChanged",
  "displayedColumnsChanged",
  "gridError"
] as const;

export type GridEventType = (typeof EVENT_TYPES)[number];

export interface GridEventBase {
  type: GridEventType;
  api: GridApi<any>;
}

export interface GridReadyEvent extends GridEventBase {
  type: "gridReady";
}

export interface GridDestroyedEvent extends GridEventBase {
  type: "gridDestroyed";
}

export interface ModelUpdatedEvent extends GridEventBase {
  type: "modelUpdated";
  rowCount: number;
}

export interface CellClickEvent<TData = any, TValue = any> extends GridEventBase {
  type: "cellClicked";
  event: MouseEvent;
  rowNode: RowNode<TData>;
  rowIndex: number;
  column: Column<TData>;
  colDef: ColDef<TData, TValue>;
  value: TValue;
}

export interface CellDoubleClickEvent<TData = any, TValue = any> extends GridEventBase {
  type: "cellDoubleClicked";
  event: MouseEvent;
  rowNode: RowNode<TData>;
  rowIndex: number;
  column: Column<TData>;
  colDef: ColDef<TData, TValue>;
  value: TValue;
}

export interface CellContextMenuEvent<TData = any, TValue = any> extends GridEventBase {
  type: "cellContextMenu";
  event: MouseEvent;
  rowNode: RowNode<TData>;
  rowIndex: number;
  column: Column<TData>;
  colDef: ColDef<TData, TValue>;
  value: TValue;
}

export interface RowClickEvent<TData = any> extends GridEventBase {
  type: "rowClicked" | "rowDoubleClicked";
  event: MouseEvent;
  rowNode: RowNode<TData>;
  rowIndex: number;
}

export interface SelectionChangedEvent<TData = any> extends GridEventBase {
  type: "selectionChanged";
  selectedNodes: RowNode<TData>[];
  selectedRows: TData[];
}

export interface SortChangedEvent extends GridEventBase {
  type: "sortChanged";
  sortModel: SortModel;
}

export interface FilterChangedEvent extends GridEventBase {
  type: "filterChanged";
  filterModel: FilterModel;
}

export interface ColumnResizedEvent extends GridEventBase {
  type: "columnResized";
  colId: string;
  width: number;
  finished: boolean;
}

export interface ColumnMovedEvent extends GridEventBase {
  type: "columnMoved";
  colId: string;
  toIndex: number;
}

export interface ColumnVisibilityChangedEvent extends GridEventBase {
  type: "columnVisibilityChanged";
  colId: string;
  visible: boolean;
}

export interface CellValueChangedEvent<TData = any, TValue = any> extends GridEventBase {
  type: "cellValueChanged";
  oldValue: TValue;
  newValue: TValue;
  rowNode: RowNode<TData>;
  rowIndex: number;
  column: Column<TData>;
  colDef: ColDef<TData, TValue>;
  data: TData;
}

export interface CellEditingStartedEvent<TData = any> extends GridEventBase {
  type: "cellEditingStarted";
  rowIndex: number;
  colId: string;
  rowNode: RowNode<TData>;
}

export interface CellEditingStoppedEvent<TData = any> extends GridEventBase {
  type: "cellEditingStopped";
  rowIndex: number;
  colId: string;
  rowNode: RowNode<TData>;
  oldValue: any;
  newValue: any;
}

export interface DetailToggledEvent<TData = any> extends GridEventBase {
  type: "detailToggled";
  rowId: string;
  rowNode: RowNode<TData>;
  expanded: boolean;
}

export interface GridCellRange {
  row1: number;
  row2: number;
  colId1: string;
  colId2: string;
}

export interface RangeSelectionChangedEvent extends GridEventBase {
  type: "rangeSelectionChanged";
  range: GridCellRange | null;
}

export interface RowDragEndEvent<TData = any> extends GridEventBase {
  type: "rowDragEnd";
  rowNode: RowNode<TData>;
  fromIndex: number;
  toIndex: number;
}

export interface PaginationChangedEvent extends GridEventBase {
  type: "paginationChanged";
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
}

export interface DisplayedColumnsChangedEvent extends GridEventBase {
  type: "displayedColumnsChanged";
}

export interface GridErrorEvent extends GridEventBase {
  type: "gridError";
  error: unknown;
  source: string;
  context?: Record<string, unknown>;
}

export interface GridEventMap<TData = any> {
  gridReady: GridReadyEvent;
  gridDestroyed: GridDestroyedEvent;
  modelUpdated: ModelUpdatedEvent;
  cellClicked: CellClickEvent<TData>;
  cellDoubleClicked: CellDoubleClickEvent<TData>;
  cellContextMenu: CellContextMenuEvent<TData>;
  rowClicked: RowClickEvent<TData>;
  rowDoubleClicked: RowClickEvent<TData>;
  selectionChanged: SelectionChangedEvent<TData>;
  sortChanged: SortChangedEvent;
  filterChanged: FilterChangedEvent;
  columnResized: ColumnResizedEvent;
  columnMoved: ColumnMovedEvent;
  columnVisibilityChanged: ColumnVisibilityChangedEvent;
  cellValueChanged: CellValueChangedEvent<TData>;
  cellEditingStarted: CellEditingStartedEvent<TData>;
  cellEditingStopped: CellEditingStoppedEvent<TData>;
  detailToggled: DetailToggledEvent<TData>;
  rowDragEnd: RowDragEndEvent<TData>;
  rangeSelectionChanged: RangeSelectionChangedEvent;
  paginationChanged: PaginationChangedEvent;
  displayedColumnsChanged: DisplayedColumnsChangedEvent;
  gridError: GridErrorEvent;
}

export type GridEventHandler<K extends GridEventType, TData = any> = (event: GridEventMap<TData>[K]) => void;

export type EventHandlerName<K extends GridEventType> = `on${Capitalize<K>}`;
