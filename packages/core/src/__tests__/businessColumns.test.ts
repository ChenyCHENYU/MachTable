// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createDictionaryColumn } from "../business";
import { GridCore } from "../core/gridCore";
import {
  createBusinessColumnTypes,
  createCachedDictionary,
  createDictionaryRenderer,
  createGrid,
  type GridApi
} from "../index";

describe("business column types", () => {
  it("formats common B-side values with safe locale rules", () => {
    const types = createBusinessColumnTypes({
      locale: "zh-CN",
      currency: "CNY",
      timeZone: "Asia/Shanghai",
      invalidText: "invalid"
    });
    const format = (name: keyof typeof types, value: unknown) => types[name].valueFormatter?.({ value } as any);

    expect(format("money", 1234.5)).toContain("1,234.5");
    expect(format("percent", 0.125)).toContain("12.5");
    expect(format("percentage", 12.5)).toContain("12.5");
    expect(format("boolean", true)).toBe("是");
    expect(format("date", "not-a-date")).toBe("invalid");
    expect(types.status.cellRenderer).toBe("statusTag");
  });
});

describe("cached dictionaries", () => {
  it("keeps dictionary display separate from explicit clipboard, CSV and XLSX policies", () => {
    const dictionary = createCachedDictionary<string>({ load: async () => [] });
    dictionary.prime([{ value: "A", label: "已下达" }]);
    const renderer = createDictionaryRenderer(dictionary);
    const host = document.createElement("div");
    Object.defineProperties(host, { clientWidth: { value: 900 }, clientHeight: { value: 400 } });
    document.body.appendChild(host);
    const core = new GridCore(host, {
      rowKey: "id",
      columnDefs: [
        { field: "raw", cellRenderer: renderer },
        { field: "formatted", cellRenderer: renderer, valueFormatter: ({ value }) => dictionary.get(value) ?? value },
        { field: "serialized", cellRenderer: renderer, valueSerializer: ({ value, target }) => `${target}:${dictionary.get(value) ?? value}` },
        { field: "policy", ...createDictionaryColumn(dictionary, { output: { clipboard: "code-label", csv: "label", xlsx: "code" } }) }
      ],
      rowData: [{ id: "1", raw: "A", formatted: "A", serialized: "A", policy: "A" }]
    });
    const api = core.api;
    try {
      expect(core.buildRangeTsv({ r1: 0, r2: 0, c1: 0, c2: 3 })).toBe("A\t已下达\tclipboard:已下达\tA · 已下达");
      expect(host.textContent).toContain("已下达");
      for (const target of ["csv", "xlsx"] as const) {
        expect(api.io.exportMatrix({ target, includeHeader: false })).toEqual([
          ["A", target === "xlsx" ? "A" : "已下达", `${target}:已下达`, target === "xlsx" ? "A" : "已下达"]
        ]);
      }
      expect(api.rows.getById("1")?.data).toEqual({ id: "1", raw: "A", formatted: "A", serialized: "A", policy: "A" });
    } finally {
      api.destroy();
      dictionary.destroy();
      host.remove();
    }
  });

  it("batches duplicate keys, caches results and supports invalidation", async () => {
    const load = vi.fn(async (keys: readonly number[]) => keys.map((value) => ({ value, label: `L${value}` })));
    const dictionary = createCachedDictionary<number>({ load, batchDelayMs: 0, maxSize: 2 });

    const [first, duplicate, second] = await Promise.all([
      dictionary.resolve(1),
      dictionary.resolve(1),
      dictionary.resolve(2)
    ]);
    expect([first, duplicate, second]).toEqual(["L1", "L1", "L2"]);
    expect(load).toHaveBeenCalledOnce();
    expect(load.mock.calls[0][0]).toEqual([1, 2]);
    expect(await dictionary.resolve(1)).toBe("L1");
    expect(load).toHaveBeenCalledOnce();

    dictionary.invalidate([1]);
    expect(await dictionary.resolve(1)).toBe("L1");
    expect(load).toHaveBeenCalledTimes(2);
    dictionary.destroy();
  });

  it("updates an attached renderer without mutating a destroyed cell", async () => {
    let finish!: (value: readonly { value: string; label: string }[]) => void;
    const dictionary = createCachedDictionary<string>({
      load: () => new Promise((resolve) => { finish = resolve; })
    });
    const renderer = createDictionaryRenderer(dictionary, { loadingText: "loading" });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const api: GridApi<{ id: string; code: string }> = createGrid(host, {
      columnDefs: [{ field: "code", cellRenderer: renderer }],
      rowData: [{ id: "1", code: "A" }],
      rowKey: (row) => row.id
    });
    const value = host.querySelector(".mach-dictionary-value") as HTMLElement;
    expect(value.textContent).toBe("loading");
    await new Promise((resolve) => setTimeout(resolve, 0));
    finish([{ value: "A", label: "启用" }]);
    await Promise.resolve();
    await Promise.resolve();
    expect(value.textContent).toBe("启用");
    api.destroy();
    dictionary.destroy();
  });
});
