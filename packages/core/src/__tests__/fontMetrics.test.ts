// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGrid } from "../core/createGrid";

const originalFonts = Object.getOwnPropertyDescriptor(document, "fonts");

afterEach(() => {
  vi.restoreAllMocks();
  if (originalFonts) Object.defineProperty(document, "fonts", originalFonts);
  else Reflect.deleteProperty(document, "fonts");
  document.body.replaceChildren();
});

function fixture(ready = Promise.resolve(), status = "loaded") {
  const faces: FontFace[] = [];
  const events = new EventTarget();
  const fonts = {
    ready, status,
    [Symbol.iterator]: () => faces[Symbol.iterator](),
    addEventListener: vi.fn(events.addEventListener.bind(events)),
    removeEventListener: vi.fn(events.removeEventListener.bind(events))
  };
  Object.defineProperty(document, "fonts", { configurable: true, value: fonts });
  const nativeRect = HTMLElement.prototype.getBoundingClientRect;
  const measure = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const rect = nativeRect.call(this);
    return this.style.height === "auto"
      ? { ...rect, height: faces.some(face => face.status === "loaded") ? 96 : 40 }
      : rect;
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const getRowHeight = vi.fn(() => 32);
  const api = createGrid(host, {
    rowKey: "id", pagination: false, getRowHeight,
    columnDefs: [{ field: "name", width: 160, wrapText: true, autoHeight: true }],
    rowData: [{ id: "one", name: "manufacturing scheduling accountability" }]
  });
  const height = () => host.querySelector<HTMLElement>(".mach-row[data-id='one']")!.style.height;
  return { api, faces, fonts, events, height, measure, getRowHeight };
}

describe("font metrics invalidation", () => {
  it("remeasures a newly added loaded face on explicit layout without changing font-family", () => {
    const f = fixture();
    expect(f.height()).toBe("40px");
    f.api.view.refreshLayout();
    expect(f.getRowHeight).toHaveBeenCalledTimes(1);
    f.faces.push({ family: "BusinessFont", status: "loaded" } as FontFace);
    f.api.view.refreshLayout();
    expect(f.height()).toBe("96px");
    expect(f.getRowHeight).toHaveBeenCalledTimes(2);
    f.api.view.refreshLayout();
    expect(f.getRowHeight).toHaveBeenCalledTimes(2);
    f.faces.length = 0;
    f.api.view.refreshLayout();
    expect(f.height()).toBe("40px");
    expect(f.getRowHeight).toHaveBeenCalledTimes(3);
    f.api.destroy();
  });

  it("refreshes after font loading completes without requiring loadingdone", async () => {
    const f = fixture();
    const face = { family: "BusinessFont", status: "loading" } as FontFace;
    f.faces.push(face);
    f.api.view.refreshLayout();
    Object.defineProperty(face, "status", { value: "loaded" });
    f.events.dispatchEvent(new Event("loading"));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    expect(f.height()).toBe("96px");
    const listener = f.fonts.addEventListener.mock.calls.find(([type]) => type === "loading")![1];
    f.api.destroy();
    expect(f.fonts.removeEventListener).toHaveBeenCalledWith("loading", listener);
    const calls = f.measure.mock.calls.length;
    f.events.dispatchEvent(new Event("loading"));
    expect(f.measure).toHaveBeenCalledTimes(calls);
  });

  it("observes fonts already loading when the grid is created", async () => {
    let finish!: () => void;
    const ready = new Promise<void>(resolve => { finish = resolve; });
    const f = fixture(ready, "loading");
    expect(f.height()).toBe("40px");
    f.faces.push({ family: "BusinessFont", status: "loaded" } as FontFace);
    finish();
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    expect(f.height()).toBe("96px");
    f.api.destroy();
  });

  it("does not schedule layout if the grid is destroyed before fonts are ready", async () => {
    let finish!: () => void;
    const ready = new Promise<void>(resolve => { finish = resolve; });
    const f = fixture(ready);
    f.events.dispatchEvent(new Event("loading"));
    f.api.destroy();
    const schedule = vi.spyOn(globalThis, "requestAnimationFrame");
    const calls = f.measure.mock.calls.length;
    finish();
    await ready;
    expect(schedule).not.toHaveBeenCalled();
    expect(f.measure).toHaveBeenCalledTimes(calls);
  });
});
