import type { ColDef } from "./colDef";
import type { RowNode } from "./row";
import type { GridApi } from "./api";
import type { Column } from "../services/column";

export interface ValueGetterParams<TData = any, TValue = any> {
  data: TData | null;
  node: RowNode<TData>;
  colDef: ColDef<TData, TValue>;
  column: Column<TData>;
  api: GridApi<TData>;
}

export interface ValueFormatterParams<TData = any, TValue = any> extends ValueGetterParams<TData, TValue> {
  value: TValue;
}

export interface CellRendererParams<TData = any, TValue = any> extends ValueGetterParams<TData, TValue> {
  value: TValue;
  formatted: string;
  rowIndex: number;
  rendererParams?: Record<string, any>;
}

export interface CellClassParams<TData = any, TValue = any> extends ValueGetterParams<TData, TValue> {
  value: TValue;
  rowIndex: number;
}

export interface EditableParams<TData = any, TValue = any> extends ValueGetterParams<TData, TValue> {
  value: TValue;
  rowIndex: number;
}

export interface CellEditorParams<TData = any, TValue = any> extends ValueGetterParams<TData, TValue> {
  value: TValue;
  rowIndex: number;
  keyPress?: string | null;
}

export interface ValueSetterParams<TData = any, TValue = any> {
  oldValue: TValue;
  newValue: TValue;
  data: TData;
  node: RowNode<TData>;
  colDef: ColDef<TData, TValue>;
  column: Column<TData>;
  api: GridApi<TData>;
}

export interface GetRowIdParams<TData = any> {
  data: TData;
  index: number;
  api: GridApi<TData>;
}

export interface GetRowHeightParams<TData = any> {
  data: TData | null;
  node: RowNode<TData>;
  api: GridApi<TData>;
}

export interface TooltipParams<TData = any> {
  data: TData | null;
  node: RowNode<TData>;
  api: GridApi<TData>;
  colId: string;
  value: any;
  formatted: string;
  rowIndex: number;
}

export interface ContextMenuParams<TData = any> {
  data: TData | null;
  node: RowNode<TData>;
  api: GridApi<TData>;
  colId: string;
  value: any;
  rowIndex: number;
}

export interface ContextMenuItem {
  label?: string;
  action?: () => void;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
}

export interface HeaderComponentParams<TData = any> {
  colDef: ColDef<TData>;
  column: import("../services/column").Column<TData>;
  api: GridApi<TData>;
}

export interface ICellRendererResult {
  el: HTMLElement;
  destroy?: () => void;
}

export type CellRendererOutput = string | HTMLElement | ICellRendererResult | null | undefined;

export interface ICellEditor<TValue = any> {
  el: HTMLElement;
  getValue(): TValue | null | undefined;
  focus?(): void;
  destroy?(): void;
  isCancelBeforeStart?(): boolean;
  isCancelAfterEnd?(value: TValue | null | undefined): boolean;
}
