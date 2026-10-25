// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGrid, dragColumn, selectionColumn } from "../index";
import type { GridApi, GridOptions, RowDragEndEvent } from "../index";
import { createRowOrderController, type RowOrderController, type RowOrderControllerOptions } from "../ordering/controller";
import * as dragSessions from "../ordering/dragSession";
import { getGridRowDragFactory } from "../lib/adapterLifecycle";

interface Row { id: string; value?: string; children?: Row[] }
let api: GridApi<Row>;
let ordering: RowOrderController<Row>;
let host: HTMLElement;
let model: readonly Row[];
const rect = { left: 0, right: 800, top: 0, bottom: 400, width: 800, height: 400, x: 0, y: 0, toJSON: () => ({}) };

function setup(treeData = false, options: GridOptions<Row> = {}, controllerOptions: Partial<RowOrderControllerOptions<Row>> = {}) {
  model = treeData ? [{ id: "a", children: [{ id: "a1" }, { id: "a2" }] }, { id: "b", children: [{ id: "b1" }] }] : [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  ordering = createRowOrderController({ rowKey: "id", treeData, getRows: () => model, applyRows: (rows) => { model = rows; api.rows.setData([...rows]); }, ...controllerOptions });
  host = document.createElement("div");
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 400 } });
  document.body.append(host);
  api = createGrid(host, {
    ...ordering.bindings, rowKey: "id", rowData: [...model], rowHeight: 32, pagination: false,
    columnDefs: [dragColumn(), selectionColumn(), { field: "id" }],
    rowSelection: "multiple", treeData, defaultExpandAll: true, ...options
  });
  for (const element of host.querySelectorAll<HTMLElement>(".mach-root,.mach-body,.mach-body-viewport")) vi.spyOn(element, "getBoundingClientRect").mockReturnValue(rect);
}

function pointer(type: string, y: number): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: 20, clientY: y });
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event;
}

function begin(id: string, y: number): void {
  const row = api.rows.getById(id)!;
  host.querySelector(`.mach-row[data-id="${id}"] .mach-row-drag-handle`)!.dispatchEvent(pointer("pointerdown", row.rowIndex * 32 + 16));
  window.dispatchEvent(pointer("pointermove", y));
}

async function finish(y: number): Promise<void> {
  window.dispatchEvent(pointer("pointerup", y));
  for (let index = 0; index < 8; index++) await Promise.resolve();
}

afterEach(() => { ordering?.dispose(); api?.destroy(); host?.remove(); vi.restoreAllMocks(); });

describe("ordering controller with real grid gestures", () => {
  it("moves selected flat rows as one stable-ID operation", async () => {
    setup();
    api.selection.setById("a", true);
    api.selection.setById("b", true, false);
    const events: RowDragEndEvent<Row>[] = [];
    api.on("rowDragEnd", (event) => events.push(event));
    begin("a", 125);
    await finish(125);
    expect(model.map((row) => row.id)).toEqual(["c", "d", "a", "b"]);
    expect(api.rows.getAt(2)?.id).toBe("a");
    expect(events[0]).toMatchObject({ applied: false, toIndex: 4, targetIndex: 2, intent: { rowIds: ["a", "b"], targetId: "d", position: "after", beforeId: "d", afterId: null } });
  });

  it("does not move other selected rows when the dragged source is unselected", async () => {
    setup();
    api.selection.setById("b", true);
    begin("a", 125);
    await finish(125);
    expect(model.map((row) => row.id)).toEqual(["b", "c", "d", "a"]);
  });

  it("supports a tree inside target and reports its sibling neighbours", async () => {
    setup(true);
    const onDrop = vi.fn();
    api.on("rowDragEnd", onDrop);
    begin("a1", 112);
    await vi.waitFor(() => expect(host.querySelector<HTMLElement>('.mach-row-drop-indicator[data-drop-position="inside"]')?.hidden).toBe(false));
    const indicator = host.querySelector<HTMLElement>('.mach-row-drop-indicator[data-drop-position="inside"]')!;
    expect(indicator.style.height).toBe("32px");
    // jsdom drops color-mix declarations; verify the emitted color and browser-independent marker here.
    const feedback = dragSessions.createOrderDragSession(api, api.rows.getById("a1")!, model, { rowKey: "id" }, true)
      .resolve({ targetNode: api.rows.getById("b")!, position: "after", fraction: .5, height: 32 });
    expect(feedback).toMatchObject({ indicatorStyle: expect.stringContaining("background:color-mix(in srgb,var(--mach-primary) 12%,transparent)") });
    expect(indicator.style.boxShadow).toBe("inset 0 0 0 1px var(--mach-primary)");
    expect(host.querySelector('.mach-pane--center .mach-row[data-id="b"]')?.textContent).toContain("b");
    await finish(112);
    expect(model[0].children?.map((row) => row.id)).toEqual(["a2"]);
    expect(model[1].children?.map((row) => row.id)).toEqual(["b1", "a1"]);
    expect(onDrop).toHaveBeenCalledWith(expect.objectContaining({ toIndex: 5, targetIndex: 4, intent: expect.objectContaining({ targetId: "b", position: "inside", beforeId: "b1", afterId: null }) }));
  });

  it("places a subtree after another expanded parent rather than after its first child", async () => {
    setup(true);
    const onDrop = vi.fn();
    api.on("rowDragEnd", onDrop);
    begin("a", 125);
    await finish(125);
    expect(model.map((row) => row.id)).toEqual(["b", "a"]);
    expect(onDrop).toHaveBeenCalledWith(expect.objectContaining({ intent: expect.objectContaining({ targetId: "b", position: "after", beforeId: "b", afterId: null }) }));
    expect(model[1].children?.map((row) => row.id)).toEqual(["a1", "a2"]);
  });

  it("moves tree siblings with the keyboard and restores the current handle by ID", async () => {
    setup(true);
    const handle = host.querySelector<HTMLButtonElement>('.mach-row[data-id="a"] .mach-row-drag-handle')!;
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }));
    await vi.waitFor(() => expect(model[0].id).toBe("b"));
    await vi.waitFor(() => expect((document.activeElement as HTMLElement).closest<HTMLElement>(".mach-row")?.dataset.id).toBe("a"));
  });

  it("targets the next visible filtered row while preserving all thirty rows and full-model neighbours", async () => {
    setup(false, { columnDefs: [dragColumn(), { field: "id" }, { field: "value" }] });
    model = Array.from({ length: 30 }, (_, index) => ({ id: String(index + 1), value: index % 6 === 0 ? "matching" : "other" }));
    api.rows.setData([...model]);
    api.filtering.setQuickText("matching");
    const visible = (): string[] => { const ids: string[] = []; api.rows.forEachDisplayed(node => ids.push(node.id)); return ids; };
    const original = model;
    const onDrop = vi.fn();
    api.on("rowDragEnd", onDrop);
    expect(visible()).toEqual(["1", "7", "13", "19", "25"]);
    host.querySelector('.mach-row[data-id="1"] .mach-row-drag-handle')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }));
    for (let index = 0; index < 20; index++) await Promise.resolve();
    expect(visible()).toEqual(["7", "1", "13", "19", "25"]);
    expect(onDrop).toHaveBeenCalledWith(expect.objectContaining({ intent: expect.objectContaining({ targetId: "7", beforeId: "7", afterId: "8" }) }));
    expect(model.map(row => row.id)).toEqual(["2", "3", "4", "5", "6", "7", "1", ...original.slice(7).map(row => row.id)]);
    await ordering.undo();
    expect(model).toBe(original);
    expect(visible()).toEqual(["1", "7", "13", "19", "25"]);
    await ordering.redo();
    expect(visible()).toEqual(["7", "1", "13", "19", "25"]);
    expect(model).toHaveLength(30);
    expect(new Set(model.map(row => row.id))).toEqual(new Set(original.map(row => row.id)));
  });

  it("skips hidden tree siblings without targeting their descendants", async () => {
    setup(true, { columnDefs: [dragColumn(), { field: "id" }, { field: "value" }] });
    model = model.map(row => ({ ...row, value: row.id === "a" ? "matching" : "other" }));
    model = [...model, { id: "c", value: "matching", children: [{ id: "c1" }] }];
    const children = model[0].children;
    api.rows.setData([...model]);
    api.filtering.setQuickText("matching");
    host.querySelector('.mach-row[data-id="a"] .mach-row-drag-handle')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }));
    for (let index = 0; index < 20; index++) await Promise.resolve();
    expect(model.map(row => row.id)).toEqual(["b", "c", "a"]);
    expect(model[2].children).toBe(children);
  });

  it("rejects selected targets and descendants without emitting or changing the model", async () => {
    setup(true);
    const before = model;
    const onDrop = vi.fn();
    api.on("rowDragEnd", onDrop);
    begin("a", 48);
    await finish(48);
    expect(onDrop).not.toHaveBeenCalled();
    expect(model).toBe(before);
  });

  it("explains canDrag restrictions on the real native handle", () => {
    setup(false, { rowDragPolicy: { canDrag: ({ node }) => node.id === "a" ? "Order is locked" : true } });
    const handle = host.querySelector<HTMLButtonElement>('.mach-row[data-id="a"] .mach-row-drag-handle')!;
    expect(handle.disabled).toBe(true);
    expect(handle.title).toBe("Order is locked");
  });

  it("shows a canDrop reason and rechecks dynamic policy at commit", async () => {
    let locked = false;
    setup(false, { rowDragPolicy: { canDrop: () => locked ? "Destination is locked" : true } });
    const onDrop = vi.fn();
    api.on("rowDragEnd", onDrop);
    begin("a", 125);
    locked = true;
    await vi.waitFor(() => expect(host.querySelector(".mach-row-drag-preview")?.textContent).toBe("Destination is locked"));
    await finish(125);
    expect(onDrop).not.toHaveBeenCalled();
    expect(model[0].id).toBe("a");
  });

  it.each(["revision", "rows", "columns", "policy", "order"] as const)("discards a gesture after its %s scope changes", async (change) => {
    let revision = "r1";
    setup(false, { rowDragPolicy: { getRevision: () => revision } });
    const onDrop = vi.fn();
    api.on("rowDragEnd", onDrop);
    begin("a", 125);
    if (change === "revision") revision = "r2";
    if (change === "rows") api.rows.setData([{ id: "new" }]);
    if (change === "columns") api.columns.setDefinitions([dragColumn(), { field: "id", width: 150 }]);
    if (change === "policy") api.updateOptions({ rowDragPolicy: { canDrop: () => false } });
    if (change === "order") api.rows.reorder(2, 0);
    await finish(125);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("reports throwing policy callbacks instead of leaking errors from pointer handlers", async () => {
    const report = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    setup(false, { rowDragPolicy: { canDrop: () => { throw new Error("Policy failed"); } }, onGridError: report });
    begin("a", 125);
    await finish(125);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ source: "rowDragPolicy.canDrop" }));
    expect(model[0].id).toBe("a");
  });

  it.each(["prepare", "resolve", "keyboardTarget", "isSource"] as const)("cancels a gesture when its optional %s policy throws", async (hook) => {
    const report = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const original = dragSessions.createOrderDragSession;
    const fail = () => { throw new Error("Session failed"); };
    vi.spyOn(dragSessions, "createOrderDragSession").mockImplementation((...args) => {
      if (hook === "prepare") return fail();
      const session = original(...args);
      if (hook === "resolve") return { ...session, resolve: fail };
      if (hook === "keyboardTarget") return { ...session, keyboardTarget: fail };
      return { ...session, isSource: fail };
    });
    setup(false, { onGridError: report });
    const onDrop = vi.fn();
    api.on("rowDragEnd", onDrop);
    if (hook === "keyboardTarget") host.querySelector('.mach-row[data-id="a"] .mach-row-drag-handle')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }));
    else { begin("a", 125); await finish(125); }
    expect(onDrop).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ source: `rowDragPolicy.${hook}` }));
    expect(model[0].id).toBe("a");
  });

  it("refreshes native handles when policy restrictions change or are cleared", () => {
    setup();
    api.updateOptions({ rowDragPolicy: { canDrag: () => "Order is locked" } });
    const handle = () => host.querySelector<HTMLButtonElement>('.mach-row[data-id="a"] .mach-row-drag-handle')!;
    expect(handle().disabled).toBe(true);
    expect(handle().title).toBe("Order is locked");
    api.updateOptions({ rowDragPolicy: undefined });
    expect(handle().disabled).toBe(false);
    expect(getGridRowDragFactory(api)).toBeUndefined();
  });

  it("keeps the current driver's ownership when a previous controller is disposed", async () => {
    setup(true);
    const previous = ordering;
    const current = createRowOrderController({ rowKey: "id", treeData: true, getRows: () => model, applyRows: rows => { model = rows; api.rows.setData([...rows]); } });
    api.updateOptions(current.bindings);
    ordering = current;
    const owner = getGridRowDragFactory(api);
    expect(owner).toBeDefined();
    previous.dispose();
    expect(getGridRowDragFactory(api)).toBe(owner);
    begin("a1", 112);
    await finish(112);
    expect(model[1].children?.map(row => row.id)).toEqual(["b1", "a1"]);
  });

  it("releases an active driver's pointer resources when its controller is disposed", async () => {
    setup(true);
    const onDrop = vi.fn();
    api.on("rowDragEnd", onDrop);
    begin("a1", 112);
    await vi.waitFor(() => expect(host.querySelector(".mach-row-drag-preview")?.hasAttribute("hidden")).toBe(false));
    ordering.dispose();
    expect(host.querySelector(".mach-row-drag-preview")).toBeNull();
    await finish(112);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it.each(["active", "committed"] as const)("preserves a new %s editor when persistence fails after ordering", async (editing) => {
    let reject!: (error: unknown) => void;
    const save = new Promise<never>((_, fail) => { reject = fail; });
    setup(false, { columnDefs: [dragColumn(), { field: "value", editable: true }] }, { save: () => save });
    const request = ordering.move({ rowIds: ["a"], targetId: "d", position: "after" });
    expect(ordering.state.status).toBe("saving");
    expect(api.editing.startCell({ rowIndex: 0, colId: "value" })).toBe(true);
    const input = host.querySelector<HTMLInputElement>(".mach-cell--editing input")!;
    input.value = "new work";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    if (editing === "committed") await api.editing.stop();
    reject(new Error("Server unavailable"));
    await expect(request).rejects.toThrow("Server unavailable");
    expect(model.map((row) => row.id)).toEqual(["b", "c", "d", "a"]);
    expect(ordering.state.error).toMatchObject({ message: expect.stringContaining("rollback was skipped"), cause: expect.any(Error) });
    if (editing === "active") expect(host.querySelector<HTMLInputElement>(".mach-cell--editing input")?.value).toBe("new work");
    else {
      expect(api.rows.getById("b")?.data?.value).toBe("new work");
      expect(api.editing.getDirtyRowIds()).toContain("b");
    }
  });

  it("refuses programmatic replacement while an editor is active, even before it becomes dirty", async () => {
    setup(false, { columnDefs: [dragColumn(), { field: "value", editable: true }] });
    const before = model;
    expect(api.editing.startCell({ rowIndex: 0, colId: "value" })).toBe(true);
    await expect(ordering.move({ rowIds: ["a"], targetId: "d", position: "after" })).rejects.toThrow(/Save or discard/);
    expect(model).toBe(before);
    expect(host.querySelector(".mach-cell--editing input")).not.toBeNull();
  });

  it("restores handle availability after persistence settles", async () => {
    let resolve!: () => void;
    const saving = new Promise<void>((done) => { resolve = done; });
    setup(false, {}, { save: () => saving });
    const request = ordering.move({ rowIds: ["a"], targetId: "d", position: "after" });
    api.view.flush();
    expect(host.querySelector<HTMLButtonElement>(".mach-row-drag-handle")?.disabled).toBe(true);
    resolve();
    await request;
    api.view.flush();
    expect(host.querySelector<HTMLButtonElement>(".mach-row-drag-handle")?.disabled).toBe(false);
  });

  it("invalidates undo after same-API replacement even when the host reuses the same data objects", async () => {
    setup();
    await ordering.move({ rowIds: ["a"], targetId: "d", position: "after" });
    expect(ordering.state.canUndo).toBe(true);
    api.rows.setData([...model]);
    expect(ordering.state.canUndo).toBe(false);
    await expect(ordering.undo()).rejects.toThrow(/Nothing/);
  });

  it("refuses undo over an active editor and invalidates history on committed cell edits", async () => {
    setup(false, { columnDefs: [dragColumn(), { field: "value", editable: true }] });
    await ordering.move({ rowIds: ["a"], targetId: "d", position: "after" });
    expect(api.editing.startCell({ rowIndex: 0, colId: "value" })).toBe(true);
    await expect(ordering.undo()).rejects.toThrow(/Save or discard/);
    const input = host.querySelector<HTMLInputElement>(".mach-cell--editing input")!;
    input.value = "new work";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await api.editing.stop();
    expect(ordering.state).toMatchObject({ canUndo: false, canRedo: false });
    expect(api.rows.getById("b")?.data?.value).toBe("new work");
  });

  it.each(["saved", "error"] as const)("restores a keyboard handle only after its disabled pending save settles as %s", async status => {
    let resolve!: () => void, reject!: (error: unknown) => void;
    const save = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    setup(false, {}, { save: () => save });
    const handle = () => host.querySelector<HTMLButtonElement>('.mach-row[data-id="a"] .mach-row-drag-handle')!;
    handle().focus();
    handle().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }));
    await vi.waitFor(() => expect(ordering.state.status).toBe("saving"));
    api.view.flush();
    expect(handle().disabled).toBe(true);
    expect(document.activeElement).not.toBe(handle());
    if (status === "saved") resolve();
    else reject(new Error("Save failed"));
    await vi.waitFor(() => expect(ordering.state.status).toBe(status));
    await vi.waitFor(() => expect(document.activeElement).toBe(handle()));
  });

  it("preserves deliberate focus changes while a keyboard order is saving", async () => {
    let resolve!: () => void;
    const save = new Promise<void>(done => { resolve = done; });
    setup(false, {}, { save: () => save });
    const outside = document.createElement("input");
    host.append(outside);
    const handle = host.querySelector<HTMLButtonElement>('.mach-row[data-id="a"] .mach-row-drag-handle')!;
    handle.focus();
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }));
    await vi.waitFor(() => expect(ordering.state.status).toBe("saving"));
    outside.focus();
    resolve();
    await vi.waitFor(() => expect(ordering.state.status).toBe("saved"));
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it.each(["replace", "dispose"] as const)("cancels pending keyboard focus ownership after %s", async change => {
    let resolve!: () => void;
    const save = new Promise<void>(done => { resolve = done; });
    setup(false, {}, { save: () => save });
    const handle = host.querySelector<HTMLButtonElement>('.mach-row[data-id="a"] .mach-row-drag-handle')!;
    handle.focus();
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }));
    await vi.waitFor(() => expect(ordering.state.status).toBe("saving"));
    if (change === "replace") { model = [{ id: "external" }]; api.rows.setData([...model]); }
    else ordering.dispose();
    resolve();
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
    expect(document.activeElement?.classList.contains("mach-row-drag-handle")).toBe(false);
    if (change === "replace") expect(api.rows.getAt(0)?.id).toBe("external");
  });

  it("cancels a settled keyboard focus request when same-ID rows change before its frame", async () => {
    setup();
    const handle = host.querySelector<HTMLButtonElement>('.mach-row[data-id="a"] .mach-row-drag-handle')!;
    handle.focus();
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }));
    for (let index = 0; index < 20; index++) await Promise.resolve();
    expect(ordering.state.status).toBe("saved");
    expect(document.activeElement?.classList.contains("mach-row-drag-handle")).toBe(false);
    model = model.map(row => ({ ...row }));
    api.rows.setData([...model]);
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
    expect(document.activeElement?.classList.contains("mach-row-drag-handle")).toBe(false);
  });

  it.each(["resolve", "reject"] as const)("releases a replaced model before an ignored-abort transport's late %s", async outcome => {
    let resolve!: (value: { revision: string }) => void, reject!: (error: unknown) => void;
    const pending = new Promise<{ revision: string }>((done, fail) => { resolve = done; reject = fail; });
    const save = vi.fn().mockImplementationOnce(() => pending).mockResolvedValue({ revision: "current" });
    setup(false, {}, { save });
    const intent = { rowIds: ["a"], targetId: "d", position: "after" as const };
    const previous = ordering.move(intent).catch((error: unknown) => error);
    model = model.map(row => ({ ...row }));
    api.rows.setData([...model]);
    expect(ordering.state).toMatchObject({ status: "idle", plan: null });
    const current = ordering.move({ ...intent, position: "before" });
    expect(await previous).toMatchObject({ name: "AbortError" });
    await current;
    const installed = model;
    if (outcome === "resolve") resolve({ revision: "obsolete" });
    else reject(new Error("Obsolete failure"));
    for (let index = 0; index < 8; index++) await Promise.resolve();
    expect(model).toBe(installed);
    expect(ordering.state).toMatchObject({ status: "saved", revision: "current", canUndo: true, error: null });
  });

  it("does not mistake edits on an installed node for a replacement scope", async () => {
    let resolve!: () => void, signal!: AbortSignal;
    const pending = new Promise<void>(done => { resolve = done; });
    setup(false, { columnDefs: [dragColumn(), { field: "value", editable: true }] }, { save: (_, context) => { signal = context.signal; return pending; } });
    const current = ordering.move({ rowIds: ["a"], targetId: "d", position: "after" });
    const node = api.rows.getById("b");
    expect(api.editing.startCell({ rowIndex: 0, colId: "value" })).toBe(true);
    const input = host.querySelector<HTMLInputElement>(".mach-cell--editing input")!;
    input.value = "new work";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await api.editing.stop();
    expect(api.rows.getById("b")).toBe(node);
    expect(signal.aborted).toBe(false);
    expect(ordering.state.status).toBe("saving");
    resolve();
    await current;
    expect(api.rows.getById("b")?.data?.value).toBe("new work");
    expect(ordering.state).toMatchObject({ status: "saved", canUndo: false });
  });

  it.each(["pointer", "keyboard"] as const)("emits stable intent for an unmanaged %s with revision only and no predicate", async mode => {
    const events: RowDragEndEvent<Row>[] = [];
    setup(false, { rowDragPolicy: { getRevision: () => "r3" }, onRowDragEnd: event => events.push(event) });
    if (mode === "pointer") { begin("a", 125); await finish(125); }
    else host.querySelector('.mach-row[data-id="a"] .mach-row-drag-handle')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }));
    expect(events[0]).toMatchObject({ applied: false, intent: { rowIds: ["a"], targetId: mode === "pointer" ? "d" : "b", beforeId: mode === "pointer" ? "d" : "b", afterId: mode === "pointer" ? null : "c", position: "after", expectedRevision: "r3" } });
    expect(model[0].id).toBe("a");
  });

  it("emits a stable intent for plain unmanaged dragging without policy configuration", async () => {
    const events: RowDragEndEvent<Row>[] = [];
    setup(false, { rowDragPolicy: undefined, onRowDragEnd: event => events.push(event) });
    begin("a", 125);
    await finish(125);
    expect(events[0].intent).toMatchObject({ rowIds: ["a"], targetId: "d", beforeId: "d", afterId: null, position: "after" });
  });
});
