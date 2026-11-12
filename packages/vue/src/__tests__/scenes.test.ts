import { createApp, h, nextTick, shallowRef } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MachTable, MachTablePlugin, type MachTableVueExposed } from "../index";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
});
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

it("uses a default list beside independent detail grids without page option bundles", async () => {
  const host = document.createElement("main");
  document.body.append(host);
  const main = shallowRef<MachTableVueExposed | null>(null);
  const detail = shallowRef<MachTableVueExposed | null>(null);
  const rows = shallowRef([{ id: "a", name: "A" }, { id: "b", name: "B" }]);
  const columns = [{ field: "name", headerName: "实绩项目" }];
  const app = createApp({ render: () => h("section", [
    h(MachTable, { ref: main, rowKey: "id", columnDefs: columns, rowData: rows.value }),
    h(MachTable, { ref: detail, preset: "detail", rowKey: "id", columnDefs: columns, rowData: rows.value })
  ]) });
  app.use(MachTablePlugin, { defaults: { theme: "dark", size: "compact" } });
  app.mount(host);
  try {
    const primary = main.value!.getApi()!;
    const secondary = detail.value!.getApi()!;
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
    secondary.sorting.setModel([{ colId: "name", direction: "desc" }]);
    expect(primary.sorting.getModel()).toEqual([]);
    expect(secondary.rows.getAt(0)?.data?.name).toBe("B");
    expect(grids[1].querySelector(".mach-sort-indicator svg")).toBeNull();
    rows.value = [{ id: "c", name: "C" }];
    await nextTick();
    expect(primary.rows.getAt(0)?.data?.name).toBe("C");
    expect(secondary.rows.getAt(0)?.data?.name).toBe("C");
    expect(main.value!.getApi()).toBe(primary);
    expect(detail.value!.getApi()).toBe(secondary);
  } finally { app.unmount(); }
});

it("keeps explicit table overrides above detail and supports opting out of the default scene", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const selected = shallowRef<string | false | undefined>("detail");
  const table = shallowRef<MachTableVueExposed | null>(null);
  const app = createApp({ render: () => h(MachTable, {
    ref: table, preset: selected.value, columnDefs: [{ field: "id" }], rowData: [{ id: 1 }],
    rowNumber: false, columnMenu: true, defaultColDef: { filter: true, editable: true }
  }) });
  app.mount(host);
  try {
    const api = table.value!.getApi()!;
    expect(api.getOption("rowNumber")).toBe(false);
    expect(api.getOption("columnMenu")).toBe(true);
    expect(api.getOption("defaultColDef")?.filter).toBe(true);
    expect(api.getOption("defaultColDef")?.editable).toBe(true);
    selected.value = false;
    await nextTick();
    expect(table.value!.getApi()).toBe(api);
    expect(api.getOption("domLayout")).toBe("normal");
    expect(api.getOption("enableColumnResize")).toBe(false);
    expect(host.querySelector<HTMLElement>(".mach-pagination")!.style.display).not.toBe("none");
    selected.value = undefined;
    await nextTick();
    expect(api.getOption("enableColumnResize")).toBe(true);
    expect(api.getOption("domLayout")).toBe("normal");
    expect(api.getOption("rowNumber")).toBe(false);
  } finally { app.unmount(); }
});
