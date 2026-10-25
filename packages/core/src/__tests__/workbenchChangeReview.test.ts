// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { GridCore } from "../core/gridCore";
import { mountChangeReview } from "../workbench";
import type { SaveChangesHandler, SaveChangesResult } from "../types/api";

interface Row { id: string; amount: number }
const cleanups: Array<() => void> = [];
function setup(save?: SaveChangesHandler<Row>, count = 3) {
  const grid = document.createElement("div");
  Object.defineProperties(grid, { clientWidth: { value: 800 }, clientHeight: { value: 400 } });
  const host = document.createElement("div");
  const trigger = document.createElement("button");
  document.body.append(trigger, grid, host);
  const core = new GridCore<Row>(grid, { pagination: false, columnDefs: [{ field: "amount", editable: true, cellEditor: "number" }], rowKey: (row) => row.id,
    rowData: Array.from({ length: count }, (_, index) => ({ id: String(index + 1), amount: index + 1 })) });
  const api = core.getApi();
  trigger.focus();
  const review = mountChangeReview(host, { api, save });
  cleanups.push(() => { review.destroy(); api.destroy(); });
  return { core, api, review, host, trigger };
}
function click(host: HTMLElement, label: string): void {
  const control = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === label);
  if (!control) throw new Error(`Missing ${label}`);
  control.click();
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((complete) => { resolve = complete; }); return { promise, resolve }; }
function flush(): Promise<void> { return new Promise((resolve) => setTimeout(resolve, 0)); }
afterEach(() => { cleanups.splice(0).forEach((cleanup) => cleanup()); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("change review workbench", () => {
  it("shows original/new field values and supports row/all rollback", async () => {
    const { core, api, host } = setup();
    core.pasteText("10\n20", 0, 0);
    await flush();
    expect(host.querySelector("tbody")?.textContent).toContain("amount110");
    click(host.querySelector<HTMLElement>("article")!, "撤销本行");
    expect(api.rows.getById("1")?.data?.amount).toBe(1);
    expect(api.editing.getDirtyRowIds()).toEqual(["2"]);
    click(host, "撤销全部修改");
    expect(api.editing.getDirtyRowIds()).toEqual([]);
    expect(host.textContent).toContain("当前没有未保存");
  });

  it("uses labels from nested column groups in row diffs", async () => {
    const { api, core, host } = setup();
    api.columns.setDefinitions([{ headerName: "计划", children: [{ headerName: "数值", children: [
      { field: "amount", headerName: "金额", editable: true, cellEditor: "number" }
    ] }] }]);
    core.pasteText("10", 0, 0);
    await flush();
    expect(host.querySelector('th[scope="row"]')?.textContent).toBe("金额");
    expect(host.querySelector('th[scope="row"]')?.getAttribute("title")).toBe("amount");
  });

  it("disables save with a clear explanation when no handler is supplied", async () => {
    const { core, host } = setup();
    core.pasteText("10", 0, 0);
    await flush();
    const save = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "保存全部修改")!;
    expect(save.disabled).toBe(true);
    expect(host.textContent).toContain("尚未提供保存处理器");
  });

  it("retains each failure/conflict and retries only remaining failed records across repeated conflicts", async () => {
    const save = vi.fn<SaveChangesHandler<Row>>().mockResolvedValueOnce({ savedRowIds: ["1"], failures: [{ rowId: "2", message: "Invalid amount", colIds: ["amount"] }],
      conflicts: [{ rowId: "3", message: "Stale version", serverVersion: 2, serverData: { id: "3", amount: 30 } }] })
      .mockResolvedValueOnce({ savedRowIds: ["2"], conflicts: [{ rowId: "3", message: "Newer conflict", serverVersion: 3 }] })
      .mockResolvedValueOnce(undefined);
    const { core, api, host } = setup(save);
    core.pasteText("10\n20\n30", 0, 0);
    await flush();
    click(host, "保存全部修改");
    await flush();
    expect(api.editing.getDirtyRowIds()).toEqual(["2", "3"]);
    expect(host.textContent).toContain("Invalid amount");
    expect(host.textContent).toContain("服务端版本 2");
    expect(host.querySelector(".mach-review__cell--issue")).not.toBeNull();
    click(host, "仅重试失败与冲突");
    await flush();
    expect(save.mock.calls[1][0].map((row) => row.rowId)).toEqual(["2", "3"]);
    expect(host.textContent).toContain("Newer conflict");
    expect(host.textContent).toContain("服务端版本 3");
    click(host, "仅重试失败与冲突");
    await flush();
    expect(save.mock.calls[2][0].map((row) => row.rowId)).toEqual(["3"]);
    expect(api.editing.getDirtyRowIds()).toEqual([]);
  });

  it("preserves edits made during saving and prevents duplicate saves/rollback", async () => {
    const pending = deferred<void>();
    const save = vi.fn(() => pending.promise);
    const { core, api, host } = setup(save);
    core.pasteText("10", 0, 0);
    await flush();
    click(host, "保存全部修改");
    click(host, "保存全部修改");
    click(host, "撤销全部修改");
    expect(save).toHaveBeenCalledTimes(1);
    expect(host.querySelector("[aria-busy='true']")).not.toBeNull();
    core.pasteText("99", 0, 0);
    await flush();
    pending.resolve();
    await flush();
    expect(api.rows.getById("1")?.data?.amount).toBe(99);
    expect(api.editing.getChanges()[0].cells[0]).toMatchObject({ originalValue: 10, value: 99 });
    expect(host.querySelector("tbody")?.textContent).toContain("1099");
  });

  it.each(["replace", "destroy", "close"])("does not apply late result issues after %s", async (action) => {
    const pending = deferred<SaveChangesResult<Row>>();
    const { core, api, host, review } = setup(() => pending.promise);
    core.pasteText("10", 0, 0);
    await flush();
    click(host, "保存全部修改");
    if (action === "replace") { api.rows.setData([{ id: "1", amount: 100 }]); core.pasteText("101", 0, 0); }
    if (action === "destroy") api.destroy();
    if (action === "close") review.destroy();
    pending.resolve({ failures: [{ rowId: "1", message: "Stale failure" }] });
    await flush();
    expect(host.textContent).not.toContain("Stale failure");
    if (action === "replace") { expect(api.rows.getById("1")?.data?.amount).toBe(101); expect(api.editing.getDirtyRowIds()).toEqual(["1"]); }
    else expect(host.children).toHaveLength(0);
  });

  it("reports rejected requests as retryable failures without leaking rejection", async () => {
    const save = vi.fn<SaveChangesHandler<Row>>().mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce(undefined);
    const { core, api, host } = setup(save);
    core.pasteText("10", 0, 0);
    await flush();
    click(host, "保存全部修改");
    await flush();
    expect(host.textContent).toContain("Offline");
    click(host, "仅重试失败与冲突");
    await flush();
    expect(api.editing.getDirtyRowIds()).toEqual([]);
  });

  it("adopts the supplied server record only after an explicit conflict action", async () => {
    const { core, api, host } = setup(async () => ({ conflicts: [{ rowId: "1", message: "Version mismatch", serverData: { id: "1", amount: 88 }, serverVersion: 4 }] }));
    core.pasteText("10", 0, 0);
    await flush();
    click(host, "保存全部修改");
    await flush();
    expect(api.rows.getById("1")?.data?.amount).toBe(10);
    click(host, "采用服务端记录");
    expect(api.rows.getById("1")?.data?.amount).toBe(88);
    expect(api.editing.getDirtyRowIds()).toEqual([]);
  });

  it("retains local values when explicitly retrying a conflict and ignores stale action ownership", async () => {
    const save = vi.fn<SaveChangesHandler<Row>>().mockResolvedValueOnce({ conflicts: [{ rowId: "1", message: "Version mismatch", serverData: { id: "1", amount: 88 } }] }).mockResolvedValueOnce(undefined);
    const { core, api, host } = setup(save);
    core.pasteText("10", 0, 0);
    await flush();
    click(host, "保存全部修改");
    await flush();
    const staleAction = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "采用服务端记录")!;
    click(host, "保留本地并重试");
    await flush();
    expect(api.rows.getById("1")?.data?.amount).toBe(10);
    expect(api.editing.getDirtyRowIds()).toEqual([]);
    api.rows.setData([{ id: "1", amount: 100 }]);
    staleAction.click();
    expect(api.rows.getById("1")?.data?.amount).toBe(100);
  });

  it("explains a mismatched server row identity and retains local edits", async () => {
    const { core, api, host } = setup(async () => ({ conflicts: [{ rowId: "1", message: "Version mismatch", serverData: { id: "other", amount: 88 } }] }));
    core.pasteText("10", 0, 0);
    await flush();
    click(host, "保存全部修改");
    await flush();
    click(host, "采用服务端记录");
    expect(host.querySelector(".mach-workbench__status")?.textContent).toContain("行标识不一致");
    expect(api.rows.getById("1")?.data?.amount).toBe(10);
    expect(api.editing.getDirtyRowIds()).toEqual(["1"]);
  });

  it("paginates large dirty sets and restores the opening focus on Escape", async () => {
    const { core, host, trigger } = setup(undefined, 101);
    core.pasteText(Array.from({ length: 101 }, (_, index) => String(index + 1000)).join("\n"), 0, 0);
    await flush();
    expect(host.querySelectorAll("article")).toHaveLength(20);
    click(host, "下一页");
    expect(host.querySelectorAll("article")).toHaveLength(20);
    expect(host.querySelector("nav")?.textContent).toContain("第 2 / 6 页");
    host.querySelector<HTMLElement>(".mach-workbench")!.focus();
    host.querySelector<HTMLElement>(".mach-workbench")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.activeElement).toBe(trigger);
  });

  it("coalesces a bulk input into one bounded review render", async () => {
    const { core, host } = setup(undefined, 101);
    const body = host.querySelector<HTMLElement>(".mach-workbench__body")!;
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((changes) => records.push(...changes));
    observer.observe(body, { childList: true });
    core.pasteText(Array.from({ length: 101 }, (_, index) => String(index + 1000)).join("\n"), 0, 0);
    expect(body.querySelectorAll("article")).toHaveLength(0);
    await flush();
    observer.disconnect();
    expect(body.querySelectorAll("article")).toHaveLength(20);
    expect(records.length).toBeLessThanOrEqual(21);
  });

  it("paginates fields inside a wide changed row instead of creating unbounded cells", async () => {
    const grid = document.createElement("div");
    Object.defineProperties(grid, { clientWidth: { value: 800 }, clientHeight: { value: 400 } });
    const host = document.createElement("div");
    document.body.append(grid, host);
    const fields = Array.from({ length: 45 }, (_, index) => `field${index}`);
    const core = new GridCore<Record<string, unknown>>(grid, { pagination: false, rowKey: (row) => String(row.id),
      rowData: [{ id: "1", ...Object.fromEntries(fields.map((field) => [field, 0])) }],
      columnDefs: fields.map((field) => ({ field, editable: true })) });
    const panel = mountChangeReview(host, { api: core.getApi() });
    cleanups.push(() => { panel.destroy(); core.destroy(); });
    core.pasteText(fields.map(() => "1").join("\t"), 0, 0);
    await flush();
    expect(host.querySelectorAll("tbody tr")).toHaveLength(20);
    click(host, "下一组字段");
    expect(host.querySelectorAll("tbody tr")).toHaveLength(20);
    click(host, "下一组字段");
    expect(host.querySelectorAll("tbody tr")).toHaveLength(5);
    expect(host.textContent).toContain("字段第 41–45 / 45");
  });
});
