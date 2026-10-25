import { createApp, defineComponent, h, nextTick, shallowRef } from "vue";
import { afterEach, expect, it, vi } from "vitest";
import { dragColumn, type ColDef, type GridApi } from "@agile-team/mach-table";
import { createRowOrderController } from "../../../core/src/ordering";
import { MachTable } from "../MachTable";

interface Row { id: string; name: string }
let unmount = () => {};
afterEach(() => { unmount(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("keeps optimistic ordering and undo ownership across the controlled Vue rowData flush", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  const rows = shallowRef<Row[]>([{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }]);
  const columns: ColDef<Row>[] = [dragColumn(), { field: "name" }];
  let api!: GridApi<Row>;
  const saves: string[] = [];
  const ordering = createRowOrderController<Row>({ rowKey: "id", getRows: () => rows.value,
    applyRows(next) { rows.value = [...next]; api.rows.setData(rows.value); },
    async save(_intent, { operation }) { await nextTick(); saves.push(operation); }
  });
  const host = document.createElement("div");
  document.body.append(host);
  const app = createApp(defineComponent({ setup: () => () => h(MachTable, {
    ...ordering.bindings, rowData: rows.value, columnDefs: columns, rowKey: "id", pagination: false,
    onGridReady: (event: { api: GridApi<Row> }) => { api = event.api; }
  }) }));
  unmount = () => { ordering.dispose(); app.unmount(); };
  app.mount(host);
  await vi.waitFor(() => expect(api).toBeDefined());
  await ordering.move({ rowIds: ["a"], targetId: "c", position: "after" });
  const movedNode = api.rows.getById("a");
  await nextTick();
  expect(api.rows.getById("a")).toBe(movedNode);
  expect(rows.value.map(row => row.id)).toEqual(["b", "c", "a"]);
  expect(ordering.state.canUndo).toBe(true);
  await ordering.undo();
  await nextTick();
  expect(rows.value.map(row => row.id)).toEqual(["a", "b", "c"]);
  expect(api.rows.getAt(0)?.id).toBe("a");
  expect(ordering.state.canRedo).toBe(true);
  expect(saves).toEqual(["move", "undo"]);
  // The explicit replacement command intentionally still starts a new scope.
  const beforeReplacement = api.rows.getById("a");
  api.rows.setData(rows.value);
  expect(api.rows.getById("a")).not.toBe(beforeReplacement);
  expect(ordering.state.canRedo).toBe(false);
});
