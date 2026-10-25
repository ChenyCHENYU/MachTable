import { act, Component, createElement, StrictMode, useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GridApi } from "@agile-team/mach-table";
import { MachTable } from "../MachTable";
import { useMachTable, type UseMachTableReturn } from "../useMachTable";
import { reactCellRenderer } from "../adapters";

const frames = new Map<number, FrameRequestCallback>();
const observers = new Set<ResizeObserver>();
let frameId = 0;
const roots: ReturnType<typeof createRoot>[] = [];

class Boundary extends Component<{ children?: ReactNode; onError(error: Error): void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { this.props.onError(error); }
  render() { return this.state.failed ? null : this.props.children; }
}

async function flushFrames(): Promise<void> {
  await act(async () => {
    for (let round = 0; frames.size && round < 10; round++) {
      const current = [...frames.entries()];
      for (const [id, callback] of current) {
        if (!frames.delete(id)) continue;
        callback(0);
      }
      await Promise.resolve();
    }
  });
}

function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  return { host, root };
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() { observers.add(this as unknown as ResizeObserver); }
    disconnect() { observers.delete(this as unknown as ResizeObserver); }
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  observers.clear();
  frames.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("React adapter lifecycle matrix", () => {
  it("ignores StrictMode and keyed readiness from destroyed grids before the first frame", async () => {
    const { root, host } = mount();
    const ready = vi.fn();
    let table!: UseMachTableReturn<{ id: number }>;
    function Harness({ scenario }: { scenario: number | null }) {
      table = useMachTable();
      return scenario == null ? null : createElement(MachTable<{ id: number }>, {
        key: scenario, apiRef: table.apiRef, columnDefs: [{ field: "id" }],
        rowData: [{ id: scenario }], pagination: false, onGridReady: ready
      });
    }
    const render = (scenario: number | null) => root.render(createElement(StrictMode, null, createElement(Harness, { scenario })));
    await act(async () => render(1));
    const first = table.api!;
    expect(table.ready).toBe(false);
    expect(ready).not.toHaveBeenCalled();
    await act(async () => render(2));
    expect(first.isDestroyed()).toBe(true);
    expect(table.api).not.toBe(first);
    expect(table.ready).toBe(false);
    await flushFrames();
    expect(table.ready).toBe(true);
    expect(ready).toHaveBeenCalledOnce();
    expect(table.api?.rows.getAt(0)?.data?.id).toBe(2);
    const current = table.api!;
    await act(async () => render(null));
    expect(current.isDestroyed()).toBe(true);
    expect(table.api).toBeNull();
    expect(table.ready).toBe(false);
    expect(observers.size).toBe(0);
    expect(frames.size).toBe(0);
    expect(host.querySelector(".mach-root")).toBeNull();
  });

  it("cancels first-frame readiness when a StrictMode table is removed immediately", async () => {
    const { root } = mount();
    const ready = vi.fn();
    const apiRef = { current: null as GridApi | null };
    await act(async () => root.render(createElement(StrictMode, null, createElement(MachTable, {
      apiRef, columnDefs: [{ field: "id" }], rowData: [{ id: 1 }], onGridReady: ready
    }))));
    const api = apiRef.current!;
    await act(async () => root.render(null));
    await flushFrames();
    expect(api.isDestroyed()).toBe(true);
    expect(apiRef.current).toBeNull();
    expect(ready).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(observers.size).toBe(0);
  });

  it("releases a failed construction and can mount a fresh table through an error boundary", async () => {
    const { root, host } = mount();
    const failure = new Error("Observer failed during initial layout");
    const onError = vi.fn();
    let valid = false;
    vi.stubGlobal("ResizeObserver", class {
      observe() {
        observers.add(this as unknown as ResizeObserver);
        if (!valid) throw failure;
      }
      disconnect() { observers.delete(this as unknown as ResizeObserver); }
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onWindowError = (event: ErrorEvent) => { if (event.error === failure) event.preventDefault(); };
    window.addEventListener("error", onWindowError);
    const apiRef = { current: null as GridApi | null };
    const render = () => root.render(createElement(Boundary, { key: String(valid), onError }, createElement(MachTable, {
      apiRef, columnDefs: [{ field: "id" }], rowData: [{ id: 1 }]
    })));
    await act(async () => render());
    expect(onError).toHaveBeenCalledWith(failure);
    expect(apiRef.current).toBeNull();
    expect(host.querySelector(".mach-root")).toBeNull();
    expect(observers.size).toBe(0);
    expect(frames.size).toBe(0);
    valid = true;
    await act(async () => render());
    expect(apiRef.current?.isDestroyed()).toBe(false);
    expect(host.querySelectorAll(".mach-root")).toHaveLength(1);
    window.removeEventListener("error", onWindowError);
  });

  it("releases renderer roots and active editors when column definitions are replaced", async () => {
    const { root, host } = mount();
    const cleanup = vi.fn();
    function Cell() {
      useEffect(() => cleanup, []);
      return createElement("span", { className: "old-renderer" }, "old");
    }
    const apiRef = { current: null as GridApi | null };
    const rowData = [{ name: "Original", other: "New column" }];
    await act(async () => root.render(createElement(MachTable, {
      apiRef, columnDefs: [{ field: "name", editable: true, cellRenderer: reactCellRenderer(Cell) }], rowData, pagination: false
    })));
    const api = apiRef.current!;
    await act(async () => { api.editing.startCell({ rowIndex: 0, colId: "name" }); });
    host.querySelector<HTMLInputElement>(".mach-editor-input")!.value = "Uncommitted";
    await act(async () => root.render(createElement(MachTable, { apiRef, columnDefs: [{ field: "other" }], rowData, pagination: false })));
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 0)); });
    expect(apiRef.current).toBe(api);
    expect(host.querySelector(".old-renderer")).toBeNull();
    expect(host.querySelector(".mach-editor-input")).toBeNull();
    expect(host.querySelector('[data-col-id="other"]')).toBeTruthy();
    expect(cleanup).toHaveBeenCalled();
    expect(api.rows.getAt(0)?.data?.name).toBe("Original");
  });

  it("removes an open filter and its portalled listbox when the component is unmounted", async () => {
    const { root, host } = mount();
    await act(async () => root.render(createElement(MachTable, {
      columnDefs: [{ field: "name", filter: "text" }], rowData: [{ name: "one" }], pagination: false
    })));
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".mach-filter-btn")!.click();
      document.querySelector<HTMLButtonElement>('.mach-filter-panel [role="combobox"]')!.click();
    });
    expect(document.querySelector('[role="listbox"]')).toBeTruthy();
    await act(async () => root.render(null));
    expect(document.querySelector(".mach-filter-panel")).toBeNull();
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(observers.size).toBe(0);
    expect(frames.size).toBe(0);
  });
});
