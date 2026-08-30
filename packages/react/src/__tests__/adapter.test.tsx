import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GridApi } from "@agile-team/mach-table";
import { RobotGrid } from "../MachTable";
import { reactCellRenderer } from "../adapters";
import DefaultMachTable, {
  createGrid,
  DEFAULT_LOCALE,
  defineMachTableConfig,
  MachTable,
  MachTableProvider,
  MachTableToolbar,
  useMachTableQuery,
  type ColDef,
  type UseMachTableQueryReturn
} from "../index";
import { useMachGrid } from "../useMachGrid";

class ResizeObserverStub {
  observe(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  document.body.textContent = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("React adapter", () => {
  it("re-exports the complete core API and types from its public entry", () => {
    const column: ColDef<{ id: number }> = { field: "id" };
    expect(column.field).toBe("id");
    expect(createGrid).toBeTypeOf("function");
    expect(DEFAULT_LOCALE.loading).toBeTruthy();
    expect(DefaultMachTable).toBe(RobotGrid);
    expect(MachTable).toBe(RobotGrid);
  });

  it("merges provider defaults while keeping table props authoritative", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const defaults = {
      theme: "dark" as const,
      pagination: false,
      defaultColDef: { sortable: false, resizable: false }
    };

    await act(async () => root.render(createElement(MachTableProvider, { defaults },
      createElement(MachTable, {
        theme: "light",
        columnDefs: [{ field: "id" }],
        rowData: [{ id: 1 }]
      })
    )));
    expect(host.querySelector(".mach-root")?.classList.contains("mach-theme-dark")).toBe(false);
    expect((host.querySelector(".mach-pagination") as HTMLElement).style.display).toBe("none");
    await act(async () => root.unmount());
  });

  it("supports the same named config presets as Vue", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const config = defineMachTableConfig({
      defaults: { pagination: false },
      presets: { dense: { size: "compact" as const, stripedRows: true } },
      defaultPreset: "dense"
    });
    await act(async () => root.render(createElement(MachTableProvider, { config },
      createElement(MachTable, { columnDefs: [{ field: "id" }], rowData: [{ id: 1 }] })
    )));
    expect(host.querySelector(".mach-root")?.classList).toContain("mach-size--compact");
    expect(host.querySelector(".mach-root")?.classList).toContain("mach-striped");
    await act(async () => root.unmount());
  });

  it("uses the latest event callback even when it is added after mount", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const first = vi.fn();
    const latest = vi.fn();
    const base = { columnDefs: [{ field: "name" }], rowData: [{ name: "Ada" }], pagination: false };

    await act(async () => {
      root.render(createElement(MachTable, { ...base, onCellClicked: first }));
    });
    await act(async () => {
      root.render(createElement(MachTable, { ...base, onCellClicked: latest }));
    });
    host.querySelector<HTMLElement>(".mach-cell[data-col-id='name']")?.click();
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
  });

  it("updates a replacement apiRef and clears both refs safely", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const first = { current: null as GridApi | null };
    const second = { current: null as GridApi | null };
    const props = { columnDefs: [{ field: "id" }], rowData: [{ id: 1 }], pagination: false };

    await act(async () => root.render(createElement(MachTable, { ...props, apiRef: first })));
    expect(first.current).not.toBeNull();
    await act(async () => root.render(createElement(MachTable, { ...props, apiRef: second })));
    expect(first.current).toBeNull();
    expect(second.current).not.toBeNull();
    await act(async () => root.unmount());
    expect(second.current).toBeNull();
  });

  it("unmounts React cell roots when the grid is destroyed", async () => {
    const mounted = vi.fn();
    const cleanup = vi.fn();
    function Cell(): null {
      useEffect(() => {
        mounted();
        return cleanup;
      }, []);
      return null;
    }
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(MachTable, {
        columnDefs: [{ field: "id", cellRenderer: reactCellRenderer(Cell) }],
        rowData: [{ id: 1 }],
        pagination: false
      }));
    });
    await act(async () => root.unmount());
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));
    expect(mounted).toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(mounted.mock.calls.length);
  });

  it("refreshes React cell components in place when cell params change", async () => {
    const mounted = vi.fn();
    const cleanup = vi.fn();
    function Cell(props: { value?: string }) {
      useEffect(() => {
        mounted();
        return cleanup;
      }, []);
      return createElement("span", { className: "refreshable-cell" }, props.value);
    }
    const renderer = reactCellRenderer(Cell as any);
    const initial = { value: "before" } as any;
    const result = renderer(initial) as any;
    document.body.appendChild(result.el);
    await act(async () => Promise.resolve());
    expect(result.el.textContent).toBe("before");

    await act(async () => {
      expect(result.refresh({ ...initial, value: "after" })).toBe(true);
    });
    expect(result.el.textContent).toBe("after");
    expect(mounted).toHaveBeenCalledOnce();

    result.destroy();
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("reactively forwards structural options, datasource and inner grid class", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const getRows = vi.fn((params: any) => params.onSuccess([{ id: 2 }], 1));
    const base = {
      columnDefs: [{ field: "id" }],
      rowData: [{ id: 1 }],
      pagination: false,
      gridClassName: "before"
    };

    await act(async () => root.render(createElement(MachTable, base)));
    const gridRoot = host.querySelector(".mach-root")!;
    expect(gridRoot.classList.contains("before")).toBe(true);

    await act(async () => root.render(createElement(MachTable, {
      ...base,
      gridClassName: "after",
      datasource: { getRows },
      treeData: true,
      childrenKey: "items"
    })));
    expect(getRows).toHaveBeenCalledOnce();
    expect(gridRoot.classList.contains("before")).toBe(false);
    expect(gridRoot.classList.contains("after")).toBe(true);
    await act(async () => root.unmount());
  });

  it("exposes a reactive API through useMachGrid", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    let observedApi: GridApi | null = null;

    function Harness() {
      const grid = useMachGrid();
      observedApi = grid.api;
      return createElement(MachTable, {
        apiRef: grid.apiRef,
        columnDefs: [{ field: "id" }],
        rowData: [{ id: 1 }],
        pagination: false
      });
    }

    await act(async () => root.render(createElement(Harness)));
    expect(observedApi).not.toBeNull();
    expect((observedApi as GridApi | null)?.getDisplayedRowCount()).toBe(1);
    await act(async () => root.unmount());
  });

  it("keeps manual query mode explicit and exposes a first-class error binding", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const request = vi.fn(async (params?: unknown) => {
      void params;
      return { rows: [{ id: "1" }], total: 1 };
    });
    let remote: UseMachTableQueryReturn<{ id: string }> | null = null;
    function Harness() {
      remote = useMachTableQuery({ query: { keyword: "x" }, queryKey: "x", rowKey: "id", request, mode: "manual" });
      return createElement(MachTable<{ id: string }>, { ...remote.gridProps, columnDefs: [{ field: "id" }] });
    }
    await act(async () => root.render(createElement(Harness)));
    expect(request).not.toHaveBeenCalled();
    await act(async () => {
      remote!.gridProps.onSortChanged?.({ sortModel: [{ colId: "id", sort: "asc" }] } as any);
      remote!.gridProps.onFilterChanged?.({
        filterModel: {},
        api: { getQuickFilter: () => null },
        advancedFilterModel: {
          version: 1,
          root: {
            kind: "condition",
            colId: "id",
            filter: { type: "text", conditions: [{ match: "equals", value: "1" }] }
          }
        }
      } as any);
      await remote!.reload();
    });
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0][0]).toEqual(expect.objectContaining({
      advancedFilterModel: expect.objectContaining({ version: 1 })
    }));
    expect(remote!.rows).toEqual([{ id: "1" }]);
    expect(remote!.gridProps.error).toBeNull();
    await act(async () => root.unmount());
  });

  it("renders the optional toolbar with accessible controls", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const search = vi.fn();
    await act(async () => root.render(createElement(MachTableToolbar, {
      search: "",
      onSearchChange: search,
      selectedCount: 2,
      features: { export: false }
    })));
    const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    input.value = "orders";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(host.querySelector('[role="toolbar"]')).toBeTruthy();
    expect(host.textContent).toContain("已选 2 项");
    await act(async () => root.unmount());
  });
});
