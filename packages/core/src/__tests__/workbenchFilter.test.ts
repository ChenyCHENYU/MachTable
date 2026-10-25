// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGrid } from "../index";
import { mountAdvancedFilterBuilder } from "../workbench";
import type { AdvancedFilterModel, GridApi } from "../index";

interface Row { id: string; amount: number; name: string; date: string; status: number | null }
const cleanups: Array<() => void> = [];

function setup() {
  const trigger = document.createElement("button");
  trigger.textContent = "打开筛选";
  const grid = document.createElement("div");
  Object.defineProperties(grid, { clientWidth: { value: 800 }, clientHeight: { value: 400 } });
  const host = document.createElement("div");
  document.body.append(trigger, grid, host);
  const api: GridApi<Row> = createGrid<Row>(grid, {
    rowKey: (row) => row.id,
    columnDefs: [{ field: "amount", cellEditor: "number" }, { field: "name" }, { field: "date", filter: "date" }, {
      field: "status", filter: "set", cellEditorParams: { options: [{ label: "已完成", value: 1 }, { label: "待处理", value: 2 }] }
    }],
    rowData: [{ id: "1", amount: 2, name: "Alpha", date: "2026-10-25", status: 1 }]
  });
  trigger.focus();
  const builder = mountAdvancedFilterBuilder(host, { api });
  cleanups.push(() => { builder.destroy(); api.destroy(); });
  return { host, api, builder, trigger };
}

function click(host: HTMLElement, text: string): void {
  const control = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === text);
  if (!control) throw new Error(`Missing ${text}`);
  control.click();
}

function input(host: HTMLElement, label: string, value: string): void {
  const control = host.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`)!;
  control.value = value;
  control.dispatchEvent(new Event(control.tagName === "INPUT" ? "input" : "change", { bubbles: true }));
}

afterEach(() => { cleanups.splice(0).forEach((cleanup) => cleanup()); document.body.replaceChildren(); });

describe("advanced filter workbench", () => {
  it("keeps drafts separate, validates typed values and applies through GridApi", () => {
    const { host, api, builder } = setup();
    click(host, "添加条件");
    expect(api.filtering.getAdvancedModel()).toBeNull();
    expect(host.querySelector<HTMLButtonElement>(".mach-workbench__button--primary")!.disabled).toBe(true);
    input(host, "筛选值", "2");
    expect(builder.apply()).toBe(true);
    expect(api.filtering.getAdvancedModel()).toEqual({ version: 1, root: { kind: "condition", colId: "amount", filter: { type: "number", conditions: [{ match: "equals", value: 2 }] } } });
  });

  it("infers nested column fields in definition order", () => {
    const { api, host, builder } = setup();
    api.columns.setDefinitions([{ headerName: "计划", children: [{ field: "name", headerName: "名称" }, {
      headerName: "数值", children: [{ field: "amount", headerName: "金额", filter: "number" }]
    }] }]);
    click(host, "添加条件");
    const fields = host.querySelector<HTMLSelectElement>('[aria-label="筛选字段"]')!;
    expect([...fields.options].map(option => [option.value, option.textContent])).toEqual([["name", "名称"], ["amount", "金额"]]);
    expect(builder.getDraft()?.root).toMatchObject({ colId: "name", filter: { type: "text" } });
  });

  it("round-trips nested AND/OR/NOT and multiple field conditions without mutating snapshots", () => {
    const { api, builder } = setup();
    const model: AdvancedFilterModel = { version: 1, root: { kind: "group", operator: "and", not: true, children: [
      { kind: "condition", colId: "amount", filter: { type: "number", operator: "or", conditions: [{ match: "inRange", value: 1, value2: 8 }, { match: "blank" }] } },
      { kind: "group", operator: "or", children: [{ kind: "condition", colId: "name", filter: { type: "text", conditions: [{ match: "startsWith", value: "A" }] } }] }
    ] } };
    builder.setDraft(model);
    const snapshot = builder.getDraft()!;
    expect(snapshot).toEqual(model);
    snapshot.root = { kind: "group", operator: "and", children: [] };
    expect(builder.getDraft()).toEqual(model);
    expect(builder.apply()).toBe(true);
    expect(api.filtering.getAdvancedModel()).toEqual(model);
    expect(model.root.kind).toBe("group");
  });

  it("renders and edits nested group relationships with keyboard-focus continuity", () => {
    const { host, builder } = setup();
    click(host, "添加条件组");
    expect(builder.apply()).toBe(false);
    click(host, "添加条件");
    input(host, "筛选值", "3");
    input(host, "条件组关系", "or");
    expect((document.activeElement as HTMLElement).getAttribute("aria-label")).toBe("条件组关系");
    const not = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    not.click();
    expect(builder.getDraft()?.root).toMatchObject({ kind: "group", operator: "or", not: true });
    expect(builder.apply()).toBe(true);
  });

  it("preserves missing fields visibly and refuses a lossy Apply", () => {
    const { host, api, builder } = setup();
    builder.setDraft({ version: 1, root: { kind: "condition", colId: "retired", filter: { type: "text", conditions: [{ match: "equals", value: "keep me" }] } } });
    expect(host.textContent).toContain("已移除字段");
    expect(builder.apply()).toBe(false);
    expect(builder.getDraft()?.root).toMatchObject({ colId: "retired" });
    expect(api.filtering.getAdvancedModel()).toBeNull();
    input(host, "筛选字段", "name");
    input(host, "筛选值", "Alpha");
    expect(builder.apply()).toBe(true);
  });

  it("detects fields removed or retyped after mounting", () => {
    const { host, api, builder } = setup();
    builder.setDraft({ version: 1, root: { kind: "condition", colId: "amount", filter: { type: "number", conditions: [{ match: "equals", value: 2 }] } } });
    api.columns.setDefinitions([{ field: "amount", filter: "text" }]);
    builder.refresh();
    expect(builder.apply()).toBe(false);
    expect(host.textContent).toContain("字段类型已改变");
    click(host, "重置字段条件");
    input(host, "筛选值", "2");
    expect(builder.apply()).toBe(true);
    api.columns.setDefinitions([{ field: "name" }]);
    builder.refresh();
    expect(builder.apply()).toBe(false);
    expect(builder.getDraft()?.root).toMatchObject({ colId: "amount" });
  });

  it("uses dictionary labels while preserving number/null values and unknown selections", () => {
    const { host, api, builder } = setup();
    builder.setDraft({ version: 1, root: { kind: "condition", colId: "status", filter: { type: "set", values: [1, null] } } });
    expect(host.textContent).toContain("已完成");
    expect(host.textContent).toContain("当前字典外");
    expect(builder.apply()).toBe(true);
    expect(api.filtering.getAdvancedModel()?.root).toMatchObject({ filter: { type: "set", values: [1, null] } });
  });

  it("infers a bounded set dictionary from current rows when explicit values are omitted", () => {
    const { host, api, builder } = setup();
    api.columns.setDefinitions([{ field: "name", filter: "set" }]);
    builder.refresh();
    click(host, "添加条件");
    expect(host.querySelector<HTMLSelectElement>('[aria-label="字典选项（支持多选）"]')?.textContent).toContain("Alpha");
  });

  it("rejects invalid intervals and leaves the applied model intact", () => {
    const { host, api, builder } = setup();
    builder.setDraft({ version: 1, root: { kind: "condition", colId: "amount", filter: { type: "number", conditions: [{ match: "inRange", value: 5, value2: 2 }] } } });
    expect(builder.apply()).toBe(false);
    expect(host.textContent).toContain("区间起点不能大于终点");
    expect(api.filtering.getAdvancedModel()).toBeNull();
  });

  it("rejects calendar-invalid dates and expression budgets without dropping nodes", () => {
    const { builder, host } = setup();
    builder.setDraft({ version: 1, root: { kind: "condition", colId: "date", filter: { type: "date", conditions: [{ match: "equals", value: "2026-02-31" }] } } });
    expect(builder.apply()).toBe(false);
    expect(host.textContent).toContain("有效筛选值");
    const condition = { kind: "condition", colId: "amount", filter: { type: "number", conditions: [{ match: "equals", value: 2 }] } } as const;
    expect(() => builder.setDraft({ version: 1, root: { kind: "group", operator: "and", children: Array.from({ length: 513 }, () => JSON.parse(JSON.stringify(condition))) } })).toThrow("草稿未被替换");
    expect(builder.getDraft()?.root).toMatchObject({ colId: "date" });
  });

  it("rejects malformed or truncated imports rather than silently pruning them", () => {
    const { builder } = setup();
    const before = builder.getDraft();
    const model = { version: 1, root: { kind: "group", operator: "and", children: [{ kind: "mystery" }, { kind: "condition", colId: "amount", filter: { type: "number", conditions: [{ match: "equals", value: 2 }] } }] } };
    expect(() => builder.setDraft(model as AdvancedFilterModel)).toThrow("草稿未被替换");
    expect(builder.getDraft()).toEqual(before);
  });

  it("retains local drafts when filters change externally, and Cancel reloads the current API model", () => {
    const { host, api, builder } = setup();
    click(host, "添加条件");
    input(host, "筛选值", "3");
    const model: AdvancedFilterModel = { version: 1, root: { kind: "condition", colId: "name", filter: { type: "text", conditions: [{ match: "equals", value: "Alpha" }] } } };
    api.filtering.setAdvancedModel(model);
    expect(host.textContent).toContain("当前草稿已保留");
    expect(builder.getDraft()?.root).toMatchObject({ colId: "amount" });
    builder.cancel();
    expect(builder.getDraft()).toEqual(model);
  });

  it("clears through an explicit draft and Apply, without clearing immediately", () => {
    const { host, api, builder } = setup();
    click(host, "添加条件");
    input(host, "筛选值", "2");
    builder.apply();
    click(host, "清空草稿");
    expect(api.filtering.getAdvancedModel()).not.toBeNull();
    builder.apply();
    expect(api.filtering.getAdvancedModel()).toBeNull();
  });

  it("destroys idempotently and restores the opening trigger on Escape", () => {
    const { host, builder, trigger } = setup();
    host.querySelector<HTMLElement>(".mach-workbench")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(host.children).toHaveLength(0);
    expect(document.activeElement).toBe(trigger);
    builder.destroy();
    expect(builder.apply()).toBe(false);
  });

  it("unsubscribes and does not repaint when the grid is destroyed", () => {
    const { host, api, builder } = setup();
    api.destroy();
    builder.refresh();
    expect(host.children).toHaveLength(0);
  });

  it("accepts explicit descriptors only for existing schema fields", () => {
    const { api, builder, host } = setup();
    builder.destroy();
    const panel = mountAdvancedFilterBuilder(host, { api, fields: [{ colId: "name", label: "名称", type: "text" }, { colId: "missing", type: "number" }] });
    cleanups.push(() => panel.destroy());
    click(host, "添加条件");
    const select = host.querySelector<HTMLSelectElement>('[aria-label="筛选字段"]')!;
    expect([...select.options].map((option) => option.textContent)).toEqual(["名称"]);
  });

  it("keeps untrusted text as text content", () => {
    const { api, host, builder } = setup();
    builder.destroy();
    const panel = mountAdvancedFilterBuilder(host, { api, fields: [{ colId: "name", label: '<img src=x onerror="alert(1)">' }] });
    cleanups.push(() => panel.destroy());
    click(host, "添加条件");
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toContain("<img");
  });

  it("does not invoke the close callback after a plain programmatic refresh", () => {
    const { api, host, builder } = setup();
    builder.destroy();
    const onClose = vi.fn();
    const panel = mountAdvancedFilterBuilder(host, { api, onClose });
    cleanups.push(() => panel.destroy());
    panel.refresh();
    expect(onClose).not.toHaveBeenCalled();
    click(host, "取消");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
