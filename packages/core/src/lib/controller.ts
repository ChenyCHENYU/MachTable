import type { GridApi } from "../types/api";
import type { GridSize } from "../types/options";
import { downloadFile } from "./download";

export interface MachTableCommandOptions<TData = any> {
  getApi(): GridApi<TData> | null;
  /** Overrides refresh for remote-query workflows. */
  reload?: () => void | Promise<void>;
  /** Fullscreen target. Defaults to the grid root's parent when available. */
  getFullscreenElement?: () => HTMLElement | null;
}

export interface MachTableCommands {
  search(text: string | null | undefined): void;
  refresh(): Promise<void>;
  openColumns(anchor?: HTMLElement): void;
  setDensity(size: GridSize): void;
  resetColumns(): void;
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  exportCsv(filename?: string): boolean;
  toggleFullscreen(): Promise<boolean>;
}

function available<TData>(getApi: () => GridApi<TData> | null): GridApi<TData> | null {
  const api = getApi();
  return api && !api.isDestroyed() ? api : null;
}

/** Framework-neutral command surface used by Vue/React controllers and toolbars. */
export function createMachTableCommands<TData = any>(options: MachTableCommandOptions<TData>): MachTableCommands {
  const getApi = (): GridApi<TData> | null => options.getApi();
  return {
    search(text) {
      available(getApi)?.setQuickFilter(text);
    },
    async refresh() {
      if (options.reload) {
        await options.reload();
        return;
      }
      const api = available(getApi);
      if (!api) return;
      if (api.isInfinite()) await api.reload();
      else api.refreshCells();
    },
    openColumns(anchor) {
      available(getApi)?.openColumnWorkbench(anchor);
    },
    setDensity(size) {
      available(getApi)?.setGridOption("size", size);
    },
    resetColumns() {
      available(getApi)?.resetColumnState();
    },
    undo() {
      return available(getApi)?.undo() ?? false;
    },
    redo() {
      return available(getApi)?.redo() ?? false;
    },
    canUndo() {
      return available(getApi)?.canUndo() ?? false;
    },
    canRedo() {
      return available(getApi)?.canRedo() ?? false;
    },
    exportCsv(filename = "mach-table.csv") {
      const api = available(getApi);
      return api ? downloadFile(filename, api.getDataAsCsv({ prependBOM: true }), "text/csv;charset=utf-8") : false;
    },
    async toggleFullscreen() {
      if (typeof document === "undefined") return false;
      if (document.fullscreenElement) {
        await document.exitFullscreen?.();
        return false;
      }
      const api = available(getApi);
      const root = api?.getRootElement();
      const target = options.getFullscreenElement?.() ?? root?.parentElement ?? root;
      if (!target?.requestFullscreen) return false;
      await target.requestFullscreen();
      return true;
    }
  };
}
