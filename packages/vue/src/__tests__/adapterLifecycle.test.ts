import { createApp, defineComponent, h, KeepAlive, nextTick, onUnmounted, ref, shallowRef } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GridApi } from "@agile-team/mach-table";
import { MachTable } from "../MachTable";
import { useMachTable, type UseMachTableReturn } from "../useMachTable";
import { vueCellRenderer } from "../adapters";

const apps: Array<ReturnType<typeof createApp>> = [];
const observers = new Set<ResizeObserver>();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

function mount(component: Parameters<typeof createApp>[0]) {
  const host = document.createElement("div");
  document.body.append(host);
  const app = createApp(component);
  apps.push(app);
  app.mount(host);
  return { app, host };
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() { observers.add(this as unknown as ResizeObserver); }
    disconnect() { observers.delete(this as unknown as ResizeObserver); }
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
});

afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  document.body.replaceChildren();
  observers.clear();
  vi.doUnmock("../MachTable");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Vue adapter lifecycle matrix", () => {
  it("recreates a conditional table with a current API and releases the previous observers", async () => {
    const visible = ref(true);
    let table!: UseMachTableReturn<{ id: string }>;
    const { host } = mount(defineComponent({
      setup() {
        table = useMachTable();
        return () => visible.value ? h(MachTable, {
          ref: table.ref, rowKey: "id", columnDefs: [{ field: "id" }],
          rowData: [{ id: "1" }], rowSelection: "multiple", pagination: false
        }) : null;
      }
    }));
    await vi.waitFor(() => expect(table.ready.value).toBe(true));
    const first = table.api.value!;
    first.selection.selectAll();
    expect(first.selection.getIds()).toEqual(["1"]);
    visible.value = false;
    await nextTick();
    expect(first.isDestroyed()).toBe(true);
    expect(table.api.value).toBeNull();
    expect(table.ready.value).toBe(false);
    expect(host.querySelector(".mach-root")).toBeNull();
    expect(observers.size).toBe(0);
    visible.value = true;
    await vi.waitFor(() => expect(table.ready.value).toBe(true));
    expect(table.api.value).not.toBe(first);
    expect(table.api.value?.selection.getIds()).toEqual([]);
    expect(host.querySelectorAll(".mach-root")).toHaveLength(1);
  });

  it("preserves a cached table's API, rows, dirty state and viewport while restoring layout without stealing focus", async () => {
    const visible = ref(true);
    let table!: UseMachTableReturn<{ id: string; name: string }>;
    const rows = Array.from({ length: 100 }, (_, index) => ({ id: String(index), name: `Row ${index}` }));
    const Page = defineComponent({
      setup() {
        table = useMachTable();
        return () => h(MachTable, {
          ref: table.ref, rowKey: "id", rowData: rows,
          columnDefs: [{ field: "name", editable: true, flex: 1 }],
          rowSelection: "multiple", columnLayout: "fit", pagination: false
        });
      }
    });
    const { host } = mount(defineComponent({
      setup: () => () => [h("input", { id: "outside-table" }), h(KeepAlive, null, {
        default: () => visible.value ? h(Page, { key: "table-page" }) : null
      })]
    }));
    await vi.waitFor(() => expect(table.ready.value).toBe(true));
    const api = table.api.value!;
    const root = api.view.getRoot()!;
    const body = root.querySelector<HTMLElement>(".mach-body")!;
    let width = 480;
    Object.defineProperty(body, "clientWidth", { configurable: true, get: () => width });
    api.view.refreshLayout();
    expect(api.columns.getWorkbenchItems()[0].width).toBe(480);
    api.editing.startCell({ rowIndex: 0, colId: "name" });
    root.querySelector<HTMLInputElement>(".mach-editor-input")!.value = "Committed change";
    await api.editing.stop();
    api.selection.setById("0", true);
    const viewport = root.querySelector<HTMLElement>(".mach-body-viewport--scroll")!;
    viewport.scrollTop = 360;
    viewport.dispatchEvent(new Event("scroll"));
    root.focus();
    api.columns.openWorkbench();
    expect(document.querySelector(".mach-column-panel")).toBeTruthy();
    visible.value = false;
    await nextTick();
    expect(api.isDestroyed()).toBe(false);
    expect(api.rows.getById("0")?.data?.name).toBe("Committed change");
    expect(api.editing.getDirtyRowIds()).toEqual(["0"]);
    expect(api.selection.getIds()).toEqual(["0"]);
    expect(viewport.scrollTop).toBe(360);
    expect(document.querySelector(".mach-column-panel")).toBeNull();
    expect(root.contains(document.activeElement)).toBe(false);
    const outside = host.querySelector<HTMLInputElement>("#outside-table")!;
    outside.focus();
    width = 720;
    visible.value = true;
    await nextTick();
    expect(table.api.value).toBe(api);
    expect(api.view.getRoot()).toBe(root);
    expect(api.columns.getWorkbenchItems()[0].width).toBe(720);
    expect(viewport.scrollTop).toBe(360);
    expect(document.activeElement).toBe(outside);
    expect(host.querySelectorAll(".mach-root")).toHaveLength(1);
  });

  it("releases renderer roots and active editors when column definitions are replaced", async () => {
    const cleanup = vi.fn();
    const Cell = defineComponent({
      setup() { onUnmounted(cleanup); return () => h("span", { class: "old-renderer" }, "old"); }
    });
    const columns = shallowRef<any[]>([{ field: "name", editable: true, cellRenderer: vueCellRenderer(Cell) }]);
    let table!: UseMachTableReturn<{ name: string; other: string }>;
    const { host } = mount(defineComponent({
      setup() {
        table = useMachTable();
        return () => h(MachTable, { ref: table.ref, columnDefs: columns.value, rowData: [{ name: "Original", other: "New column" }], pagination: false });
      }
    }));
    await nextTick();
    const api = table.api.value!;
    api.editing.startCell({ rowIndex: 0, colId: "name" });
    host.querySelector<HTMLInputElement>(".mach-editor-input")!.value = "Uncommitted";
    columns.value = [{ field: "other" }];
    await nextTick();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(table.api.value).toBe(api);
    expect(host.querySelector(".old-renderer")).toBeNull();
    expect(host.querySelector(".mach-editor-input")).toBeNull();
    expect(host.querySelector('[data-col-id="other"]')).toBeTruthy();
    expect(cleanup).toHaveBeenCalled();
    expect(api.rows.getAt(0)?.data?.name).toBe("Original");
  });

  it("removes an open filter and its portalled listbox when the component is unmounted", async () => {
    const { app, host } = mount({ render: () => h(MachTable, {
      columnDefs: [{ field: "name", filter: "text" }], rowData: [{ name: "one" }], pagination: false
    }) });
    host.querySelector<HTMLButtonElement>(".mach-filter-btn")!.click();
    document.querySelector<HTMLButtonElement>('.mach-filter-panel [role="combobox"]')!.click();
    expect(document.querySelector('[role="listbox"]')).toBeTruthy();
    apps.splice(apps.indexOf(app), 1);
    app.unmount();
    expect(document.querySelector(".mach-filter-panel")).toBeNull();
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(observers.size).toBe(0);
  });

  it.each(["unmount", "replace"] as const)("does not mount a stale async table after %s while its chunk is loading", async (action) => {
    const gate = deferred<void>();
    vi.resetModules();
    vi.doMock("../MachTable", async () => {
      await gate.promise;
      return vi.importActual("../MachTable");
    });
    const { createAsyncMachTable, preloadMachTable } = await import("../async");
    const AsyncTable = createAsyncMachTable({ delay: 0 });
    const visible = ref(true);
    const scenario = ref(1);
    const onReady = vi.fn();
    let table!: UseMachTableReturn<{ id: number }>;
    const { host } = mount(defineComponent({
      setup() {
        table = useMachTable();
        return () => visible.value ? h(AsyncTable, {
          key: scenario.value, ref: table.ref, pagination: false,
          columnDefs: [{ field: "id" }], rowData: [{ id: scenario.value }], onGridReady: onReady
        }) : null;
      }
    }));
    const loading = preloadMachTable();
    await nextTick();
    if (action === "unmount") visible.value = false;
    else scenario.value = 2;
    await nextTick();
    expect(table.api.value).toBeNull();
    gate.resolve();
    await loading;
    await nextTick();
    if (action === "unmount") {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      expect(onReady).not.toHaveBeenCalled();
      expect(table.api.value).toBeNull();
      expect(host.querySelector(".mach-root")).toBeNull();
      expect(observers.size).toBe(0);
    } else {
      await vi.waitFor(() => expect(table.ready.value).toBe(true));
      expect(onReady).toHaveBeenCalledOnce();
      expect(table.api.value?.rows.getAt(0)?.data?.id).toBe(2);
      expect(host.querySelectorAll(".mach-root")).toHaveLength(1);
    }
  });

  it("cleans partial construction after a mounted table fails and permits a fresh replacement", async () => {
    const failure = new Error("Observer failed during initial layout");
    const onError = vi.fn();
    const instance = ref<any>(null);
    const valid = ref(false);
    vi.stubGlobal("ResizeObserver", class {
      observe() {
        observers.add(this as unknown as ResizeObserver);
        if (!valid.value) throw failure;
      }
      disconnect() { observers.delete(this as unknown as ResizeObserver); }
    });
    const host = document.createElement("div");
    document.body.append(host);
    const app = createApp(defineComponent({
      setup: () => () => h(MachTable, {
        ref: instance, key: valid.value ? "valid" : "invalid", pagination: false,
        columnDefs: [{ field: "id", initialSort: "asc" }],
        rowData: [{ id: 2 }, { id: 1 }]
      })
    }));
    app.config.errorHandler = onError;
    apps.push(app);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    app.mount(host);
    await nextTick();
    expect(onError).toHaveBeenCalledWith(failure, expect.anything(), expect.anything());
    expect(instance.value.getApi()).toBeNull();
    expect(host.querySelector(".mach-root")).toBeNull();
    expect(observers.size).toBe(0);
    valid.value = true;
    await nextTick();
    const api = instance.value.getApi() as GridApi;
    expect(api.isDestroyed()).toBe(false);
    expect(api.rows.getAt(0)?.data?.id).toBe(1);
    expect(host.querySelectorAll(".mach-root")).toHaveLength(1);
  });
});
