// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createActionButtonsRenderer, createGrid } from "../index";
import { positionAnchoredPortal } from "../lib/dom";

const viewport = { width: window.innerWidth, height: window.innerHeight };
afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperties(window, { innerWidth: { configurable: true, value: viewport.width }, innerHeight: { configurable: true, value: viewport.height } });
  document.body.replaceChildren();
});

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON: () => ({}) };
}

function sizeViewport(width = 400, height = 300): void {
  Object.defineProperties(window, { innerWidth: { configurable: true, value: width }, innerHeight: { configurable: true, value: height } });
}

describe("anchored portal geometry", () => {
  it.each([4, 6])("preserves a %spx gap below and above anchors", (gap) => {
    sizeViewport();
    const anchor = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const panel = document.createElement("div");
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue(rect(0, 0, 150, 80));
    const measure = vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(rect(30, 40, 20, 20));
    positionAnchoredPortal(panel, anchor, gap);
    expect(panel.style.left).toBe("30px");
    expect(panel.style.top).toBe(`${60 + gap}px`);
    measure.mockReturnValue(rect(30, 260, 20, 20));
    positionAnchoredPortal(panel, anchor, gap);
    expect(panel.style.top).toBe(`${260 - 80 - gap}px`);
  });

  it.each([
    { anchor: rect(395, 30, 5, 20), panel: rect(0, 0, 150, 80), left: 242, top: 54 },
    { anchor: rect(-40, -60, 10, 20), panel: rect(0, 0, 150, 80), left: 8, top: 8 },
    { anchor: rect(200, 200, 20, 20), panel: rect(0, 0, 600, 500), left: 8, top: 8 },
    { anchor: rect(200, 500, 20, 20), panel: rect(0, 0, 150, 80), left: 200, top: 212 }
  ])("keeps viewport margins for clipped or oversized panels: $left/$top", (input) => {
    sizeViewport();
    const anchor = document.createElement("span"), panel = document.createElement("div");
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(input.anchor);
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue(input.panel);
    positionAnchoredPortal(panel, anchor);
    expect(panel.style.left).toBe(`${input.left}px`);
    expect(panel.style.top).toBe(`${input.top}px`);
  });

  it("flips an action overflow menu above its anchor instead of overlapping the anchor", () => {
    sizeViewport();
    const host = document.body.appendChild(document.createElement("div"));
    Object.defineProperties(host, { clientWidth: { value: 400 }, clientHeight: { value: 300 } });
    const api = createGrid(host, { rowKey: "id", pagination: false, rowData: [{ id: "1" }], columnDefs: [{ colId: "actions",
      cellRenderer: createActionButtonsRenderer({ max: 0, actions: [{ label: "View", onClick: vi.fn() }] }) }] });
    try {
      const measure = HTMLElement.prototype.getBoundingClientRect;
      const anchor = host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        if (this === anchor) return rect(100, 260, 60, 24);
        return this.classList.contains("mach-action-menu") ? rect(0, 0, 180, 100) : measure.call(this);
      });
      anchor.click();
      const panel = document.body.querySelector<HTMLElement>(".mach-action-menu")!;
      expect(panel.style.left).toBe("100px");
      expect(panel.style.top).toBe("156px");
      expect(document.activeElement).toBe(panel.querySelector("button"));
    } finally { api.destroy(); }
  });
});
