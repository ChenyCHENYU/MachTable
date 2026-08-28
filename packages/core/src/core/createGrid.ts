import { GridCore } from "./gridCore";
import type { GridApi, GridOptions } from "../types";

export function createGrid<TData = any>(container: HTMLElement, options: GridOptions<TData> = {}): GridApi<TData> {
  if (!container) {
    throw new Error("[mach-table] createGrid requires a container element");
  }
  if (typeof document === "undefined") {
    throw new Error("[mach-table] createGrid can only be used in a browser environment");
  }
  const core = new GridCore<TData>(container, options);
  return core.getApi();
}
