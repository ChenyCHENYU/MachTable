// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGrid } from "../index";

function pointer(type: string, clientX = 200): MouseEvent {
  return new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY: 20 });
}

function setup(pinned?: "left" | "right", colId = "source") {
  const host = document.createElement("div"); document.body.append(host);
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 320 } });
  const api = createGrid(host, {
    rowKey: "id", pagination: false,
    columnDefs: [{ field: "name", colId, headerName: "Source", pinned, width: 120 }, { field: "id", colId: "anchor", pinned, width: 120 }],
    rowData: [{ id: "1", name: "Name" }]
  });
  const header = () => [...host.querySelectorAll<HTMLElement>(".mach-header-cell--leaf")].find(cell => cell.dataset.colId === colId)!;
  return { host, api, header };
}

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("current rendered column drag targets", () => {
  it.each(["left", "center", "right"] as const)("drags a special column ID within its %s pane without CSS escaping", (pane) => {
    vi.stubGlobal("CSS", undefined);
    const colId = 'quoted"\\line\n[value]';
    const { host, api, header } = setup(pane === "center" ? undefined : pane, colId);
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => { errors.push(event.error); event.preventDefault(); };
    window.addEventListener("error", onError);
    try {
      const source = header();
      source.dispatchEvent(pointer("pointerdown", 10));
      window.dispatchEvent(pointer("pointermove"));
      expect(errors).toEqual([]);
      expect(source.classList.contains("mach-header-cell--dragging")).toBe(true);
      expect(document.querySelector(".mach-column-drag-ghost")?.textContent).toBe("Source");
      expect(host.querySelector(".mach-drop-indicator")?.closest(".mach-header-pane")?.classList.contains(`mach-pane--${pane}`)).toBe(true);
      window.dispatchEvent(pointer("pointerup", 400));
      expect(api.columns.getState().map(column => column.colId)).toEqual(["anchor", colId]);
      expect(document.querySelector(".mach-column-drag-ghost")).toBeNull();
    } finally { window.removeEventListener("error", onError); api.destroy(); }
  });

  it("resolves the rebuilt header in its current pane after pinning before the drag threshold", () => {
    const { api, header } = setup();
    try {
      const previous = header();
      previous.dispatchEvent(pointer("pointerdown", 10));
      api.columns.setPinned("source", "right");
      expect(previous.isConnected).toBe(false);
      window.dispatchEvent(pointer("pointermove"));
      const current = header();
      expect(current.classList.contains("mach-header-cell--dragging")).toBe(true);
      expect(current.closest(".mach-header-pane")?.classList.contains("mach-pane--right")).toBe(true);
      window.dispatchEvent(pointer("pointercancel"));
      expect(document.querySelector(".mach-column-drag-ghost")).toBeNull();
    } finally { api.destroy(); }
  });

  it("cancels a pending drag when its column disappears before the threshold", () => {
    const { api, header } = setup();
    const moved = vi.fn(); api.on("columnMoved", moved);
    try {
      header().dispatchEvent(pointer("pointerdown", 10));
      api.columns.setDefinitions([{ field: "id", colId: "anchor" }]);
      window.dispatchEvent(pointer("pointermove"));
      window.dispatchEvent(pointer("pointerup"));
      expect(moved).not.toHaveBeenCalled();
      expect(document.querySelector(".mach-column-drag-ghost")).toBeNull();
      expect(api.columns.getState().map(column => column.colId)).toEqual(["anchor"]);
    } finally { api.destroy(); }
  });

  it.each(["pointercancel", "destroy"] as const)("releases an active drag on %s without moving columns", (action) => {
    const { api, header } = setup();
    const moved = vi.fn(); api.on("columnMoved", moved);
    try {
      header().dispatchEvent(pointer("pointerdown", 10));
      window.dispatchEvent(pointer("pointermove"));
      expect(document.querySelector(".mach-column-drag-ghost")).not.toBeNull();
      if (action === "destroy") api.destroy();
      else window.dispatchEvent(pointer("pointercancel"));
      window.dispatchEvent(pointer("pointermove"));
      window.dispatchEvent(pointer("pointerup"));
      expect(moved).not.toHaveBeenCalled();
      expect(document.querySelector(".mach-column-drag-ghost")).toBeNull();
    } finally { api.destroy(); }
  });
});
