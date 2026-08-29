import { createApp, defineComponent, h, nextTick, onUnmounted, ref, type GlobalComponents } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RobotGrid } from "../RobotGrid";
import { vueCellRenderer } from "../adapters";
import DefaultPlugin, { createGrid, DEFAULT_LOCALE, MachTable, MachTablePlugin, type ColDef } from "../index";
import { AsyncMachTable, AsyncMachTablePlugin, preloadMachTable } from "../async";
import { useMachTable, type UseMachTableReturn } from "../useMachTable";
import { useMachTableEditing, type UseMachTableEditingReturn } from "../useMachTableEditing";
import { useMachTableQuery, type UseMachTableQueryReturn } from "../useMachTableQuery";
import { defineMachTableConfig, provideMachTableConfig } from "../index";

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
  document.body.textContent = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Vue adapter", () => {
  it("re-exports the complete core API and types from its public entry", () => {
    const column: ColDef<{ id: number }> = { field: "id" };
    expect(column.field).toBe("id");
    expect(createGrid).toBeTypeOf("function");
    expect(DEFAULT_LOCALE.loading).toBeTruthy();
  });

  it("registers typed global components through app.use", () => {
    const app = createApp({ render: () => null });
    app.use(MachTablePlugin);
    const globallyTyped: GlobalComponents["MachTable"] = RobotGrid;

    expect(DefaultPlugin).toBe(MachTablePlugin);
    expect(globallyTyped).toBe(RobotGrid);
    expect(app.component("MachTable")).toBe(RobotGrid);
    expect(app.component("RobotGrid")).toBe(RobotGrid);
    expect(MachTable).toBe(RobotGrid);
  });

  it("applies plugin defaults and lets component props override them", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = createApp({
      render: () => h(MachTable, {
        theme: "light",
        columnDefs: [{ field: "id" }],
        rowData: [{ id: 1 }]
      })
    });
    app.use(MachTablePlugin, {
      defaults: { theme: "dark", pagination: false, defaultColDef: { sortable: false } }
    });
    app.mount(host);
    await nextTick();
    expect(host.querySelector(".mach-root")?.classList.contains("mach-theme-dark")).toBe(false);
    expect((host.querySelector(".mach-pagination") as HTMLElement).style.display).toBe("none");
    app.unmount();
  });

  it("loads a dedicated config with named presets and exposes option provenance", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const table = ref<any>(null);
    const config = defineMachTableConfig({
      defaults: {
        size: "compact",
        pagination: { pageSize: 20, pageSizeOptions: [20, 50] },
        defaultColDef: { sortable: false }
      },
      defaultPreset: "list",
      presets: {
        list: { stripedRows: true, pagination: { pageSize: 50 } },
        editable: { editType: "fullRow", defaultColDef: { editable: true } }
      }
    });
    const app = createApp({
      render: () => h(MachTable, {
        ref: table,
        preset: ["list", "editable"],
        columnDefs: [{ field: "id" }],
        rowData: [{ id: 1 }],
        size: "large"
      })
    });
    app.use(MachTablePlugin, config);
    app.mount(host);
    await nextTick();

    const resolved = table.value.getResolvedConfig();
    expect(resolved.size).toBe("large");
    expect(resolved.stripedRows).toBe(true);
    expect(resolved.pagination).toEqual({ pageSize: 50, pageSizeOptions: [20, 50] });
    expect(resolved.defaultColDef).toEqual({ sortable: false, editable: true });
    expect(table.value.explainOption("size")).toEqual(expect.objectContaining({ source: "table props", value: "large" }));
    expect(table.value.explainOption("editType")).toEqual(expect.objectContaining({ source: "preset:editable" }));
    app.unmount();
  });

  it("reacts to route-scoped configuration sources", async () => {
    const theme = ref<"light" | "dark">("light");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const Child = defineComponent({
      setup: () => () => h(MachTable, {
        columnDefs: [{ field: "id" }],
        rowData: [{ id: 1 }],
        pagination: false
      })
    });
    const Route = defineComponent({
      setup() {
        provideMachTableConfig(() => ({ defaults: { theme: theme.value } }));
        return () => h(Child);
      }
    });
    const app = createApp(Route);
    app.use(MachTablePlugin);
    app.mount(host);
    await nextTick();
    expect(host.querySelector(".mach-root")?.classList.contains("mach-theme-dark")).toBe(false);
    theme.value = "dark";
    await nextTick();
    expect(host.querySelector(".mach-root")?.classList.contains("mach-theme-dark")).toBe(true);
    app.unmount();
  });

  it("supports a configurable async global registration and explicit preloading", async () => {
    const app = createApp({ render: () => null });
    app.use(AsyncMachTablePlugin, {
      componentName: "BusinessTable",
      registerRobotGridAlias: false
    });

    expect(app.component("BusinessTable")).toBe(AsyncMachTable);
    expect(app.component("RobotGrid")).toBeUndefined();
    await expect(preloadMachTable()).resolves.toBe(RobotGrid);
  });

  it("does not silently overwrite an existing global component", () => {
    const app = createApp({ render: () => null });
    app.component("MachTable", defineComponent({ render: () => null }));
    expect(() => app.use(MachTablePlugin)).toThrow(/already in use/);
  });

  it("accepts datasource and forwards ordinary host attributes", async () => {
    const getRows = vi.fn((params: any) => params.onSuccess([{ id: 1 }], 1));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = createApp(defineComponent({
      render: () => h(RobotGrid, {
        id: "orders-grid",
        "aria-label": "orders",
        columnDefs: [{ field: "id" }],
        datasource: { getRows },
        pagination: false
      })
    }));
    app.mount(host);
    await nextTick();
    expect(getRows).toHaveBeenCalledOnce();
    expect(getRows.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
    expect(host.querySelector("#orders-grid")?.getAttribute("aria-label")).toBe("orders");
    app.unmount();
  });

  it("reactively updates theme and row data", async () => {
    const rows = ref([{ id: 1 }]);
    const theme = ref<"light" | "dark">("light");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = createApp(defineComponent({
      setup: () => () => h(RobotGrid, {
        columnDefs: [{ field: "id" }],
        rowData: rows.value,
        theme: theme.value,
        pagination: false
      })
    }));
    app.mount(host);
    rows.value = [{ id: 2 }, { id: 3 }];
    theme.value = "dark";
    await nextTick();
    expect(host.querySelector(".mach-root")?.classList.contains("mach-theme-dark")).toBe(true);
    expect(host.querySelectorAll(".mach-row[data-index]").length).toBeGreaterThanOrEqual(2);
    app.unmount();
  });

  it("unmounts Vue cell components when the grid is destroyed", async () => {
    const mounted = vi.fn();
    const cleanup = vi.fn();
    const Cell = defineComponent({
      setup() {
        mounted();
        onUnmounted(cleanup);
        return () => h("span", "cell");
      }
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = createApp({
      render: () => h(RobotGrid, {
        columnDefs: [{ field: "id", cellRenderer: vueCellRenderer(Cell) }],
        rowData: [{ id: 1 }],
        pagination: false
      })
    });
    app.mount(host);
    await nextTick();
    app.unmount();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(mounted).toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(mounted.mock.calls.length);
  });

  it("maps native Vue cell, header, editor and overlay slots without renderer factories", async () => {
    const rows = ref([{ id: 1, name: "before" }]);
    const loading = ref(true);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = createApp(defineComponent({
      setup: () => () => h(MachTable, {
        columnDefs: [{ field: "name", editable: true }],
        rowData: rows.value,
        loading: loading.value,
        pagination: false
      }, {
        "cell-name": (props: any) => h("strong", { class: "slot-cell" }, props.value),
        "header-name": () => h("span", { class: "slot-header" }, "业务名称"),
        "editor-name": (props: any) => h("input", {
          class: "slot-editor",
          value: props.value,
          onInput: (event: Event) => props.setValue((event.target as HTMLInputElement).value)
        }),
        loading: () => h("span", { class: "slot-loading" }, "正在读取")
      })
    }));
    app.use(MachTablePlugin);
    app.mount(host);
    await nextTick();
    expect(host.querySelector(".slot-header")?.textContent).toBe("业务名称");
    expect(host.querySelector(".slot-loading")?.textContent).toBe("正在读取");

    loading.value = false;
    await nextTick();
    const cell = host.querySelector<HTMLElement>(".mach-cell[data-col-id='name']")!;
    expect(cell.querySelector(".slot-cell")?.textContent).toBe("before");
    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const input = cell.querySelector<HTMLInputElement>(".slot-editor")!;
    input.value = "after";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(rows.value[0].name).toBe("after");
    app.unmount();
  });

  it("unmounts Vue overlay slots when an overlay is replaced", async () => {
    const cleanup = vi.fn();
    const loading = ref(true);
    const Overlay = defineComponent({
      setup() {
        onUnmounted(cleanup);
        return () => h("span", "loading");
      }
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = createApp(defineComponent({
      setup: () => () => h(MachTable, {
        columnDefs: [{ field: "id" }],
        rowData: [{ id: 1 }],
        loading: loading.value,
        pagination: false
      }, { loading: () => h(Overlay) })
    }));
    app.use(MachTablePlugin);
    app.mount(host);
    await nextTick();
    loading.value = false;
    await nextTick();
    expect(cleanup).toHaveBeenCalledOnce();
    app.unmount();
  });

  it("reactively forwards structural options, datasource and inner grid class", async () => {
    const datasource = ref<any>(undefined);
    const gridClassName = ref("before");
    const treeData = ref(false);
    const getRows = vi.fn((params: any) => params.onSuccess([{ id: 2 }], 1));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = createApp(defineComponent({
      setup: () => () => h(RobotGrid, {
        columnDefs: [{ field: "id" }],
        rowData: [{ id: 1 }],
        pagination: false,
        gridClassName: gridClassName.value,
        datasource: datasource.value,
        treeData: treeData.value,
        childrenKey: "items"
      })
    }));
    app.mount(host);
    await nextTick();
    const gridRoot = host.querySelector(".mach-root")!;
    expect(gridRoot.classList.contains("before")).toBe(true);

    datasource.value = { getRows };
    gridClassName.value = "after";
    treeData.value = true;
    await nextTick();
    expect(getRows).toHaveBeenCalledOnce();
    expect(gridRoot.classList.contains("before")).toBe(false);
    expect(gridRoot.classList.contains("after")).toBe(true);
    app.unmount();
  });

  it("exposes reactive API and readiness through useMachTable", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    let grid: UseMachTableReturn<{ id: number }> | null = null;
    const app = createApp(defineComponent({
      setup() {
        grid = useMachTable<{ id: number }>();
        return () => h(RobotGrid, {
          ref: grid!.ref,
          columnDefs: [{ field: "id" }],
          rowData: [{ id: 1 }],
          pagination: false
        });
      }
    }));
    app.mount(host);
    await nextTick();
    await nextTick();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(grid!.ready.value).toBe(true);
    expect(grid!.api.value?.getDisplayedRowCount()).toBe(1);
    app.unmount();
    await nextTick();
    expect(grid!.ready.value).toBe(false);
  });

  it("provides a reactive save, partial-success and rollback workflow", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    let grid: UseMachTableReturn<{ id: string; name: string }> | null = null;
    let editing: UseMachTableEditingReturn<{ id: string; name: string }> | null = null;
    const app = createApp(defineComponent({
      setup() {
        grid = useMachTable();
        editing = useMachTableEditing(grid, { guardBeforeUnload: true });
        return () => h(RobotGrid, {
          ref: grid!.ref,
          columnDefs: [{ field: "name", editable: true }],
          rowData: [{ id: "1", name: "one" }, { id: "2", name: "two" }],
          getRowId: ({ data }: any) => data.id,
          pagination: false
        });
      }
    }));
    app.mount(host);
    await nextTick();
    await nextTick();
    for (let rowIndex = 0; rowIndex < 2; rowIndex++) {
      grid!.api.value!.startEditingCell({ rowIndex, colId: "name" });
      (host.querySelector(".mach-editor-input") as HTMLInputElement).value = `changed-${rowIndex}`;
      await grid!.api.value!.stopEditingAsync();
    }
    expect(editing!.dirty.value).toBe(true);
    expect(editing!.dirtyRowIds.value).toEqual(["1", "2"]);
    const saved = await editing!.save(async () => ({ savedRowIds: ["1"] }));
    expect(saved.map((change) => change.rowId)).toEqual(["1"]);
    expect(editing!.dirtyRowIds.value).toEqual(["2"]);
    expect(editing!.reveal("2", "name")).toBe(true);
    expect(editing!.rollback()).toBe(true);
    expect(editing!.dirty.value).toBe(false);
    app.unmount();
  });

  it("cancels stale remote queries and ignores late responses", async () => {
    const query = ref({ keyword: "first" });
    const pending: Array<{
      signal: AbortSignal;
      resolve: (value: { rows: { id: string }[]; total: number }) => void;
    }> = [];
    const request = vi.fn((params: any) => new Promise<{ rows: { id: string }[]; total: number }>((resolve) => {
      pending.push({ signal: params.signal, resolve });
    }));
    let remote: UseMachTableQueryReturn<{ id: string }> | null = null;
    const host = document.createElement("div");
    const app = createApp(defineComponent({
      setup() {
        remote = useMachTableQuery({ request, query, rowKey: "id" });
        return () => h("div");
      }
    }));
    app.mount(host);
    expect(request).toHaveBeenCalledOnce();
    query.value = { keyword: "second" };
    await nextTick();
    expect(request).toHaveBeenCalledTimes(2);
    expect(pending[0].signal.aborted).toBe(true);

    pending[1].resolve({ rows: [{ id: "new" }], total: 1 });
    await Promise.resolve();
    await nextTick();
    expect(remote!.rows.value).toEqual([{ id: "new" }]);
    pending[0].resolve({ rows: [{ id: "stale" }], total: 1 });
    await Promise.resolve();
    expect(remote!.rows.value).toEqual([{ id: "new" }]);
    app.unmount();
  });

  it("drives server pagination and preserves selected rows across pages", async () => {
    const requests: Array<{ page: number; resolve: (value: any) => void }> = [];
    let remote: UseMachTableQueryReturn<{ id: string; name: string }> | null = null;
    const host = document.createElement("div");
    const app = createApp(defineComponent({
      setup() {
        remote = useMachTableQuery({
          query: {},
          rowKey: "id",
          selectionScope: "preserve",
          request: (params) => new Promise((resolve) => requests.push({ page: params.page, resolve }))
        });
        return () => h("div");
      }
    }));
    app.mount(host);
    requests[0].resolve({ rows: [{ id: "1", name: "one" }], total: 21 });
    await Promise.resolve();
    await nextTick();
    remote!.gridProps.value.onSelectionChanged?.({ selectedRows: remote!.rows.value } as any);
    expect(remote!.selectedKeys.value).toEqual(["1"]);

    remote!.gridProps.value.onPaginationChanged?.({ page: 2, pageSize: 20 } as any);
    expect(requests[1].page).toBe(2);
    requests[1].resolve({ rows: [{ id: "2", name: "two" }], total: 21 });
    await Promise.resolve();
    await nextTick();
    remote!.gridProps.value.onSelectionChanged?.({ selectedRows: remote!.rows.value } as any);
    expect(remote!.selectedKeys.value).toEqual(["1", "2"]);
    expect(remote!.selectedRows.value.map((row) => row.name)).toEqual(["one", "two"]);
    app.unmount();
  });
});
