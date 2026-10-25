import type { GridApi } from "../types/api";
import type { RowNode } from "../types/row";
import type { RowDragIntent } from "../types/events";
import type { RowDragSurfaceHost } from "../services/rowDragSurface";

export interface RowDragGuard { current(): boolean; revision?: string | number }
export interface RowDragDriverHost extends RowDragSurfaceHost {
  api: GridApi;
  capture(node: RowNode): RowDragGuard;
  emit(node: RowNode, from: number, boundary: number, targetIndex: number, intent: RowDragIntent): void;
  report(error: unknown, source: string): void;
}
export interface RowDragDriver {
  start(event: PointerEvent, node: RowNode): void;
  moveWithKeyboard(event: KeyboardEvent, node: RowNode): void;
  isSource(node: RowNode): boolean;
  destroy(): void;
}
export type RowDragDriverFactory = (host: RowDragDriverHost) => RowDragDriver;
