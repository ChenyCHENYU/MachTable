// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearComponentRegistries,
  createGrid,
  getCellRenderer,
  registerCellRenderer,
  sanitizeFormulaCell,
  setByPath,
  toTsv
} from "../index";
import type { GridApi, GridFeature, InfiniteGetRowsParams } from "../index";

class ResizeObserverStub {
  observe(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
});

afterEach(() => {
  clearComponentRegistries();
  document.body.textContent = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function host(): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: 360, configurable: true });
  document.body.appendChild(el);
  return el;
}

describe("security hardening", () => {
  it("rejects prototype-polluting field paths", () => {
    const value: Record<string, any> = {};
    expect(setByPath(value, "__proto__.polluted", true)).toBe(false);
    expect(setByPath(value, "constructor.prototype.polluted", true)).toBe(false);
    expect(({} as any).polluted).toBeUndefined();
  });

  it("protects formulas while preserving complete numeric values", () => {
    expect(sanitizeFormulaCell("+42")).toBe("+42");
    expect(sanitizeFormulaCell("-4.2e3")).toBe("-4.2e3");
    expect(sanitizeFormulaCell("+1+cmd|' /C calc'!A0")).toBe("'+1+cmd|' /C calc'!A0");
    expect(sanitizeFormulaCell("  =1+1")).toBe("'  =1+1");
    expect(toTsv([["@SUM(A1:A2)"]])).toBe("'@SUM(A1:A2)");
  });

  it("renders overlay strings as text unless trusted HTML is explicitly enabled", () => {
    const safeHost = host();
    const safeApi = createGrid(safeHost, {
      columnDefs: [{ field: "id" }],
      rowData: [],
      overlayNoRowsTemplate: '<img class="unsafe-overlay" src=x onerror="alert(1)">'
    });
    expect(safeHost.querySelector(".unsafe-overlay")).toBeNull();
    expect(safeHost.querySelector(".mach-overlay-content")?.textContent).toContain("<img");
    safeApi.destroy();

    const trustedHost = host();
    const trustedApi = createGrid(trustedHost, {
      columnDefs: [{ field: "id" }],
      rowData: [],
      overlayNoRowsTemplate: '<div class="trusted-overlay">EMPTY</div>',
      allowUnsafeOverlayHtml: true
    });
    expect(trustedHost.querySelector(".trusted-overlay")).toBeTruthy();
    trustedApi.destroy();
  });

  it("accepts an HTMLElement overlay factory without using HTML parsing", () => {
    const gridHost = host();
    const api = createGrid(gridHost, {
      columnDefs: [{ field: "id" }],
      rowData: [],
      overlayNoRowsTemplate: () => {
        const element = document.createElement("strong");
        element.className = "safe-empty";
        element.textContent = "EMPTY";
        return element;
      }
    });
    expect(gridHost.querySelector(".safe-empty")?.textContent).toBe("EMPTY");
    api.destroy();
  });
});

describe("extension boundaries", () => {
  it("uses per-grid components before global components", () => {
    const unregister = registerCellRenderer("badge", () => "global");
    const localHost = host();
    const localApi = createGrid(localHost, {
      columnDefs: [{ field: "status", cellRenderer: "badge" }],
      rowData: [{ status: "ok" }],
      pagination: false,
      components: { cellRenderers: { badge: () => "local" } }
    });
    expect(localHost.querySelector(".mach-cell[data-col-id='status']")?.textContent).toBe("local");

    const globalHost = host();
    const globalApi = createGrid(globalHost, {
      columnDefs: [{ field: "status", cellRenderer: "badge" }],
      rowData: [{ status: "ok" }],
      pagination: false
    });
    expect(globalHost.querySelector(".mach-cell[data-col-id='status']")?.textContent).toBe("global");
    unregister();
    expect(getCellRenderer("badge")).toBeUndefined();
    localApi.destroy();
    globalApi.destroy();
  });

  it("restores built-in renderers after the global registry is cleared", () => {
    const gridHost = host();
    const api = createGrid(gridHost, {
      columnDefs: [{ field: "status", cellRenderer: "statusTag" }],
      rowData: [{ status: "active" }],
      pagination: false
    });
    expect(gridHost.querySelector(".mach-tag")).toBeTruthy();
    clearComponentRegistries();
    api.refreshCells();
    expect(gridHost.querySelector(".mach-tag")).toBeTruthy();
    api.destroy();
  });

  it("sets up, replaces and destroys scoped grid features", () => {
    const firstCleanup = vi.fn();
    const firstDestroy = vi.fn();
    const secondCleanup = vi.fn();
    const first: GridFeature = {
      key: "first",
      setup: ({ root }) => {
        root.dataset.feature = "first";
        return firstCleanup;
      },
      destroy: firstDestroy
    };
    const second: GridFeature = {
      key: "second",
      setup: ({ root }) => {
        root.dataset.feature = "second";
        return secondCleanup;
      }
    };
    const gridHost = host();
    const api = createGrid(gridHost, {
      columnDefs: [{ field: "id" }],
      rowData: [{ id: 1 }],
      pagination: false,
      features: [first]
    });
    expect(gridHost.querySelector<HTMLElement>(".mach-root")?.dataset.feature).toBe("first");
    api.updateOptions({ features: [second] });
    expect(firstCleanup).toHaveBeenCalledOnce();
    expect(firstDestroy).toHaveBeenCalledOnce();
    expect(gridHost.querySelector<HTMLElement>(".mach-root")?.dataset.feature).toBe("second");
    api.destroy();
    expect(secondCleanup).toHaveBeenCalledOnce();
  });

  it("updates the inner grid class without replacing the grid", () => {
    const gridHost = host();
    const api = createGrid(gridHost, {
      columnDefs: [{ field: "id" }],
      rowData: [{ id: 1 }],
      pagination: false,
      className: "before"
    });
    const root = gridHost.querySelector(".mach-root")!;
    api.updateOptions({ className: "after another" });
    expect(root.classList.contains("before")).toBe(false);
    expect(root.classList.contains("after")).toBe(true);
    expect(root.classList.contains("another")).toBe(true);
    api.destroy();
  });
});

describe("lifecycle and error isolation", () => {
  it("destroys every mounted renderer root", () => {
    let mounted = 0;
    let destroyed = 0;
    const api = createGrid(host(), {
      columnDefs: [{
        field: "id",
        editable: true,
        cellRenderer: () => {
          mounted++;
          return { el: document.createElement("span"), destroy: () => destroyed++ };
        }
      }],
      rowData: [{ id: 1 }],
      pagination: false
    });
    api.refreshCells();
    expect(api.startEditingCell({ rowIndex: 0, colId: "id" })).toBe(true);
    api.stopEditing(true);
    api.destroy();
    expect(mounted).toBeGreaterThan(0);
    expect(destroyed).toBe(mounted);
  });

  it("reports throwing option handlers without breaking cleanup", () => {
    const errors = vi.fn();
    const gridHost = host();
    const api = createGrid(gridHost, {
      columnDefs: [{ field: "id" }],
      rowData: [{ id: 1 }],
      pagination: false,
      onGridError: errors,
      onCellClicked: () => { throw new Error("consumer click failed"); },
      onGridDestroyed: () => { throw new Error("consumer cleanup failed"); }
    });
    gridHost.querySelector<HTMLElement>(".mach-cell[data-col-id='id']")?.click();
    expect(errors).toHaveBeenCalledWith(expect.objectContaining({ source: "eventHandler.onCellClicked" }));
    expect(() => api.destroy()).not.toThrow();
    expect(api.isDestroyed()).toBe(true);
  });
});

describe("infinite datasource state machine", () => {
  it("continues loading when total is unknown and stops on a short block", async () => {
    const calls: InfiniteGetRowsParams<{ id: number }>[] = [];
    const gridHost = host();
    const api = createGrid(gridHost, {
      columnDefs: [{ field: "id" }],
      blockSize: 2,
      pagination: false,
      datasource: { getRows: (params) => { calls.push(params); } }
    });
    calls[0].onSuccess([{ id: 1 }, { id: 2 }]);
    const viewport = gridHost.querySelector(".mach-body-viewport--scroll") as HTMLElement;
    Object.defineProperty(viewport, "clientHeight", { value: 72, configurable: true });
    Object.defineProperty(viewport, "scrollTop", { value: 72, configurable: true });
    viewport.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => window.setTimeout(resolve, 5));
    expect(calls).toHaveLength(2);
    calls[1].onSuccess([{ id: 3 }]);
    viewport.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => window.setTimeout(resolve, 5));
    expect(calls).toHaveLength(2);
    expect(api.getTotalRowCount()).toBe(3);
    api.destroy();
  });

  it("aborts stale requests and exposes an awaitable reload", async () => {
    const calls: InfiniteGetRowsParams<{ id: number }>[] = [];
    const api: GridApi<{ id: number }> = createGrid(host(), {
      columnDefs: [{ field: "id" }],
      pagination: false,
      datasource: { getRows: (params) => { calls.push(params); } }
    });
    const reload = api.reload();
    expect(calls[0].signal.aborted).toBe(true);
    expect(calls).toHaveLength(2);
    calls[1].onSuccess([], 0);
    await reload;
    api.destroy();
  });

  it("reloads server filters and forwards quick-filter text", () => {
    const calls: InfiniteGetRowsParams<{ id: number }>[] = [];
    const api = createGrid<{ id: number }>(host(), {
      columnDefs: [{ field: "id" }],
      pagination: false,
      datasource: { getRows: (params) => { calls.push(params); } }
    });
    const filter = { type: "number" as const, conditions: [{ match: "greaterThan" as const, value: 5 }] };
    api.setFilterModel({ id: filter });
    expect(calls[0].signal.aborted).toBe(true);
    expect(calls[1].filterModel.id).toEqual(filter);
    api.setQuickFilter("urgent");
    expect(calls[1].signal.aborted).toBe(true);
    expect(calls[2].quickFilterText).toBe("urgent");
    calls[2].onSuccess([], 0);
    api.destroy();
  });
});

describe("CSV import", () => {
  it("keeps original header indexes, strips BOM, builds nested paths and preserves leading zeros", () => {
    const api = createGrid<any>(host(), {
      columnDefs: [{ field: "name" }, { field: "code" }, { field: "user.city" }],
      rowData: [],
      pagination: false
    });
    expect(api.importCsv("\uFEFFname,ignored,code,user.city\r\nAda,x,001,Paris")).toBe(true);
    expect(api.getRowNode(0)?.data).toEqual({ name: "Ada", code: "001", user: { city: "Paris" } });
    api.destroy();
  });
});
