import { describe, expect, it, vi } from "vitest";
import { createMachTablePreset } from "../lib/presets";
import { resolveOptions } from "../core/resolveOptions";
import { normalizeGridState } from "../lib/gridState";
import {
  mergeMachTableConfig,
  normalizeMachTableConfig,
  resolveMachTableGridOptions
} from "../lib/configuration";

describe("built-in table scenes", () => {
  it("uses the standard list when no preset is declared", () => {
    const config = normalizeMachTableConfig();
    const { options, explain } = resolveMachTableGridOptions(config, undefined, {});
    expect(config.defaultPreset).toBe("list");
    expect(options).toEqual(expect.objectContaining({
      rowNumber: true, columnMenu: true, enableColumnResize: true
    }));
    expect(options.defaultColDef).toEqual({ filter: true });
    const resolved = resolveOptions(options);
    expect(resolved.paginationEnabled).toBe(true);
    expect(resolved.defaultColDef).toEqual(expect.objectContaining({
      sortable: true, filter: true, resizable: true, movable: true
    }));
    expect(options.rowSelection).not.toBe("multiple");
    expect(options.statusBar).not.toBe(true);
    expect(options.contextMenu).not.toBe(true);
    expect(explain("columnMenu").source).toBe("built-in preset:list");
  });

  it("provides a bounded, read-only detail without per-page tool flags", () => {
    const { options, explain } = resolveMachTableGridOptions(normalizeMachTableConfig(), "detail", {});
    expect(options).toEqual(expect.objectContaining({
      rowNumber: true, domLayout: "autoHeight", maxBodyHeight: 330,
      pagination: false, columnMenu: false, enableColumnResize: false, statusBar: false, contextMenu: false
    }));
    expect(options.defaultColDef).toEqual(expect.objectContaining({
      sortable: false, filter: false, resizable: false, movable: false, editable: false
    }));
    expect(explain("maxBodyHeight").source).toBe("built-in preset:detail");
  });

  it("keeps shared appearance and unrelated defaults while the chosen scene owns its tool defaults", () => {
    const config = normalizeMachTableConfig({ defaults: {
      theme: "dark", size: "compact", columnLayout: "fit", pagination: false,
      columnMenu: true, statusBar: true,
      defaultColDef: { sortable: false, filter: true, editable: true, maxWidth: 180 }
    } });
    const list = resolveMachTableGridOptions(config, undefined, {});
    expect(list.options).toEqual(expect.objectContaining({
      theme: "dark", size: "compact", columnLayout: "fit", pagination: false, statusBar: true
    }));
    expect(list.options.defaultColDef).toEqual({ sortable: false, filter: true, editable: true, maxWidth: 180 });
    const detail = resolveMachTableGridOptions(config, "detail", {});
    expect(detail.options).toEqual(expect.objectContaining({
      theme: "dark", size: "compact", columnLayout: "fit", columnMenu: false, statusBar: false
    }));
    expect(detail.options.defaultColDef).toEqual({
      sortable: false, filter: false, editable: false, maxWidth: 180, resizable: false, movable: false
    });
    expect(detail.explain("columnMenu")).toEqual({
      key: "columnMenu", value: false, source: "built-in preset:detail",
      layers: [
        { name: "application defaults", value: true },
        { name: "built-in preset:detail", value: false }
      ]
    });
    expect(detail.explain("theme").source).toBe("application defaults");
  });

  it("lets a table override individual detail defaults and keeps them out of other tables", () => {
    const config = normalizeMachTableConfig();
    const detail = resolveMachTableGridOptions(config, "detail", {
      rowNumber: false, maxBodyHeight: 210, defaultColDef: { editable: true }
    });
    expect(detail.options).toEqual(expect.objectContaining({ rowNumber: false, maxBodyHeight: 210 }));
    expect(detail.options.defaultColDef).toEqual(expect.objectContaining({ editable: true, sortable: false }));
    expect(detail.explain("maxBodyHeight")).toEqual({
      key: "maxBodyHeight", value: 210, source: "table props",
      layers: [
        { name: "built-in preset:detail", value: 330 },
        { name: "table props", value: 210 }
      ]
    });
    expect(resolveMachTableGridOptions(config, "detail", {}).options.maxBodyHeight).toBe(330);
    expect(resolveMachTableGridOptions(config, undefined, {}).options.columnMenu).toBe(true);
  });

  it("treats false and an empty preset list as explicit opt-outs", () => {
    for (const selection of [false, []] as const) {
      const { options } = resolveMachTableGridOptions(normalizeMachTableConfig(), selection, {});
      expect(options.rowNumber).toBe(true);
      expect(options.columnMenu).toBe(false);
      expect(options.domLayout).toBe("normal");
    }
    const disabled = normalizeMachTableConfig({ defaultPreset: false });
    expect(resolveMachTableGridOptions(disabled, undefined, {}).options.columnMenu).toBe(false);
    expect(resolveMachTableGridOptions(disabled, "detail", {}).options.domLayout).toBe("autoHeight");
  });

  it("resolves concrete native values when leaving a detail scene", () => {
    const config = normalizeMachTableConfig();
    const detail = resolveMachTableGridOptions(config, "detail", {}).options;
    const native = resolveMachTableGridOptions(config, false, {}).options;
    expect(detail.domLayout).toBe("autoHeight");
    expect(native).toEqual(expect.objectContaining({
      domLayout: "normal", pagination: true, columnMenu: false,
      enableColumnResize: false, statusBar: false, contextMenu: false, defaultColDef: {}
    }));
    expect(Object.getOwnPropertyDescriptor(native, "maxBodyHeight")).toEqual(expect.objectContaining({ value: undefined }));
    const list = resolveMachTableGridOptions(config, "list", {}).options;
    expect(list.domLayout).toBe("normal");
    expect(list.pagination).toBe(true);
    expect(list.defaultColDef).toEqual({ filter: true });
    expect(list.maxBodyHeight).toBeUndefined();
  });

  it("preserves complete custom presets with names matching the built-ins", () => {
    const config = normalizeMachTableConfig({
      presets: { list: { stripedRows: true }, detail: { size: "large" } }
    });
    const list = resolveMachTableGridOptions(config, undefined, {});
    expect(list.options.stripedRows).toBe(true);
    expect(list.options.columnMenu).toBe(false);
    expect(list.explain("stripedRows").source).toBe("preset:list");
    const detail = resolveMachTableGridOptions(config, "detail", {});
    expect(detail.options.size).toBe("large");
    expect(detail.options.domLayout).toBe("normal");
    expect(detail.options.defaultColDef).toEqual({});
  });

  it("extends a built-in explicitly using the existing preset composer", () => {
    const customized = createMachTablePreset("detail", {
      maxBodyHeight: 240, defaultColDef: { editable: true }
    });
    const config = normalizeMachTableConfig({ presets: { detail: customized } });
    const detail = resolveMachTableGridOptions(config, "detail", {});
    expect(detail.options).toEqual(expect.objectContaining({ maxBodyHeight: 240, pagination: false }));
    expect(detail.options.defaultColDef).toEqual(expect.objectContaining({ editable: true, movable: false }));
    expect(detail.explain("maxBodyHeight").source).toBe("preset:detail");
    const directCore = createMachTablePreset("list", { pagination: false });
    expect(directCore).toEqual(expect.objectContaining({ rowNumber: true, columnMenu: true, pagination: false }));
    expect(createMachTablePreset("detail", { rowNumber: false }).rowNumber).toBe(false);
    expect(() => Reflect.apply(createMachTablePreset, null, ["constructor"])).toThrow("Unknown built-in preset");
  });

  it("keeps preset arrays ordered without changing caller-owned business state", () => {
    const initialState = normalizeGridState({ version: 2, columns: [], sortModel: [{ colId: "quantity", direction: "desc" }] })!;
    const rows = [{ quantity: 2 }, { quantity: 1 }];
    const config = normalizeMachTableConfig({ presets: { editable: { defaultColDef: { editable: true } } } });
    const forward = resolveMachTableGridOptions(config, ["detail", "editable"], { rowData: rows, initialState });
    const backward = resolveMachTableGridOptions(config, ["editable", "detail"], {});
    expect(forward.options.defaultColDef?.editable).toBe(true);
    expect(backward.options.defaultColDef?.editable).toBe(false);
    expect(forward.options.initialState).toBe(initialState);
    expect(forward.options.rowData).toBe(rows);
    expect(initialState.sortModel).toEqual([{ colId: "quantity", direction: "desc" }]);
    expect(rows.map(row => row.quantity)).toEqual([2, 1]);
  });

  it("retains named parent customizations across nested scopes without reapplying a built-in", () => {
    const parent = normalizeMachTableConfig({
      presets: { detail: createMachTablePreset("detail", { maxBodyHeight: 210 }) },
      defaultPreset: "detail"
    });
    const child = mergeMachTableConfig(parent, { defaults: { theme: "dark" } });
    const detail = resolveMachTableGridOptions(child, undefined, {});
    expect(detail.options.maxBodyHeight).toBe(210);
    expect(detail.options.theme).toBe("dark");
    expect(detail.options.domLayout).toBe("autoHeight");
    expect(mergeMachTableConfig(parent, { defaultPreset: false }).defaultPreset).toBe(false);
  });

  it("returns fresh scene options, including values exposed by explain", () => {
    const config = normalizeMachTableConfig();
    const first = resolveMachTableGridOptions(config, "detail", {});
    first.options.defaultColDef!.editable = true;
    const source = first.explain("defaultColDef").layers[0].value as { sortable: boolean };
    source.sortable = true;
    const next = resolveMachTableGridOptions(config, "detail", {});
    expect(next.options.defaultColDef?.editable).toBe(false);
    expect(next.options.defaultColDef?.sortable).toBe(false);
    expect(createMachTablePreset("detail").defaultColDef?.editable).toBe(false);
  });

  it("does not resolve inherited names, but supports explicit special-name custom presets safely", () => {
    const warning = vi.fn();
    const empty = normalizeMachTableConfig();
    for (const name of ["toString", "constructor", "__proto__"]) {
      resolveMachTableGridOptions(empty, name, {}, warning);
    }
    expect(warning.mock.calls.map(([entry]) => entry.preset)).toEqual(["toString", "constructor", "__proto__"]);
    const special = normalizeMachTableConfig({
      presets: Object.fromEntries([["__proto__", { size: "compact" }], ["constructor", { theme: "dark" }]])
    });
    const merged = mergeMachTableConfig(empty, { presets: special.presets });
    expect(Object.getPrototypeOf(merged.presets)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(merged.presets, "__proto__")?.value).toEqual(expect.objectContaining({ size: "compact" }));
    expect(resolveMachTableGridOptions(merged, "__proto__", {}).options.size).toBe("compact");
    expect(resolveMachTableGridOptions(merged, "constructor", {}).options.theme).toBe("dark");
    expect(({} as { size?: string }).size).toBeUndefined();
  });

  it("does not inherit column policies through a runtime __proto__ option", () => {
    const defaults = JSON.parse('{"__proto__":{"defaultColDef":{"editable":true}}}');
    const config = normalizeMachTableConfig({ defaults, defaultPreset: false });
    expect(config.defaults.defaultColDef).toBeUndefined();
    expect(Object.getPrototypeOf(config.defaults)).toBe(Object.prototype);
    expect(resolveMachTableGridOptions(config, false, {}).options.defaultColDef).toEqual({});
  });

  it("retains strict instance isolation and warning behavior with the default scene", () => {
    expect(() => normalizeMachTableConfig({ defaults: { rowData: [] } as never })).toThrow("instance-only");
    const warning = vi.fn();
    const config = normalizeMachTableConfig({ strict: false, defaults: { rowData: [] } as never, onConfigWarning: warning });
    expect(config.defaultPreset).toBe("list");
    expect(Object.keys(config.defaults)).not.toContain("rowData");
    expect(warning).toHaveBeenCalledWith(expect.objectContaining({ code: "INVALID_DEFAULT_OPTION", option: "rowData" }));
  });
});
