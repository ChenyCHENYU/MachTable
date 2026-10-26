// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { GridCore } from "../core/gridCore";
import { mountDiagnostics } from "../workbench";

const cleanups: Array<() => void> = [];
function setup() {
  const grid = document.createElement("div");
  Object.defineProperties(grid, { clientWidth: { value: 800 }, clientHeight: { value: 400 } });
  const host = document.createElement("div");
  document.body.append(grid, host);
  const core = new GridCore(grid, { columnDefs: [{ field: "status" }], rowData: [{ id: "1", status: "warning" }], rowKey: (row) => row.id });
  cleanups.push(() => core.destroy());
  return { core, api: core.api, host };
}
function click(host: HTMLElement, text: string): void {
  [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === text)!.click();
}
afterEach(() => { cleanups.splice(0).forEach((cleanup) => cleanup()); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("optional diagnostics panel", () => {
  it("evaluates business policies only on an explicit row inspection, not mount or repaint", () => {
    const { api, host } = setup();
    const canDrag = vi.fn(() => "业务锁定");
    api.updateOptions({ rowDragPolicy: { canDrag }, manualSorting: true });
    const panel = mountDiagnostics(host, { api });
    cleanups.push(() => panel.destroy());
    const input = host.querySelector<HTMLInputElement>('[aria-label="检查记录 ID"]')!;
    input.value = "1";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    panel.refresh();
    expect(canDrag).not.toHaveBeenCalled();
    click(host, "检查记录");
    expect(canDrag).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("POLICY_REJECTED · 业务锁定");
    expect(host.textContent).toContain("宿主手动处理");
    expect(host.textContent).toContain("可能产生业务副作用");
    panel.refresh();
    click(host, "刷新诊断");
    expect(canDrag).toHaveBeenCalledOnce();
  });

  it("preserves body focus across refresh and Escape returns to the previously focused opener", () => {
    const { api, host } = setup();
    const opener = document.createElement("button");
    document.body.prepend(opener);
    opener.focus();
    const panel = mountDiagnostics(host, { api });
    cleanups.push(() => panel.destroy());
    const input = host.querySelector<HTMLInputElement>('[aria-label="检查记录 ID"]')!;
    input.value = "1";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
    panel.refresh();
    expect(host.querySelector<HTMLInputElement>('[aria-label="检查记录 ID"]')?.matches(":focus")).toBe(true);
    expect(host.querySelector<HTMLInputElement>('[aria-label="检查记录 ID"]')?.value).toBe("1");
    const temporary = document.createElement("button");
    host.querySelector(".mach-workbench__body")!.append(temporary);
    temporary.focus();
    panel.refresh();
    expect(host.querySelector(".mach-workbench")?.matches(":focus")).toBe(true);
    click(host, "检查记录");
    const rules = host.querySelector<HTMLElement>(".mach-diagnostics__rules")!;
    expect(rules.matches(":focus")).toBe(true);
    // Native click does not imply focus; the focused rules must survive body rebuilding.
    click(host, "刷新诊断");
    expect(rules.matches(":focus")).toBe(true);
    rules.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(host.children).toHaveLength(0);
    expect(opener.matches(":focus")).toBe(true);
  });

  it("does not steal external focus when a host refreshes diagnostics", () => {
    const { api, host } = setup();
    const panel = mountDiagnostics(host, { api });
    cleanups.push(() => panel.destroy());
    const external = document.createElement("input");
    document.body.prepend(external);
    external.focus();
    panel.refresh();
    expect(external.matches(":focus")).toBe(true);
  });

  it("shows public snapshots and reports missing configuration sources honestly", () => {
    const { api, host } = setup();
    const panel = mountDiagnostics(host, { api });
    cleanups.push(() => panel.destroy());
    expect(host.textContent).toContain("性能与调度快照");
    expect(host.textContent).toContain("未知（未传入配置解析器的 explain）");
    expect(host.textContent).toContain("尚无已记录错误");
  });

  it("uses a supplied configuration explanation instead of inferring its source", () => {
    const { api, host } = setup();
    const explain = vi.fn((key: string) => ({ key, value: "dark", source: "table", layers: [{ name: "defaults", value: "light" }, { name: "table", value: "dark" }] }));
    const panel = mountDiagnostics(host, { api, explain });
    cleanups.push(() => panel.destroy());
    expect(host.textContent).toContain("来源：table");
    expect(host.textContent).toContain('defaults: "light"');
    expect(explain).toHaveBeenCalledWith("theme");
  });

  it("evaluates only the selected row on demand and preserves first-match rule semantics", () => {
    const { api, host } = setup();
    const first = vi.fn(() => false);
    const second = vi.fn(() => true);
    const third = vi.fn(() => true);
    api.updateOptions({ rowStyleRules: [{ when: first, tone: "danger" }, { when: second, tone: "warning" }, { when: third, tone: "success" }] });
    first.mockClear(); second.mockClear(); third.mockClear();
    const panel = mountDiagnostics(host, { api });
    cleanups.push(() => panel.destroy());
    expect(first).not.toHaveBeenCalled();
    const input = host.querySelector<HTMLInputElement>('[aria-label="检查记录 ID"]')!;
    input.value = "1";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    click(host, "检查记录");
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(third).not.toHaveBeenCalled();
    expect(host.textContent).toContain("规则 2 · warning · 命中");
    expect(host.textContent).toContain("前序规则已命中");
  });

  it("refreshes errors manually and does not poll or mutate grid configuration", () => {
    const { core, api, host } = setup();
    const panel = mountDiagnostics(host, { api });
    cleanups.push(() => panel.destroy());
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    core.reportError(new Error("<img> bad input"), "validate");
    expect(host.textContent).not.toContain("bad input");
    click(host, "刷新诊断");
    expect(host.textContent).toContain("VALIDATION_ERROR · validate · <img> bad input");
    expect(host.querySelector("img")).toBeNull();
    expect(api.getOption("theme")).toBe("light");
    api.destroy();
    panel.refresh();
    expect(host.children).toHaveLength(0);
  });
});
