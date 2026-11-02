// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { GridCore } from "../core/gridCore";
import {
  createBusinessColumnTypes
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

describe("application value policies", () => {
  it("keeps raw row values while applying independent presentation and output callbacks", () => {
    const labels = new Map([["A", "已下达"]]);
    const label = (value: string) => labels.get(value) ?? value;
    const host = document.createElement("div");
    Object.defineProperties(host, { clientWidth: { value: 900 }, clientHeight: { value: 400 } });
    document.body.appendChild(host);
    const core = new GridCore(host, {
      rowKey: "id",
      columnDefs: [
        { field: "raw", cellRenderer: ({ value }) => label(value) },
        { field: "formatted", valueFormatter: ({ value }) => label(value) },
        { field: "serialized", valueSerializer: ({ value, target }) => `${target}:${label(value)}` },
        { field: "policy", valueFormatter: ({ value }) => label(value), valueSerializer: ({ value, target }) => target === "xlsx" ? value : target === "clipboard" ? `${value} · ${label(value)}` : label(value) }
      ],
      rowData: [{ id: "1", raw: "A", formatted: "A", serialized: "A", policy: "A" }]
    });
    try {
      expect(core.buildRangeTsv({ r1: 0, r2: 0, c1: 0, c2: 3 })).toBe("A\t已下达\tclipboard:已下达\tA · 已下达");
      expect(host.textContent).toContain("已下达");
      for (const target of ["csv", "xlsx"] as const) {
        expect(core.api.io.exportMatrix({ target, includeHeader: false })).toEqual([
          ["A", target === "xlsx" ? "A" : "已下达", `${target}:已下达`, target === "xlsx" ? "A" : "已下达"]
        ]);
      }
      expect(core.api.rows.getById("1")?.data).toEqual({ id: "1", raw: "A", formatted: "A", serialized: "A", policy: "A" });
    } finally {
      core.api.destroy();
      host.remove();
    }
  });
});
