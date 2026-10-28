import { describe, expect, it, vi } from "vitest";
import { createDictionaryColumn, type DictionaryColumnSource } from "../business";
import type { DictionaryEntry, DictionaryKey } from "../index";

function callbacks(config: Parameters<typeof createDictionaryColumn>[1] = {}, source: DictionaryColumnSource = { get: () => undefined }) {
  const column = createDictionaryColumn(source, config);
  return {
    format: (value: unknown) => column.valueFormatter!({ value } as any),
    parse: (value: unknown) => column.valueParser!({ value } as any),
    output: (value: unknown, target: "clipboard" | "csv" | "xlsx") => column.valueSerializer!({ value, target } as any)
  };
}

describe("explicit dictionary columns", () => {
  it("formats prepared labels while preserving typed raw codes in unspecified outputs", () => {
    const source = { get: vi.fn((key: DictionaryKey) => key === 0 ? "停用" : key === "001" ? "待下达" : undefined), resolve: vi.fn() };
    const { format, output } = callbacks({}, source);
    expect(format(0)).toBe("停用");
    expect(format("001")).toBe("待下达");
    expect(format("unknown")).toBe("unknown");
    for (const target of ["clipboard", "csv", "xlsx"] as const) {
      expect(output(0, target)).toBe(0);
      expect(output("001", target)).toBe("001");
      expect(output(null, target)).toBeNull();
      expect(output(undefined, target)).toBeUndefined();
      expect(output("", target)).toBe("");
    }
    expect(source.resolve).not.toHaveBeenCalled();
  });

  it("uses explicit per-target label and code-label policies without mutating input", () => {
    const entries = [{ value: "A", label: "已下达" }];
    const { format, output, parse } = callbacks({ options: entries, display: "code-label", output: { clipboard: "label", csv: "code-label" } });
    expect(format("A")).toBe("A · 已下达");
    expect(output("A", "clipboard")).toBe("已下达");
    expect(output("A", "csv")).toBe("A · 已下达");
    expect(output("A", "xlsx")).toBe("A");
    expect(parse("A · 已下达")).toBe("A");
    expect(entries).toEqual([{ value: "A", label: "已下达" }]);
  });

  it("keeps string and numeric raw keys distinct and gives raw codes priority over labels", () => {
    const { parse, format, output } = callbacks({ options: [
      { value: 1, label: "数字一" }, { value: "1", label: "文本一" }, { value: "X", label: "1" }, { value: 0, label: "零" }
    ] });
    expect(parse(1)).toBe(1);
    expect(parse("1")).toBe("1");
    expect(parse("数字一")).toBe(1);
    expect(parse("文本一")).toBe("1");
    expect(format(1)).toBe("数字一");
    expect(format("1")).toBe("文本一");
    expect(output(1, "xlsx")).toBe(1);
    expect(output("1", "xlsx")).toBe("1");
    expect(parse("0")).toBe(0);
    expect(parse(0)).toBe(0);
    expect(parse("零")).toBe(0);
    expect(parse("001")).toBe("001");
  });

  it("rejects ambiguous labels but accepts disambiguated code-label and raw code inputs", () => {
    const { parse } = callbacks({ options: [{ value: "A", label: "同名" }, { value: "B", label: "同名" }] });
    expect(() => parse("同名")).toThrow("Ambiguous dictionary value");
    expect(parse("A · 同名")).toBe("A");
    expect(parse("B")).toBe("B");
    expect(parse("未维护的历史码")).toBe("未维护的历史码");
  });

  it("rebuilds reverse indexes only when the immutable options snapshot is replaced", () => {
    let reads = 0;
    let options: readonly DictionaryEntry[] = [{ value: "A", get label() { reads++; return "旧名称"; } }];
    const { format, parse } = callbacks({ options: () => options });
    expect(parse("旧名称")).toBe("A");
    const afterBuild = reads;
    for (let index = 0; index < 20; index++) expect(parse("旧名称")).toBe("A");
    expect(reads).toBe(afterBuild);
    options = [{ value: "B", label: "新名称" }];
    expect(parse("旧名称")).toBe("旧名称");
    expect(parse("新名称")).toBe("B");
    expect(format("B")).toBe("新名称");
    expect(format("A")).toBe("A");
  });

  it("rejects collisions between a label and another entry's code-label output", () => {
    const { parse, output } = callbacks({ options: [{ value: "A", label: "Ready" }, { value: "B", label: "A · Ready" }], output: { csv: "code-label" } });
    expect(output("A", "csv")).toBe("A · Ready");
    expect(() => parse("A · Ready")).toThrow("Ambiguous dictionary value");
    expect(parse("A")).toBe("A");
    expect(parse("B · A · Ready")).toBe("B");
  });

  it("preserves null, undefined, empty input and unknown values for application validation", () => {
    const { format, parse, output } = callbacks({ options: [{ value: "blank", label: "" }], output: { csv: "label" } });
    for (const value of [null, undefined, "", false, 13]) expect(parse(value)).toBe(value);
    expect(format(null)).toBe("");
    expect(format("blank")).toBe("");
    expect(output("blank", "csv")).toBe("");
    expect(output("unknown", "csv")).toBe("unknown");
  });

  it("respects source values and display code without triggering remote resolution", () => {
    const { format, parse } = callbacks({ display: "code", options: [{ value: "A", label: "选项" }] }, { get: key => key === "X" ? "来源" : undefined });
    expect(format("A")).toBe("A");
    expect(parse("X")).toBe("X");
    expect(parse("选项")).toBe("A");
  });
});
