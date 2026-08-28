import { createApp, defineComponent, h, nextTick, onUnmounted, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RobotGrid } from "../RobotGrid";
import { vueCellRenderer } from "../adapters";
import { useMachTable, type UseMachTableReturn } from "../useMachTable";

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
    expect(grid!.ready.value).toBe(true);
    expect(grid!.api.value?.getDisplayedRowCount()).toBe(1);
    app.unmount();
    await nextTick();
    expect(grid!.ready.value).toBe(false);
  });
});
