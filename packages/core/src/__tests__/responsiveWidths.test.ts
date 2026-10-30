// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGrid, createLocalGridStateStore, indexColumn, selectionColumn } from "../index";
import type { ColDef, GridApi, GridState, GridStateStore } from "../index";

interface Row { id: string; name: string; note: string }
const rows: Row[] = [{ id: "1", name: "Alpha", note: "A longer description" }];
const definitions: ColDef<Row>[] = [
  selectionColumn(), indexColumn(),
  { field: "name", width: 120, minWidth: 100 },
  { field: "note", width: 240, minWidth: 140 },
  { colId: "actions", width: 128, pinned: "right", suppressSizeToFit: true }
];

function dimensions(element: Element, values: Record<string, number>): void {
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(element, key, { value, configurable: true });
  }
}

function resize(host: HTMLElement, api: GridApi<Row>, width: number, scrollbar = 0): void {
  dimensions(host.querySelector(".mach-body")!, { clientWidth: width });
  // DOM geometry after the pinned panes have already been laid out.
  const centerWidth = Math.max(0, width - 40 - 52 - 128);
  dimensions(host.querySelector(".mach-body-viewport--scroll")!, {
    clientWidth: Math.max(0, centerWidth - scrollbar), offsetWidth: centerWidth
  });
  api.view.refreshLayout();
}

function grid(store?: GridStateStore) {
  const host = document.createElement("div");
  document.body.append(host);
  const api = createGrid(host, {
    columnDefs: definitions, rowData: rows, pagination: false, columnLayout: "fit",
    persistence: store ? { key: "responsive", sections: ["columns"], debounceMs: 0, store } : undefined
  });
  resize(host, api, 800);
  return { host, api };
}

function width(api: GridApi<Row>, colId: string): number {
  return api.columns.getState().find(column => column.colId === colId)!.width!;
}

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("responsive column width budget", () => {
  it("subtracts pinned widths once and excludes only the vertical scrollbar", () => {
    const { host, api } = grid();
    expect(width(api, "name") + width(api, "note")).toBeCloseTo(580);
    resize(host, api, 1200, 10);
    expect(width(api, "name") + width(api, "note")).toBeCloseTo(970);
    expect(width(api, "sel")).toBe(40);
    expect(width(api, "idx")).toBe(52);
    expect(width(api, "actions")).toBe(128);
    resize(host, api, 500);
    expect(width(api, "name") + width(api, "note")).toBeCloseTo(280);
    resize(host, api, 400);
    expect(width(api, "name")).toBe(100);
    expect(width(api, "note")).toBe(140);
    api.destroy();
  });

  it("keeps manual widths exact while the other columns fill the remaining space", () => {
    const { host, api } = grid();
    api.columns.setWidth("name", 200);
    resize(host, api, 1200);
    expect(width(api, "name")).toBe(200);
    expect(width(api, "note")).toBe(780);
    api.columns.setVisible("name", false);
    expect(width(api, "note")).toBe(980);
    api.columns.resetState();
    expect(width(api, "name") + width(api, "note")).toBeCloseTo(980);
    api.destroy();
  });

  it("fits only eligible columns and can restore responsiveness after manual sizing", () => {
    const { host, api } = grid();
    api.columns.setWidth("name", 160);
    api.columns.setWidth("note", 240);
    api.columns.fit();
    expect(width(api, "name") + width(api, "note")).toBeCloseTo(580);
    expect(width(api, "actions")).toBe(128);
    resize(host, api, 1600);
    expect(width(api, "name") + width(api, "note")).toBeCloseTo(1380);
    expect(width(api, "name") / width(api, "note")).toBeCloseTo(160 / 240);
    expect(api.columns.getState().find(column => column.colId === "name")?.widthMode).toBe("auto");
    api.destroy();
  });

  it("retains measured content proportions and responsive sizing across persistence and definition updates", () => {
    const measure = vi.fn((text: string) => ({ width: text.length * 8 }));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ measureText: measure } as unknown as CanvasRenderingContext2D);
    let stored: GridState | null = null;
    const store: GridStateStore = { load: () => stored, save: (_key, state) => { stored = state; } };
    const first = grid(store);
    first.api.columns.autoSizeAll();
    const measured = first.api.columns.getState();
    expect(measured.find(column => column.colId === "name")).toMatchObject({ widthMode: "auto", contentWidth: 100 });
    expect(measured.find(column => column.colId === "note")).toMatchObject({ widthMode: "auto", contentWidth: 188 });
    expect(width(first.api, "actions")).toBe(128);
    const count = measure.mock.calls.length;
    resize(first.host, first.api, 1400);
    expect(width(first.api, "name") / width(first.api, "note")).toBeCloseTo(100 / 188);
    expect(width(first.api, "name") + width(first.api, "note")).toBeCloseTo(1180);
    expect(measure).toHaveBeenCalledTimes(count);
    first.api.destroy();
    const second = grid(store);
    resize(second.host, second.api, 1000);
    expect(width(second.api, "name") / width(second.api, "note")).toBeCloseTo(100 / 188);
    second.api.columns.setDefinitions(definitions);
    expect(second.api.columns.getState().find(column => column.colId === "note")?.contentWidth).toBe(188);
    second.api.columns.setWidth("name", 180);
    resize(second.host, second.api, 1200);
    expect(width(second.api, "name")).toBe(180);
    expect(width(second.api, "note")).toBe(800);
    second.api.columns.resetState();
    expect(second.api.columns.getState().every(column => column.contentWidth === undefined)).toBe(true);
    second.api.destroy();
  });

  it("sanitizes content measurements without changing legacy manual preferences", async () => {
    const values = new Map<string, string>();
    const store = createLocalGridStateStore({ storage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
      removeItem: key => { values.delete(key); }
    } });
    const { api } = grid(store);
    const state = api.state.get();
    store.save("responsive", { ...state, columns: [
      { colId: "name", width: 180, widthMode: "manual" },
      { colId: "note", widthMode: "auto", contentWidth: 240 },
      { colId: "invalid", contentWidth: Number.NaN }
    ] });
    const loaded = await store.load("responsive");
    expect(loaded?.columns).toEqual([
      { colId: "name", width: 180, widthMode: "manual" },
      { colId: "note", widthMode: "auto", contentWidth: 240 },
      { colId: "invalid" }
    ]);
    api.state.apply(loaded!);
    expect(width(api, "name")).toBe(180);
    expect(width(api, "note")).toBe(400);
    api.destroy();
  });
});
