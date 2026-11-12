import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MachTable, MachTableProvider, type GridApi } from "../index";

interface SceneRow { id: string; name: string }

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

it("uses the same default list and detail scenes without a provider configuration", async () => {
  const host = document.createElement("main");
  document.body.append(host);
  const root = createRoot(host);
  const main = { current: null as GridApi | null };
  const detail = { current: null as GridApi | null };
  const columns = [{ field: "name", headerName: "实绩项目" }];
  const render = (rows: { id: string; name: string }[]) => root.render(createElement(MachTableProvider, {
    config: { defaults: { theme: "dark", size: "compact" } }
  }, createElement("section", null,
    createElement(MachTable<SceneRow>, { apiRef: main, rowKey: "id", columnDefs: columns, rowData: rows }),
    createElement(MachTable<SceneRow>, { apiRef: detail, preset: "detail", rowKey: "id", columnDefs: columns, rowData: rows })
  )));
  try {
    await act(async () => render([{ id: "a", name: "A" }, { id: "b", name: "B" }]));
    const primary = main.current!;
    const secondary = detail.current!;
    expect(primary.getOption("columnMenu")).toBe(true);
    expect(primary.getOption("enableColumnResize")).toBe(true);
    expect(primary.getOption("rowNumber")).toBe(true);
    expect(secondary.getOption("columnMenu")).toBe(false);
    expect(secondary.getOption("domLayout")).toBe("autoHeight");
    expect(secondary.getOption("maxBodyHeight")).toBe(330);
    const grids = [...host.querySelectorAll<HTMLElement>(".mach-root")];
    expect(grids.every(grid => grid.classList.contains("mach-theme-dark"))).toBe(true);
    expect(grids.every(grid => grid.classList.contains("mach-size--compact"))).toBe(true);
    expect(grids[0].querySelectorAll(".mach-filter-btn, .mach-menu-btn").length).toBeGreaterThan(0);
    expect(grids[1].querySelector(".mach-filter-btn, .mach-menu-btn, .mach-header-resize")).toBeNull();
    expect(grids[1].querySelector<HTMLElement>(".mach-pagination")!.style.display).toBe("none");
    await act(async () => secondary.sorting.setModel([{ colId: "name", direction: "desc" }]));
    expect(primary.sorting.getModel()).toEqual([]);
    expect(secondary.rows.getAt(0)?.data?.name).toBe("B");
    expect(grids[1].querySelector(".mach-sort-indicator svg")).toBeNull();
    await act(async () => render([{ id: "c", name: "C" }]));
    expect(primary.rows.getAt(0)?.data?.name).toBe("C");
    expect(secondary.rows.getAt(0)?.data?.name).toBe("C");
    expect(main.current).toBe(primary);
    expect(detail.current).toBe(secondary);
  } finally { await act(async () => root.unmount()); }
});

it("restores list defaults after detail and keeps explicit props authoritative", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const apiRef = { current: null as GridApi | null };
  const columns = [{ field: "id" }];
  const rows = [{ id: 1 }];
  const render = (preset: string | false | undefined) => root.render(createElement(MachTable, {
    apiRef, preset, columnDefs: columns, rowData: rows, rowNumber: false,
    defaultColDef: { filter: true, editable: true }
  }));
  try {
    await act(async () => render("detail"));
    const api = apiRef.current!;
    expect(api.getOption("domLayout")).toBe("autoHeight");
    expect(api.getOption("rowNumber")).toBe(false);
    expect(api.getOption("defaultColDef")?.editable).toBe(true);
    await act(async () => render(false));
    expect(apiRef.current).toBe(api);
    expect(api.getOption("domLayout")).toBe("normal");
    expect(api.getOption("enableColumnResize")).toBe(false);
    expect(host.querySelector<HTMLElement>(".mach-pagination")!.style.display).not.toBe("none");
    await act(async () => render(undefined));
    expect(api.getOption("enableColumnResize")).toBe(true);
    expect(api.getOption("rowNumber")).toBe(false);
  } finally { await act(async () => root.unmount()); }
});
