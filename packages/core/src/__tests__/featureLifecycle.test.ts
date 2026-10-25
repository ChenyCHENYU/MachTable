// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGrid, type GridApi, type GridFeature } from "../index";

let api: GridApi | undefined;
let host: HTMLElement;
afterEach(() => { api?.destroy(); host?.remove(); vi.restoreAllMocks(); });

function mount(features: GridFeature[] = []): GridApi {
  host = document.createElement("div");
  document.body.append(host);
  return api = createGrid(host, { features, columnDefs: [{ field: "id" }], rowData: [{ id: "a" }] });
}

describe("reentrant feature resource ownership", () => {
  it("releases a feature that destroys its grid synchronously during setup", () => {
    const release = vi.fn(), destroy = vi.fn(), listener = vi.fn();
    const frame = vi.spyOn(globalThis, "requestAnimationFrame");
    const table = mount([{ key: "destroy-in-setup", setup(context) {
      context.addManagedDomListener(document, "mach-feature", listener);
      frame.mockClear();
      context.api.destroy();
      return release;
    }, destroy }]);
    document.dispatchEvent(new Event("mach-feature"));
    expect(table.isDestroyed()).toBe(true);
    expect(listener).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
    expect(frame).not.toHaveBeenCalled();
    table.destroy();
    expect(release).toHaveBeenCalledOnce();
  });

  it("keeps only the newest feature installation after setup replaces features", () => {
    const staleCleanup = vi.fn(), staleDestroy = vi.fn(), skipped = vi.fn(), currentCleanup = vi.fn();
    mount([{ key: "stale", setup(context) {
      context.api.updateOptions({ features: [{ key: "current", setup: () => currentCleanup }] });
      return staleCleanup;
    }, destroy: staleDestroy }, { key: "skipped", setup: skipped }]);
    expect(api!.diagnostics.get().activeFeatures.map(feature => feature.key)).toEqual(["current"]);
    expect(staleCleanup).toHaveBeenCalledOnce();
    expect(staleDestroy).toHaveBeenCalledOnce();
    expect(skipped).not.toHaveBeenCalled();
    api!.destroy();
    expect(currentCleanup).toHaveBeenCalledOnce();
  });

  it("does not overwrite an installation created by an old feature's cleanup", () => {
    const stale = vi.fn(), currentCleanup = vi.fn();
    mount([{ key: "old", setup(context) { return () => context.api.updateOptions({ features: [{ key: "current", setup: () => currentCleanup }] }); } }]);
    api!.updateOptions({ features: [{ key: "stale", setup: stale }] });
    expect(stale).not.toHaveBeenCalled();
    expect(api!.diagnostics.get().activeFeatures.map(feature => feature.key)).toEqual(["current"]);
    api!.destroy();
    expect(currentCleanup).toHaveBeenCalledOnce();
  });
});
