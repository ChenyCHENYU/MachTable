// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGrid, type GridApi } from "../index";

const grids: GridApi[] = [];
afterEach(() => {
  grids.splice(0).forEach((api) => api.destroy());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, right: left + width, bottom: top + height, width, height, x: left, y: top } as DOMRect;
}

function grid(parent: HTMLElement | ShadowRoot = document.body) {
  const host = document.createElement("div");
  Object.defineProperties(host, { clientWidth: { value: 600 }, clientHeight: { value: 300 } });
  parent.appendChild(host);
  const api = createGrid(host, {
    rowData: [{ id: "1", value: "before" }], rowKey: "id",
    columnDefs: [{ field: "value", width: 116, editable: true }]
  });
  grids.push(api);
  const root = host.querySelector<HTMLElement>(".mach-root")!;
  const viewport = root.querySelector<HTMLElement>(".mach-body-viewport--scroll")!;
  const cell = root.querySelector<HTMLElement>('.mach-cell[data-col-id="value"]')!;
  Object.defineProperties(viewport, { clientWidth: { value: 400 }, clientHeight: { value: 220, configurable: true } });
  return { api, root, viewport, cell };
}

function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

describe("cell editing chrome", () => {
  it.each([30, 52])("keeps actions visible for a one-row %ipx natural table without covering its input", async (height) => {
    const { api, root, viewport } = grid();
    api.updateOptions({ domLayout: "autoHeight", rowHeight: height, maxBodyHeight: height });
    api.view.flush();
    const cell = root.querySelector<HTMLElement>('.mach-cell[data-col-id="value"]')!;
    let viewportHeight = height;
    Object.defineProperty(viewport, "clientHeight", { get: () => viewportHeight, configurable: true });
    const original = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this === root) return rect(100, 200, 600, height + 40);
      if (this === viewport) return rect(250, 240, 400, viewportHeight);
      if (this === cell) return rect(300, 240, 116, height);
      if (this.classList.contains("mach-cell-editor-controls")) return rect(0, 0, this.style.position === "static" ? 600 : 52, 28);
      return original.call(this);
    });
    api.editing.startCell({ rowIndex: 0, colId: "value" });
    const controls = root.querySelector<HTMLElement>(".mach-cell-editor-controls")!;
    expect(controls.style.position).toBe("static");
    expect(controls.style.visibility).toBe("");
    expect(root.querySelector<HTMLElement>(".mach-body")!.style.height).toBe(`${height}px`);
    viewportHeight = height * 2;
    api.view.refreshLayout();
    await frame();
    expect(controls.style.position).toBe("");
    expect(controls.style.visibility).toBe("");
    await api.editing.stop({ cancel: true });
    expect(root.querySelector(".mach-cell-editor-controls")).toBeNull();
  });
  it("keeps the full editor shell independent from controls and clamps/flips inside its pane", async () => {
    const { api, root, viewport, cell } = grid();
    let anchor = rect(300, 260, 116, 52);
    const original = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this === root) return rect(100, 200, 600, 300);
      if (this === viewport) return rect(250, 240, 400, 220);
      if (this === cell) return anchor;
      if (this.classList.contains("mach-cell-editor-controls")) return rect(0, 0, 52, 28);
      return original.call(this);
    });
    api.editing.startCell({ rowIndex: 0, colId: "value" });
    const controls = root.querySelector<HTMLElement>(".mach-cell-editor-controls")!;
    expect(controls.parentElement).toBe(root);
    expect(controls.getAttribute("role")).toBe("group");
    expect(cell.querySelector(".mach-cell-editor-controls")).toBeNull();
    expect(cell.querySelector(".mach-cell-editor-shell")?.children).toHaveLength(1);
    expect(controls.style.top).toBe("114px"); // first visible row: below, not clipped above the viewport
    anchor = rect(620, 350, 116, 52);
    api.columns.setWidth("value", 130);
    await frame();
    expect(controls.style.left).toBe("498px");
    expect(controls.style.top).toBe("120px");
    expect(controls.style.visibility).toBe("");
    anchor = rect(100, 350, 116, 52); // hidden behind the left frozen pane
    viewport.scrollLeft = 1; // updateRangeInner can return false when this pixel does not change its virtual window
    viewport.dispatchEvent(new Event("scroll"));
    await frame();
    expect(controls.style.visibility).toBe("hidden");
  });

  it("reuses the existing grid observer and leaves no toolbar after cancel/destroy", async () => {
    const observers: Array<{ targets: Element[]; disconnect: ReturnType<typeof vi.fn> }> = [];
    vi.stubGlobal("ResizeObserver", class {
      targets: Element[] = [];
      disconnect = vi.fn();
      constructor() { observers.push(this); }
      observe(target: Element) { this.targets.push(target); }
      unobserve() {}
    });
    const { api, root, viewport } = grid();
    const before = observers.length;
    api.editing.startCell({ rowIndex: 0, colId: "value" });
    expect(observers).toHaveLength(before);
    expect(observers[0].targets).toEqual([root]);
    viewport.scrollLeft = 1;
    viewport.dispatchEvent(new Event("scroll"));
    await api.editing.stop({ cancel: true });
    await frame();
    expect(observers[0].disconnect).not.toHaveBeenCalled();
    expect(root.querySelector(".mach-cell-editor-controls")).toBeNull();
    api.editing.startCell({ rowIndex: 0, colId: "value" });
    api.destroy();
    expect(observers[observers.length - 1].disconnect).toHaveBeenCalledOnce();
    expect(root.querySelector(".mach-cell-editor-controls")).toBeNull();
  });

  it("removes actions on virtual release while async validation cannot commit into the reused row", async () => {
    const { api, root, viewport } = grid();
    api.rows.setData(Array.from({ length: 100 }, (_, index) => ({ id: String(index + 1), value: `before-${index}` })));
    let resolve!: (value: true) => void;
    api.columns.setDefinitions([{ field: "value", width: 116, editable: true, validate: () => new Promise<true>((done) => { resolve = done; }) }]);
    api.editing.startCell({ rowIndex: 0, colId: "value" });
    root.querySelector<HTMLInputElement>(".mach-editor-input")!.value = "pending";
    const pending = api.editing.stop();
    expect(root.querySelector<HTMLButtonElement>(".mach-edit-control--confirm")!.disabled).toBe(true);
    viewport.scrollTop = 1800;
    viewport.dispatchEvent(new Event("scroll"));
    await frame();
    expect(root.querySelector(".mach-cell-editor-controls")).toBeNull();
    resolve(true);
    await expect(pending).resolves.toBe(false);
    expect(api.rows.getById("1")?.data?.value).toBe("before-0");
    expect(root.querySelector(".mach-cell-editor-controls")).toBeNull();
  });

  it.each(["pin", "hide"])("cancels an async editor when %s rebuilds its original cell", async (change) => {
    const { api, root } = grid();
    let resolve!: (value: true) => void;
    api.columns.setDefinitions([{ field: "value", width: 116, editable: true, validate: () => new Promise<true>((done) => { resolve = done; }) }]);
    api.editing.startCell({ rowIndex: 0, colId: "value" });
    root.querySelector<HTMLInputElement>(".mach-editor-input")!.value = "pending";
    const pending = api.editing.stop();
    if (change === "pin") api.columns.setPinned("value", "left");
    else api.columns.setVisible("value", false);
    api.view.flush();
    await frame();
    expect(root.querySelector(".mach-cell-editor-controls")).toBeNull();
    expect(root.querySelector(".mach-cell--editing")).toBeNull();
    resolve(true);
    await expect(pending).resolves.toBe(false);
    expect(api.rows.getById("1")?.data?.value).toBe("before");
  });

  it("keeps the toolbar inside its grid in an iframe document", () => {
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const { api, root, cell } = grid(frame.contentDocument!.body);
    api.editing.startCell({ rowIndex: 0, colId: "value" });
    const controls = root.querySelector<HTMLElement>(".mach-cell-editor-controls")!;
    expect(controls.ownerDocument).toBe(frame.contentDocument);
    expect(controls.parentElement).toBe(root);
    cell.querySelector<HTMLInputElement>("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(root.querySelector(".mach-cell-editor-controls")).toBeNull();
  });

  it("preserves input focus on toolbar mouse down and cancels from its Escape key in ShadowRoot", async () => {
    const owner = document.createElement("div");
    document.body.appendChild(owner);
    const shadow = owner.attachShadow({ mode: "open" });
    const { api, root, cell } = grid(shadow);
    api.editing.startCell({ rowIndex: 0, colId: "value" });
    const input = cell.querySelector<HTMLInputElement>("input")!;
    input.value = "cancelled";
    const controls = root.querySelector<HTMLElement>(".mach-cell-editor-controls")!;
    expect(controls.getRootNode()).toBe(shadow);
    const mouse = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    controls.querySelector("button")!.dispatchEvent(mouse);
    expect(mouse.defaultPrevented).toBe(true);
    expect(shadow.activeElement).toBe(input);
    controls.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(api.rows.getById("1")?.data?.value).toBe("before");
    expect(root.querySelector(".mach-cell-editor-controls")).toBeNull();
  });
});
