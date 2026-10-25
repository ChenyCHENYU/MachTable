// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGrid, type GridApi } from "../index";
import { mountAdvancedFilterBuilder, mountChangeReview, mountDiagnostics, type WorkbenchHandle } from "../workbench";
import { mountAnalysis } from "../analysis";

interface Row { id: string; amount: number }
const mounts: Array<[string, (host: HTMLElement, api: GridApi<Row>) => WorkbenchHandle]> = [
  ["filter", (host, api) => mountAdvancedFilterBuilder(host, { api })],
  ["review", (host, api) => mountChangeReview(host, { api })],
  ["diagnostics", (host, api) => mountDiagnostics(host, { api })],
  ["analysis", (host, api) => mountAnalysis(host, { api })]
];
const cleanups: Array<() => void> = [];
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("optional workbench theme ownership", () => {
  it("releases theme observation if mounting fails before a handle is returned", () => {
    const grid = document.createElement("div");
    const host = document.createElement("div");
    document.body.append(grid, host);
    const api = createGrid<Row>(grid, { rowData: [], columnDefs: [{ field: "amount" }] });
    cleanups.push(() => api.destroy());
    const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    vi.spyOn(MutationObserver.prototype, "observe").mockImplementationOnce(() => { throw new Error("Observer setup failed"); });
    expect(() => mountDiagnostics(host, { api })).toThrow("Observer setup failed");
    expect(disconnect).toHaveBeenCalledOnce();
    expect(host.children).toHaveLength(0);
  });

  it.each(mounts)("%s follows resolved auto theme and grid tokens outside the grid root", async (_name, mount) => {
    const listeners = new Set<() => void>();
    const media = { matches: true,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener) };
    const matchMedia = vi.fn(() => media);
    vi.stubGlobal("matchMedia", matchMedia);
    const grid = document.createElement("div");
    Object.defineProperties(grid, { clientWidth: { value: 800 }, clientHeight: { value: 400 } });
    const host = document.createElement("div");
    document.body.append(grid, host);
    const api = createGrid<Row>(grid, { theme: "auto", pagination: false, rowKey: "id",
      columnDefs: [{ field: "amount", filter: "number" }], rowData: [{ id: "1", amount: 2 }] });
    const source = api.view.getRoot()!;
    source.style.setProperty("--mach-primary", "#aabbcc");
    const mediaReads = matchMedia.mock.calls.length;
    const handle = mount(host, api);
    cleanups.push(() => { handle.destroy(); api.destroy(); });
    const panel = host.querySelector<HTMLElement>(".mach-workbench")!;
    expect(source.classList.contains("mach-theme-dark")).toBe(true);
    expect(panel.dataset.theme).toBe("dark");
    expect(panel.style.getPropertyValue("--mach-primary")).toBe("#aabbcc");
    expect(matchMedia.mock.calls.length).toBe(mediaReads);
    expect(listeners.size).toBe(1);

    media.matches = false;
    listeners.forEach(listener => listener());
    await tick();
    expect(source.classList.contains("mach-theme-dark")).toBe(false);
    expect(panel.dataset.theme).toBe("light");
    source.style.setProperty("--mach-primary", "#112233");
    await tick();
    expect(panel.style.getPropertyValue("--mach-primary")).toBe("#112233");
    api.updateOptions({ theme: "dark" });
    await tick();
    expect(panel.dataset.theme).toBe("dark");
    expect(listeners.size).toBe(0);

    const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    handle.destroy();
    expect(disconnect).toHaveBeenCalledOnce();
    api.updateOptions({ theme: "light" });
    await tick();
    expect(panel.isConnected).toBe(false);
    expect(panel.dataset.theme).toBe("dark");
  });
});
