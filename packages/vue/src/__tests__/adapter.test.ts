import { createApp, defineComponent, h, nextTick, onUnmounted, ref, shallowRef, type GlobalComponents } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RobotGrid } from "../MachTable";
import { vueCellRenderer } from "../adapters";
import { createElementPlusEditors, vueCellEditor } from "../editors";
import DefaultPlugin, {
  createGrid,
  DEFAULT_LOCALE,
  MachTable,
  MachTablePlugin,
  type ColDef,
  type GridApi,
  type MachTableCommands
} from "../index";
import { MachTableToolbar, MachTableUiPlugin } from "../ui";
import { AsyncMachTable, AsyncMachTablePlugin, preloadMachTable } from "../async";
import { useMachTable, type UseMachTableReturn } from "../useMachTable";
import { useMachTableEditing, type UseMachTableEditingReturn } from "../useMachTableEditing";
import { useMachTableQuery, type UseMachTableQueryReturn } from "../useMachTableQuery";
import { useMachTableController, type UseMachTableControllerReturn } from "../useMachTableController";
import { defineMachTableConfig, provideMachTableConfig } from "../index";
import {
  mergeMachTableConfig,
  normalizeMachTableConfig,
  resolveMachTableGridOptions
} from "../configuration";

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

  it("adapts v-model components into lifecycle-safe cell editors", async () => {
    const Input = defineComponent({
      props: { modelValue: String },
      emits: ["update:modelValue"],
      setup(props, { emit }) {
        return () => h("input", {
          class: "vue-model-editor",
          value: props.modelValue,
          onInput: (event: Event) => emit("update:modelValue", (event.target as HTMLInputElement).value)
        });
      }
    });
    const factory = vueCellEditor(Input, {
      className: "business-editor",
      props: { style: "color: rgb(255, 0, 0)" }
    });
    const editor = factory({ value: "before" } as any);
    document.body.appendChild(editor.el);
    await nextTick();
    const input = editor.el.querySelector<HTMLInputElement>("input")!;
    input.value = "after";
    input.dispatchEvent(new Event("input"));
    await nextTick();
    expect(editor.getValue()).toBe("after");
    expect(editor.el.classList.contains("business-editor")).toBe(true);
    expect(input.style.width).toBe("100%");
    expect(input.style.color).toBe("rgb(255, 0, 0)");
    editor.focus?.();
    expect(document.activeElement).toBe(input);
    editor.destroy?.();
  });

  it("creates optional Element Plus editor presets without importing Element Plus", () => {
    const Control = defineComponent({ render: () => h("input") });
    const editors = createElementPlusEditors({
      input: Control,
      inputNumber: Control,
      select: Control,
      datePicker: Control
    });
    expect(editors.input).toBeTypeOf("function");
    expect(editors.number).toBeTypeOf("function");
    expect(editors.select).toBeTypeOf("function");
    expect(editors.date).toBeTypeOf("function");
  });

  it("registers typed global components through app.use", () => {
    const app = createApp({ render: () => null });
    app.use(MachTablePlugin);
    app.use(MachTableUiPlugin);
    const globallyTyped: GlobalComponents["MachTable"] = RobotGrid;

    expect(DefaultPlugin).toBe(MachTablePlugin);
    expect(globallyTyped).toBe(RobotGrid);
    expect(app.component("MachTable")).toBe(RobotGrid);
    expect(app.component("RobotGrid")).toBe(RobotGrid);
    expect(app.component("MachTableToolbar")).toBe(MachTableToolbar);
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

  it("merges scoped config, reports invalid presets and explains built-in values", () => {
    const inheritedWarning = vi.fn();
    const parent = normalizeMachTableConfig({
      defaults: { theme: "light", defaultColDef: { sortable: false } },
      presets: { list: { stripedRows: true, defaultColDef: { resizable: false } } },
      defaultPreset: "list",
      onConfigWarning: inheritedWarning
    });
    const merged = mergeMachTableConfig(parent, {
      defaults: { size: "compact" },
      presets: {
        list: { defaultColDef: { editable: false } },
        editable: { editType: "fullRow" }
      }
    });
    const resolved = resolveMachTableGridOptions(
      merged,
      ["", "missing", "list", "editable"],
      { size: "large" }
    );

    expect(inheritedWarning).toHaveBeenCalledWith(expect.objectContaining({ code: "UNKNOWN_PRESET", preset: "missing" }));
    expect(resolved.options.defaultColDef).toEqual({ sortable: false, resizable: false, editable: false });
    expect(resolved.options.editType).toBe("fullRow");
    expect(resolved.explain("size")).toEqual(expect.objectContaining({ source: "table props", value: "large" }));
    expect(resolved.explain("rowHeight")).toEqual(expect.objectContaining({ source: "MachTable built-in" }));

    const reportWarning = vi.fn();
    resolveMachTableGridOptions(merged, "unknown", {}, reportWarning);
    expect(reportWarning).toHaveBeenCalledOnce();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    resolveMachTableGridOptions(normalizeMachTableConfig(), "unknown", {});
    expect(warn).toHaveBeenCalledOnce();
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
      render: () => h(MachTable, {
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
      setup: () => () => h(MachTable, {
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
      render: () => h(MachTable, {
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
      setup: () => () => h(MachTable, {
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
        return () => h(MachTable, {
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
        return () => h(MachTable, {
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

  it("guards editing failures, concurrent saves and before-unload cleanup", async () => {
    let resolveSave!: (value: any[]) => void;
    const saveChanges = vi.fn(() => new Promise<any[]>((resolve) => { resolveSave = resolve; }));
    const removeDirtyListener = vi.fn();
    const api = {
      isDestroyed: () => false,
      getDirtyRowIds: () => ["1"],
      getChanges: () => [{ rowId: "1", colId: "name", oldValue: "before", newValue: "after" }],
      addEventListener: vi.fn(() => removeDirtyListener),
      saveChanges,
      rollbackChanges: vi.fn(() => true),
      markChangesSaved: vi.fn(),
      getNodeById: vi.fn(() => null),
      scrollToIndex: vi.fn(),
      startEditingCell: vi.fn()
    };
    const table = { api: shallowRef<any>(api) } as UseMachTableReturn<any>;
    const onSaveError = vi.fn();
    let editing: UseMachTableEditingReturn<any> | null = null;
    const host = document.createElement("div");
    const app = createApp(defineComponent({
      setup() {
        editing = useMachTableEditing(table, {
          guardBeforeUnload: true,
          beforeUnloadMessage: "请先保存",
          onSaveError
        });
        return () => h("div");
      }
    }));
    app.mount(host);

    const unload = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    const pendingSave = editing!.save(saveChanges as any);
    await expect(editing!.save(saveChanges as any)).rejects.toThrow(/already in progress/);
    resolveSave([]);
    await expect(pendingSave).resolves.toEqual([]);
    expect(editing!.reveal("missing", "name", true)).toBe(false);
    expect(editing!.rollback(["1"])).toBe(true);
    editing!.markSaved(["1"]);
    expect(api.markChangesSaved).toHaveBeenCalledWith(["1"]);

    api.saveChanges = vi.fn().mockRejectedValue(new Error("save failed"));
    await expect(editing!.save(api.saveChanges as any)).rejects.toThrow("save failed");
    expect(onSaveError).toHaveBeenCalledOnce();
    expect(editing!.saveError.value).toBeInstanceOf(Error);
    table.api.value = null;
    await nextTick();
    await expect(editing!.save(saveChanges as any)).rejects.toThrow(/grid is ready/);
    app.unmount();
    expect(removeDirtyListener).toHaveBeenCalled();
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

  it("represents select-all matching as compact server rules", async () => {
    const requests: Array<{ page: number; resolve: (value: any) => void }> = [];
    let remote: UseMachTableQueryReturn<{ id: string }> | null = null;
    const host = document.createElement("div");
    const app = createApp(defineComponent({
      setup() {
        remote = useMachTableQuery({
          query: {},
          rowKey: "id",
          selectionScope: "query",
          request: (params) => new Promise((resolve) => requests.push({ page: params.page, resolve }))
        });
        return () => h("div");
      }
    }));
    app.mount(host);
    requests[0].resolve({ rows: [{ id: "1" }, { id: "2" }], total: 1_000_000 });
    await Promise.resolve();
    await nextTick();
    remote!.selectAllMatching();
    expect(remote!.selectionState.value).toEqual({ mode: "allMatching", excludedKeys: [] });
    expect(remote!.selectedKeys.value).toEqual([]);

    remote!.gridProps.value.onSelectionChanged?.({ selectedRows: [{ id: "2" }] } as any);
    expect(remote!.selectionState.value).toEqual({ mode: "allMatching", excludedKeys: ["1"] });
    expect(remote!.selectedRows.value).toEqual([{ id: "2" }]);

    remote!.applySelectionState({ mode: "explicit", selectedKeys: ["1"] });
    expect(remote!.selectionState.value).toEqual({ mode: "explicit", selectedKeys: ["1"] });
    expect(remote!.selectedKeys.value).toEqual(["1"]);
    app.unmount();
  });

  it("surfaces remote validation failures and supports explicit retry and abort", async () => {
    const onError = vi.fn();
    const requests = [
      () => Promise.reject(new Error("offline")),
      () => Promise.resolve({ rows: null, total: -1 }),
      () => Promise.resolve({ rows: [{ id: "1" }], total: 1 }),
      ({ signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })
    ];
    const request = vi.fn((params: any): Promise<{ rows: { id: string }[]; total: number }> => (
      requests.shift()!(params) as Promise<{ rows: { id: string }[]; total: number }>
    ));
    let remote: UseMachTableQueryReturn<{ id: string }> | null = null;
    const host = document.createElement("div");
    const app = createApp(defineComponent({
      setup() {
        remote = useMachTableQuery({
          query: () => ({ keyword: "x" }),
          rowKey: (row) => row.id,
          request,
          immediate: false,
          initialPage: 0,
          pageSize: Number.NaN,
          pageSizeOptions: [0, 20, 20],
          keepPreviousData: false,
          onError
        });
        return () => h("div");
      }
    }));
    app.mount(host);
    expect(request).not.toHaveBeenCalled();
    expect(remote!.page.value).toBe(1);
    expect(remote!.pageSize.value).toBe(20);

    await remote!.reload();
    expect(remote!.error.value).toEqual(expect.objectContaining({ message: "offline" }));
    const errorOverlay = remote!.gridProps.value.overlayErrorTemplate as () => string;
    expect(errorOverlay()).toContain("Remote request failed");
    await remote!.retry();
    expect(remote!.error.value).toBeInstanceOf(TypeError);
    await remote!.reload({ resetPage: true });
    expect(remote!.rows.value).toEqual([{ id: "1" }]);
    expect(onError).toHaveBeenCalledTimes(2);

    const pending = remote!.reload();
    expect(remote!.rows.value).toEqual([]);
    expect(remote!.loading.value).toBe(true);
    remote!.abort();
    await pending;
    expect(remote!.loading.value).toBe(false);
    expect(remote!.error.value).toBeNull();
    app.unmount();
  });

  it("handles server sort, filter, page selection and controlled selected keys", async () => {
    const query = ref({ status: "all" });
    const quickFilterText = ref<string | null>(null);
    const request = vi.fn(async ({ page }: { page: number }) => ({
      rows: [{ id: String(page), name: `row-${page}` }],
      total: 40
    }));
    let remote: UseMachTableQueryReturn<{ id: string; name: string }> | null = null;
    const host = document.createElement("div");
    const app = createApp(defineComponent({
      setup() {
        remote = useMachTableQuery({
          query,
          quickFilterText,
          rowKey: "id",
          request,
          selectionScope: "page",
          clearSelectionOnQueryChange: false,
          debounceMs: -1
        });
        return () => h("div");
      }
    }));
    app.mount(host);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    remote!.gridProps.value.onPaginationChanged?.({ page: 1, pageSize: 20 } as any);
    expect(request).toHaveBeenCalledTimes(1);

    remote!.gridProps.value.onSelectionChanged?.({ selectedRows: remote!.rows.value } as any);
    expect(remote!.selectedKeys.value).toEqual(["1"]);
    remote!.selectedKeys.value = [];
    expect(remote!.selectedRows.value).toEqual([]);

    remote!.gridProps.value.onSortChanged?.({ sortModel: [{ colId: "name", sort: "asc" }] } as any);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    remote!.gridProps.value.onFilterChanged?.({ filterModel: { name: { type: "contains", filter: "x" } } } as any);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    quickFilterText.value = "fast";
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(4));
    query.value = { status: "enabled" };
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(5));
    await remote!.reset();
    expect(remote!.sortModel.value).toEqual([]);
    expect(remote!.filterModel.value).toEqual({});
    expect(request).toHaveBeenCalledTimes(6);
    app.unmount();
  });

  it("supports manual query mode without hidden network requests", async () => {
    const query = ref({ keyword: "before" });
    const request = vi.fn(async ({ query: criteria }: { query: { keyword: string } }) => ({
      rows: [{ id: criteria.keyword }],
      total: 1
    }));
    let remote: UseMachTableQueryReturn<{ id: string }> | null = null;
    const host = document.createElement("div");
    const app = createApp(defineComponent({
      setup() {
        remote = useMachTableQuery({ query, request, rowKey: "id", mode: "manual" });
        return () => h("div");
      }
    }));
    app.mount(host);
    expect(request).not.toHaveBeenCalled();
    query.value = { keyword: "after" };
    await nextTick();
    remote!.gridProps.value.onSortChanged?.({ sortModel: [{ colId: "id", sort: "asc" }] } as any);
    await nextTick();
    expect(request).not.toHaveBeenCalled();
    await remote!.reload();
    expect(request).toHaveBeenCalledOnce();
    expect(remote!.rows.value).toEqual([{ id: "after" }]);
    app.unmount();
  });

  it("wires the optional toolbar to commands, API fallbacks, events and slots", async () => {
    const commands = {
      search: vi.fn(), refresh: vi.fn(async () => undefined), openColumns: vi.fn(), setDensity: vi.fn(),
      resetColumns: vi.fn(), undo: vi.fn(() => true), redo: vi.fn(() => true),
      canUndo: vi.fn(() => true), canRedo: vi.fn(() => true), exportCsv: vi.fn(() => true),
      toggleFullscreen: vi.fn(async () => true)
    } satisfies MachTableCommands;
    const model = ref("");
    const clear = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = createApp(defineComponent({
      setup: () => () => h(MachTableToolbar, {
        commands,
        modelValue: model.value,
        selectedCount: 3,
        features: { undoRedo: true, fullscreen: true },
        "onUpdate:modelValue": (value: string) => { model.value = value; },
        onClearSelection: clear
      }, {
        start: () => h("span", { id: "start" }, "start"),
        default: () => h("span", { id: "middle" }, "middle"),
        end: () => h("span", { id: "end" }, "end")
      })
    }));
    app.mount(host);
    const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    input.value = "orders";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const density = host.querySelector<HTMLSelectElement>("select")!;
    density.value = "compact";
    density.dispatchEvent(new Event("change", { bubbles: true }));
    for (const button of host.querySelectorAll<HTMLButtonElement>("button")) button.click();
    await nextTick();
    expect(commands.search).toHaveBeenCalledWith("orders");
    expect(commands.refresh).toHaveBeenCalledOnce();
    expect(commands.openColumns).toHaveBeenCalledOnce();
    expect(commands.setDensity).toHaveBeenCalledWith("compact");
    expect(commands.undo).toHaveBeenCalledOnce();
    expect(commands.redo).toHaveBeenCalledOnce();
    expect(commands.exportCsv).toHaveBeenCalledOnce();
    expect(commands.toggleFullscreen).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledOnce();
    expect(model.value).toBe("orders");
    expect(host.querySelector("#start")).toBeTruthy();
    expect(host.querySelector("#middle")).toBeTruthy();
    expect(host.querySelector("#end")).toBeTruthy();
    app.unmount();

    const api = {
      getGridOption: vi.fn(() => "normal"),
      setQuickFilter: vi.fn(),
      isInfinite: vi.fn(() => false),
      refreshCells: vi.fn(),
      openColumnWorkbench: vi.fn(),
      setGridOption: vi.fn(),
      canUndo: vi.fn(() => true),
      canRedo: vi.fn(() => true),
      undo: vi.fn(() => true),
      redo: vi.fn(() => true)
    } as unknown as GridApi;
    const fallbackHost = document.createElement("div");
    document.body.appendChild(fallbackHost);
    const fallbackApp = createApp({
      render: () => h(MachTableToolbar, {
        api,
        modelValue: "",
        selectedCount: 1,
        features: { undoRedo: true, fullscreen: true }
      })
    });
    fallbackApp.mount(fallbackHost);
    const fallbackInput = fallbackHost.querySelector<HTMLInputElement>('input[type="search"]')!;
    fallbackInput.value = "local";
    fallbackInput.dispatchEvent(new Event("input", { bubbles: true }));
    const fallbackDensity = fallbackHost.querySelector<HTMLSelectElement>("select")!;
    fallbackDensity.value = "large";
    fallbackDensity.dispatchEvent(new Event("change", { bubbles: true }));
    for (const button of fallbackHost.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")) button.click();
    expect(api.setQuickFilter).toHaveBeenCalledWith("local");
    expect(api.refreshCells).toHaveBeenCalledOnce();
    expect(api.openColumnWorkbench).toHaveBeenCalledOnce();
    expect(api.setGridOption).toHaveBeenCalledWith("size", "large");
    expect(api.undo).toHaveBeenCalledOnce();
    expect(api.redo).toHaveBeenCalledOnce();
    fallbackApp.unmount();
  });

  it("composes local and remote Vue controllers with one command surface", async () => {
    let local: UseMachTableControllerReturn<{ id: string; name: string }> | null = null;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = createApp(defineComponent({
      setup() {
        local = useMachTableController();
        return () => h(MachTable, {
          ref: local!.table.ref,
          columnDefs: [{ field: "name" }],
          rowData: [{ id: "1", name: "Ada" }],
          rowKey: "id",
          rowSelection: "multiple",
          pagination: false
        });
      }
    }));
    app.mount(host);
    await nextTick();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    local!.search.value = "Ada";
    await nextTick();
    expect(local!.table.api.value?.getGridOption("quickFilterText")).toBe("Ada");
    local!.table.api.value?.selectAll();
    await nextTick();
    expect(local!.selectedCount.value).toBe(1);
    await local!.reload();
    local!.commands.setDensity("compact");
    expect(local!.table.api.value?.getGridOption("size")).toBe("compact");
    expect(local!.busy.value).toBe(false);
    expect(local!.error.value).toBeNull();
    app.unmount();

    const request = vi.fn(async () => ({ rows: [{ id: "2" }], total: 1 }));
    let remote: UseMachTableControllerReturn<{ id: string }> | null = null;
    const remoteHost = document.createElement("div");
    document.body.appendChild(remoteHost);
    const remoteApp = createApp(defineComponent({
      setup() {
        remote = useMachTableController({
          query: { query: {}, rowKey: "id", request, mode: "manual" }
        });
        return () => h(MachTable, {
          ref: remote!.table.ref,
          columnDefs: [{ field: "id" }],
          ...remote!.bindings.value
        });
      }
    }));
    remoteApp.mount(remoteHost);
    expect(request).not.toHaveBeenCalled();
    await remote!.commands.refresh();
    await nextTick();
    expect(request).toHaveBeenCalledOnce();
    expect(remote!.query?.rows.value).toEqual([{ id: "2" }]);
    remote!.query?.selectAllMatching();
    await nextTick();
    expect(remote!.selectedCount.value).toBe(1);
    remoteApp.unmount();
  });
});
