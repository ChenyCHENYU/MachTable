// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { actionsColumn, createGrid, indexColumn, selectionColumn } from "../index";
import type { GridApi, GridOptions } from "../index";

interface Row { id: string; name: string; note: string; amount: number }
const rows: Row[] = [{ id: "1", name: "Alpha", note: "A longer description", amount: 10 }];
const grids: GridApi<Row>[] = [];
const defaults = [{ field: "name", headerName: "Name" }, { field: "note", headerName: "Note" }] as const;

function grid(options: GridOptions<Row> = {}, width = 800) {
  const host = document.createElement("div");
  document.body.append(host);
  const api = createGrid<Row>(host, { rowKey: "id", rowNumber: false, pagination: false, columnDefs: [...defaults], rowData: rows, ...options });
  grids.push(api);
  const resize = (next: number) => {
    Object.defineProperty(host.querySelector(".mach-body")!, "clientWidth", { value: next, configurable: true });
    api.view.refreshLayout();
  };
  resize(width);
  return { api, host, resize };
}

const width = (api: GridApi<Row>, id: string) => api.columns.getState().find(column => column.colId === id)!.width!;

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ measureText: (text: string) => ({ width: text.length * 8 }) } as unknown as CanvasRenderingContext2D);
});
afterEach(() => { grids.splice(0).forEach(api => api.destroy()); document.body.replaceChildren(); vi.restoreAllMocks(); });

it("defaults to proportional expansion of header/content baselines without page glue", () => {
  const natural = grid({ columnLayout: "normal" });
  const automatic = grid();
  expect(width(automatic.api, "name") + width(automatic.api, "note")).toBeCloseTo(800);
  expect(width(automatic.api, "name") / width(automatic.api, "note"))
    .toBeCloseTo(width(natural.api, "name") / width(natural.api, "note"));
  automatic.resize(1200);
  expect(width(automatic.api, "name") + width(automatic.api, "note")).toBeCloseTo(1200);
});

it("keeps natural baselines instead of squeezing when the columns exceed the viewport", () => {
  const natural = grid({ columnLayout: "normal" });
  const automatic = grid({}, 180);
  expect(automatic.api.columns.getState().map(column => column.width)).toEqual(natural.api.columns.getState().map(column => column.width));
  expect(width(automatic.api, "name") + width(automatic.api, "note")).toBeGreaterThan(180);
});

it("excludes utilities from default expansion and resizing while explicit per-column overrides remain valid", () => {
  const { api, host, resize } = grid({ enableColumnResize: true, defaultColDef: { resizable: true }, columnDefs: [
    selectionColumn(), indexColumn(),
    { colId: "rawSelect", headerName: "", checkboxSelection: true, width: 44, minWidth: 44 },
    { colId: "rawIndex", headerName: "#", type: "index", width: 54, minWidth: 54 },
    { colId: "rawDrag", headerName: "", rowDrag: true, width: 42, minWidth: 42 },
    ...defaults, actionsColumn({ width: 90, actions: [] })
  ] });
  const before = api.columns.getState();
  const ordinary = new Set(["name", "note"]);
  for (const column of before.filter(column => !ordinary.has(column.colId))) {
    expect(host.querySelector(`.mach-header-cell[data-col-id="${column.colId}"] .mach-header-resize`)).toBeNull();
  }
  resize(1200);
  for (const column of before.filter(column => !ordinary.has(column.colId))) expect(width(api, column.colId)).toBe(column.width);
  expect(api.columns.getState().reduce((sum, column) => sum + column.width!, 0)).toBeCloseTo(1200);
  api.columns.setDefinitions([{ colId: "rawIndex", type: "index", headerName: "#", width: 54, minWidth: 54, resizable: true }, ...defaults]);
  expect(host.querySelector('.mach-header-cell[data-col-id="rawIndex"] .mach-header-resize')).not.toBeNull();
});

it("honors declared widths, opt-outs, suppressSizeToFit and max boundaries", () => {
  const { api, resize } = grid({ columnDefs: [
    { field: "id", width: 190 }, { colId: "disabled", field: "id", autoWidth: false },
    { colId: "suppressed", field: "id", suppressSizeToFit: true },
    { field: "name", maxWidth: 200 }, { field: "note" }
  ] });
  const fixed = ["id", "disabled", "suppressed"].map(id => width(api, id));
  resize(2000);
  expect(["id", "disabled", "suppressed"].map(id => width(api, id))).toEqual(fixed);
  expect(width(api, "name")).toBe(200);
  expect(api.columns.getState().reduce((sum, column) => sum + column.width!, 0)).toBeCloseTo(2000);
});

it("retains explicitly chosen flex weights instead of mixing in implicit weights", () => {
  const options: GridOptions<Row> = { columnDefs: [{ field: "name" }, { field: "note", flex: 1 }] };
  const normal = grid({ ...options, columnLayout: "normal" });
  const automatic = grid(options);
  expect(automatic.api.columns.getState()).toEqual(normal.api.columns.getState());
  const name = width(automatic.api, "name");
  automatic.resize(1000);
  expect(width(automatic.api, "name")).toBe(name);
  expect(width(automatic.api, "note")).toBeCloseTo(1000 - name);
});

it("isolates manual resizing, resumes responsive autosizing and accepts mode updates", () => {
  const { api, resize } = grid();
  const note = width(api, "note");
  api.columns.setWidth("name", 220);
  expect(width(api, "note")).toBe(note);
  resize(1000);
  expect(width(api, "name")).toBe(220);
  expect(width(api, "note")).toBeCloseTo(780);
  api.columns.autoSizeAll();
  expect(api.columns.getState().every(column => column.widthMode === "auto")).toBe(true);
  resize(1200);
  expect(width(api, "name") + width(api, "note")).toBeCloseTo(1200);
  api.updateOptions({ columnLayout: "normal" });
  expect(width(api, "name") + width(api, "note")).toBeLessThan(1200);
  api.updateOptions({ columnLayout: "auto" });
  expect(width(api, "name") + width(api, "note")).toBeCloseTo(1200);
});
