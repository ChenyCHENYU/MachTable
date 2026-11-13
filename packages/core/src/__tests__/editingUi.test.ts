// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { actionsColumn, createGrid, rowActionsColumn } from "../index";
import type { ColDef } from "../index";

interface Person {
  id: string;
  name: string;
  age: number;
  status: string;
}

function createHost(width = 900): HTMLElement {
  const host = document.createElement("div");
  Object.defineProperty(host, "clientWidth", { value: width, configurable: true });
  Object.defineProperty(host, "clientHeight", { value: 360, configurable: true });
  document.body.appendChild(host);
  return host;
}

function flush(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

describe("polished editing UI", () => {
  it("renders a subtle cell edit affordance and inline confirm/cancel controls", async () => {
    const host = createHost();
    const api = createGrid<Person>(host, {
      columnDefs: [
        { field: "name", editable: true },
        { field: "age" }
      ],
      rowData: [{ id: "1", name: "Before", age: 20, status: "active" }],
      rowKey: (row) => row.id,
      editableIndicator: "always"
    });

    const trigger = host.querySelector<HTMLButtonElement>('.mach-cell[data-col-id="name"] .mach-cell-edit-trigger');
    expect(trigger).toBeTruthy();
    trigger!.click();
    const input = host.querySelector<HTMLInputElement>('.mach-cell[data-col-id="name"] .mach-editor-input')!;
    expect(host.querySelector(".mach-cell-editor-controls")).toBeTruthy();
    input.value = "Cancelled";
    host.querySelector<HTMLButtonElement>(".mach-edit-control--cancel")!.click();
    await flush();
    expect(api.rows.getById("1")?.data?.name).toBe("Before");

    host.querySelector<HTMLButtonElement>('.mach-cell[data-col-id="name"] .mach-cell-edit-trigger')!.click();
    const nextInput = host.querySelector<HTMLInputElement>('.mach-cell[data-col-id="name"] .mach-editor-input')!;
    nextInput.value = "Confirmed";
    host.querySelector<HTMLButtonElement>(".mach-edit-control--confirm")!.click();
    await flush();
    expect(api.rows.getById("1")?.data?.name).toBe("Confirmed");
    api.destroy();
  });

  it("keeps cell editing active through pointer movement, focusout and IME composition", async () => {
    const host = createHost();
    const api = createGrid<Person>(host, {
      columnDefs: [
        { field: "name", editable: true },
        { field: "age" }
      ],
      rowData: [
        { id: "1", name: "Before", age: 20, status: "active" },
        { id: "2", name: "Other", age: 21, status: "active" }
      ],
      rowKey: (row) => row.id
    });

    const cell = host.querySelector<HTMLElement>('.mach-row[data-index="0"] .mach-cell[data-col-id="name"]')!;
    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const input = cell.querySelector<HTMLInputElement>(".mach-editor-input")!;
    input.value = "Typing stays active";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    host.querySelector<HTMLElement>('.mach-row[data-index="1"] .mach-cell[data-col-id="age"]')!
      .dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      isComposing: true,
      bubbles: true,
      cancelable: true
    }));
    await flush();

    expect(cell.querySelector(".mach-editor-input")).toBe(input);
    expect(input.value).toBe("Typing stays active");
    expect(api.rows.getById("1")?.data?.name).toBe("Before");

    host.querySelector<HTMLButtonElement>(".mach-edit-control--confirm")!.click();
    await flush();
    expect(cell.querySelector(".mach-editor-input")).toBeNull();
    expect(api.rows.getById("1")?.data?.name).toBe("Typing stays active");
    api.destroy();
  });

  it.each([
    { key: "Enter", isComposing: true },
    { key: "Escape", isComposing: true },
    { key: "Tab", isComposing: true },
    { key: "Enter", keyCode: 229 }
  ])("keeps the full-row draft during IME $key ($keyCode)", async (eventInit) => {
    const host = createHost();
    const api = createGrid<Person>(host, {
      editType: "fullRow",
      columnDefs: [{ field: "name", editable: true }, { field: "age", editable: true }],
      rowKey: "id",
      rowData: [{ id: "1", name: "Before", age: 20, status: "active" }]
    });
    try {
      expect(api.editing.startRow(0)).toBe(true);
      const input = host.querySelector<HTMLInputElement>(".mach-editor-input")!;
      input.value = "中文输入未完成";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { ...eventInit, bubbles: true, cancelable: true }));
      await flush();

      expect(api.editing.isRowActive(0)).toBe(true);
      expect(host.querySelector(".mach-editor-input")).toBe(input);
      expect(document.activeElement).toBe(input);
      expect(input.value).toBe("中文输入未完成");
      expect(api.rows.getById("1")?.data?.name).toBe("Before");

      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      await flush();
      expect(api.editing.isRowActive()).toBe(false);
      expect(api.rows.getById("1")?.data?.name).toBe("中文输入未完成");
    } finally {
      api.destroy();
      host.remove();
    }
  });

  it("commits the active cell before moving to another editable cell", async () => {
    const host = createHost();
    const api = createGrid<Person>(host, {
      columnDefs: [
        { field: "name", editable: true },
        { field: "status", editable: true }
      ],
      rowData: [{ id: "1", name: "Before", age: 20, status: "active" }],
      rowKey: (row) => row.id
    });

    const nameCell = host.querySelector<HTMLElement>('.mach-cell[data-col-id="name"]')!;
    const statusCell = host.querySelector<HTMLElement>('.mach-cell[data-col-id="status"]')!;
    nameCell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const nameInput = nameCell.querySelector<HTMLInputElement>(".mach-editor-input")!;
    nameInput.value = "Committed on switch";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    statusCell.click();
    await flush();

    expect(api.rows.getById("1")?.data?.name).toBe("Committed on switch");
    expect(nameCell.querySelector(".mach-editor-input")).toBeNull();
    expect(statusCell.querySelector(".mach-editor-input")).toBeTruthy();
    api.destroy();
  });

  it("keeps the current editor when validation blocks a cell switch", async () => {
    const host = createHost();
    const api = createGrid<Person>(host, {
      columnDefs: [
        { field: "name", editable: true, validate: (value) => String(value).length > 2 || "Too short" },
        { field: "status", editable: true }
      ],
      rowData: [{ id: "1", name: "Before", age: 20, status: "active" }],
      rowKey: (row) => row.id
    });

    const nameCell = host.querySelector<HTMLElement>('.mach-cell[data-col-id="name"]')!;
    const statusCell = host.querySelector<HTMLElement>('.mach-cell[data-col-id="status"]')!;
    nameCell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const input = nameCell.querySelector<HTMLInputElement>(".mach-editor-input")!;
    input.value = "x";
    statusCell.click();
    await flush();

    expect(api.rows.getById("1")?.data?.name).toBe("Before");
    expect(nameCell.querySelector(".mach-editor-input")).toBe(input);
    expect(input.classList.contains("mach-editor-invalid")).toBe(true);
    expect(statusCell.querySelector(".mach-editor-input")).toBeNull();
    api.destroy();
  });

  it.each(["api", "click", "tab"])("keeps the intended row when sorting during an async %s switch", async (trigger) => {
    let resolve!: (valid: true) => void;
    const pending = new Promise<true>((done) => { resolve = done; });
    const host = createHost();
    const stopped = vi.fn();
    const api = createGrid(host, {
      columnDefs: [{ field: "age", editable: true, cellEditor: "number", validate: () => pending }],
      rowData: [{ id: "a", age: 2 }, { id: "b", age: 1 }], rowKey: "id", onCellEditingStopped: stopped
    });
    api.editing.startCell({ rowIndex: 0, colId: "age" });
    const input = host.querySelector<HTMLInputElement>(".mach-editor-input")!;
    input.value = "3";
    if (trigger === "tab") input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    else if (trigger === "click") host.querySelector<HTMLElement>('.mach-row[data-id="b"] .mach-cell[data-col-id="age"]')!.click();
    else api.editing.startCell({ rowIndex: 1, colId: "age" });
    api.sorting.setModel([{ colId: "age", direction: "asc" }]);
    resolve(true);
    await flush();
    const editor = host.querySelector<HTMLInputElement>(".mach-editor-input")!;
    expect(editor?.closest<HTMLElement>(".mach-row")?.dataset.id).toBe("b");
    expect(editor.value).toBe("1");
    expect(stopped).toHaveBeenCalledWith(expect.objectContaining({ rowIndex: 1, rowNode: expect.objectContaining({ id: "a" }) }));
    api.destroy();
  });

  it.each([
    ["api", "filter"], ["api", "remove"], ["api", "replace"], ["api", "columns"], ["api", "cancel"], ["api", "destroy"],
    ["click", "cancel"], ["click", "destroy"]
  ])("drops a queued %s editor after %s", async (trigger, action) => {
    let resolve!: (valid: true) => void;
    const pending = new Promise<true>((done) => { resolve = done; });
    const host = createHost();
    const defs: ColDef[] = [{ field: "age", editable: true, cellEditor: "number", validate: () => pending }];
    const api = createGrid(host, {
      columnDefs: defs, rowData: [{ id: "a", age: 2 }, { id: "b", age: 1 }], rowKey: "id"
    });
    api.editing.startCell({ rowIndex: 0, colId: "age" });
    host.querySelector<HTMLInputElement>(".mach-editor-input")!.value = "3";
    if (trigger === "click") host.querySelector<HTMLElement>('.mach-row[data-id="b"] .mach-cell[data-col-id="age"]')!.click();
    else api.editing.startCell({ rowIndex: 1, colId: "age" });
    if (action === "filter") api.filtering.setModel({ age: { type: "number", conditions: [{ match: "greaterThan", value: 1 }] } });
    if (action === "remove") api.rows.transact({ remove: [api.rows.getById("b")!.data!] });
    if (action === "replace") api.rows.setData([{ id: "b", age: 7 }]);
    if (action === "columns") api.columns.setDefinitions([{ ...defs[0], headerName: "New age" }]);
    if (action === "cancel") await api.editing.stop({ cancel: true });
    if (action === "destroy") api.destroy();
    resolve(true);
    await flush();
    expect(host.querySelector(".mach-editor-input")).toBeNull();
    api.destroy();
  });

  it.each(["api", "click"])("uses the latest queued %s editor and cancels a synchronously completed switch", async (trigger) => {
    let resolve!: (valid: true) => void;
    const pending = new Promise<true>((done) => { resolve = done; });
    const host = createHost();
    const api = createGrid(host, {
      columnDefs: [{ field: "age", editable: true, cellEditor: "number", validate: () => pending }],
      rowData: [{ id: "a", age: 1 }, { id: "b", age: 2 }, { id: "c", age: 3 }], rowKey: "id"
    });
    api.editing.startCell({ rowIndex: 0, colId: "age" });
    host.querySelector<HTMLInputElement>(".mach-editor-input")!.value = "4";
    if (trigger === "click") {
      host.querySelector<HTMLElement>('.mach-row[data-id="b"] .mach-cell[data-col-id="age"]')!.click();
      host.querySelector<HTMLElement>('.mach-row[data-id="c"] .mach-cell[data-col-id="age"]')!.click();
    } else {
      api.editing.startCell({ rowIndex: 1, colId: "age" });
      api.editing.startCell({ rowIndex: 2, colId: "age" });
    }
    resolve(true);
    await flush();
    expect(host.querySelector(".mach-editor-input")?.closest<HTMLElement>(".mach-row")?.dataset.id).toBe("c");
    await api.editing.stop({ cancel: true });
    api.columns.setDefinitions([{ field: "age", editable: true, cellEditor: "number" }]);
    api.editing.startCell({ rowIndex: 0, colId: "age" });
    api.editing.startCell({ rowIndex: 1, colId: "age" });
    await api.editing.stop({ cancel: true });
    await flush();
    expect(host.querySelector(".mach-editor-input")).toBeNull();
    api.destroy();
  });

  it("renders select option labels while preserving their stored values", async () => {
    const host = createHost();
    const api = createGrid<Person>(host, {
      columnDefs: [{
        field: "status",
        editable: true,
        cellEditor: "select",
        cellEditorParams: {
          options: [
            { label: "处理中", value: "active" },
            { label: "已完成", value: "done" }
          ]
        }
      }],
      rowData: [{ id: "1", name: "Before", age: 20, status: "active" }],
      rowKey: (row) => row.id
    });

    api.editing.startCell({ rowIndex: 0, colId: "status" });
    const select = host.querySelector<HTMLSelectElement>(".mach-editor-select")!;
    const trigger = host.querySelector<HTMLButtonElement>(".mach-editor-select-control .mach-select-trigger")!;
    expect(select.hidden).toBe(true);
    expect(trigger.textContent).toContain("处理中");
    expect([...select.options].map((option) => option.textContent)).toEqual(["处理中", "已完成"]);
    trigger.click();
    const done = [...document.querySelectorAll<HTMLButtonElement>(".mach-select-listbox [role=option]")]
      .find((option) => option.textContent === "已完成")!;
    done.click();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    host.querySelector<HTMLButtonElement>(".mach-edit-control--confirm")!.click();
    await flush();
    expect(api.rows.getById("1")?.data?.status).toBe("done");
    api.destroy();
  });

  it("stages a full row and switches the action column to save/cancel", async () => {
    const host = createHost();
    const started = vi.fn();
    const stopped = vi.fn();
    const api = createGrid<Person>(host, {
      editType: "fullRow",
      columnDefs: [
        { field: "name", editable: true },
        { field: "age", editable: true, cellEditor: "number" },
        { field: "status" },
        rowActionsColumn<Person>({
          onView: () => undefined,
          onDelete: () => undefined,
          labels: { view: "查看", edit: "编辑", delete: "删除", save: "保存", cancel: "取消" }
        })
      ],
      rowData: [{ id: "1", name: "Before", age: 20, status: "active" }],
      rowKey: (row) => row.id,
      onRowEditingStarted: started,
      onRowEditingStopped: stopped
    });

    host.querySelector<HTMLButtonElement>('[aria-label="编辑"]')!.click();
    expect(api.editing.isRowActive(0)).toBe(true);
    expect(host.querySelectorAll(".mach-row-editor-shell")).toHaveLength(2);
    expect(host.querySelector(".mach-cell-editor-controls")).toBeNull();
    expect(host.querySelector('[aria-label="保存"]')?.classList.contains("mach-action-btn--success")).toBe(true);
    expect(host.querySelector('[aria-label="取消"]')?.classList.contains("mach-action-btn--danger")).toBe(true);
    const inputs = host.querySelectorAll<HTMLInputElement>(".mach-row-editor-shell .mach-editor-input");
    inputs[1].focus();
    inputs[1].dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    inputs[1].click();
    expect(document.activeElement).toBe(inputs[1]);
    inputs[0].value = "Cancelled";
    inputs[1].value = "30";
    host.querySelector<HTMLButtonElement>('[aria-label="取消"]')!.click();
    await flush();
    expect(api.rows.getById("1")?.data).toMatchObject({ name: "Before", age: 20 });

    host.querySelector<HTMLButtonElement>('[aria-label="编辑"]')!.click();
    const committed = host.querySelectorAll<HTMLInputElement>(".mach-row-editor-shell .mach-editor-input");
    committed[0].value = "After";
    committed[1].value = "31";
    host.querySelector<HTMLButtonElement>('[aria-label="保存"]')!.click();
    await flush();
    expect(api.rows.getById("1")?.data).toMatchObject({ name: "After", age: 31 });
    expect(started).toHaveBeenCalledTimes(2);
    expect(stopped).toHaveBeenLastCalledWith(expect.objectContaining({ cancelled: false, changes: expect.any(Array) }));
    expect(api.editing.undo()).toBe(true);
    expect(api.rows.getById("1")?.data).toMatchObject({ name: "Before", age: 20 });
    api.destroy();
  });

  it("validates every staged cell before applying any row value", async () => {
    const host = createHost();
    const api = createGrid<Person>(host, {
      editType: "fullRow",
      columnDefs: [
        { field: "name", editable: true },
        {
          field: "age",
          editable: true,
          cellEditor: "number",
          validate: async (value) => Number(value) >= 18 || "Must be an adult"
        },
        rowActionsColumn<Person>()
      ],
      rowData: [{ id: "1", name: "Before", age: 20, status: "active" }],
      rowKey: (row) => row.id
    });

    host.querySelector<HTMLButtonElement>('[aria-label="编辑"]')!.click();
    const inputs = host.querySelectorAll<HTMLInputElement>(".mach-row-editor-shell .mach-editor-input");
    inputs[0].value = "Should not leak";
    inputs[1].value = "12";
    host.querySelector<HTMLButtonElement>('[aria-label="确认"]')!.click();
    await flush();
    expect(api.editing.isRowActive(0)).toBe(true);
    expect(api.rows.getById("1")?.data).toMatchObject({ name: "Before", age: 20 });
    expect(host.querySelector(".mach-editor-invalid")).toBeTruthy();

    inputs[1].value = "22";
    inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
    host.querySelector<HTMLButtonElement>('[aria-label="确认"]')!.click();
    await flush();
    expect(api.editing.isRowActive()).toBe(false);
    expect(api.rows.getById("1")?.data).toMatchObject({ name: "Should not leak", age: 22 });
    api.destroy();
  });

  it("supports async cross-field row validation with colId error mapping", async () => {
    const host = createHost();
    const validator = vi.fn(async ({ values }: { values: Readonly<Record<string, unknown>> }) =>
      Number(values.age) < 21 && values.name === "Supervisor"
        ? { age: "Supervisors must be at least 21" }
        : true
    );
    const api = createGrid<Person>(host, {
      editType: "fullRow",
      rowEditValidator: validator,
      columnDefs: [
        { field: "name", editable: true },
        { field: "age", editable: true, cellEditor: "number" },
        rowActionsColumn<Person>()
      ],
      rowData: [{ id: "1", name: "Before", age: 20, status: "active" }],
      rowKey: (row) => row.id
    });

    host.querySelector<HTMLButtonElement>('[aria-label="编辑"]')!.click();
    const inputs = host.querySelectorAll<HTMLInputElement>(".mach-row-editor-shell .mach-editor-input");
    inputs[0].value = "Supervisor";
    inputs[1].value = "19";
    host.querySelector<HTMLButtonElement>('[aria-label="确认"]')!.click();
    await flush();
    expect(validator).toHaveBeenCalledOnce();
    expect(api.rows.getById("1")?.data).toMatchObject({ name: "Before", age: 20 });
    expect(host.querySelector('.mach-cell[data-col-id="age"] .mach-editor-invalid')).toBeTruthy();

    inputs[1].value = "21";
    inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
    host.querySelector<HTMLButtonElement>('[aria-label="确认"]')!.click();
    await flush();
    expect(api.rows.getById("1")?.data).toMatchObject({ name: "Supervisor", age: 21 });
    api.destroy();
  });

  it("rolls back the row without emitting partial changes when a valueSetter rejects", async () => {
    const host = createHost();
    const changed = vi.fn();
    const api = createGrid<Person>(host, {
      editType: "fullRow",
      columnDefs: [
        { field: "name", editable: true },
        {
          field: "age",
          editable: true,
          cellEditor: "number",
          valueSetter: ({ data, newValue }) => {
            if (newValue === 13) return false;
            data.age = newValue;
            return true;
          }
        },
        rowActionsColumn<Person>()
      ],
      rowData: [{ id: "1", name: "Before", age: 20, status: "active" }],
      rowKey: (row) => row.id,
      onCellValueChanged: changed
    });

    host.querySelector<HTMLButtonElement>('[aria-label="编辑"]')!.click();
    const inputs = host.querySelectorAll<HTMLInputElement>(".mach-row-editor-shell .mach-editor-input");
    inputs[0].value = "Must roll back";
    inputs[1].value = "13";
    host.querySelector<HTMLButtonElement>('[aria-label="确认"]')!.click();
    await flush();
    expect(api.rows.getById("1")?.data).toMatchObject({ name: "Before", age: 20 });
    expect(api.editing.isRowActive(0)).toBe(true);
    expect(changed).not.toHaveBeenCalled();

    inputs[1].value = "23";
    inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
    host.querySelector<HTMLButtonElement>('[aria-label="确认"]')!.click();
    await flush();
    expect(api.rows.getById("1")?.data).toMatchObject({ name: "Must roll back", age: 23 });
    expect(changed).toHaveBeenCalledTimes(2);
    api.destroy();
  });
});

describe("action column modes", () => {
  it("uses host modal editing and keeps extra actions in the default overflow menu", () => {
    const host = createHost();
    const onView = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const api = createGrid<Person>(host, {
      columnDefs: [
        { field: "name" },
        rowActionsColumn<Person>({
          max: 3,
          onView,
          onEdit,
          onDelete,
          extraActions: [
            { icon: "copy", label: "复制", onClick: () => undefined }
          ],
          labels: { view: "查看", edit: "编辑", delete: "删除" }
        })
      ],
      rowData: [{ id: "1", name: "A", age: 20, status: "active" }]
    });

    expect(host.querySelector('[aria-label="查看"]')).toBeTruthy();
    host.querySelector<HTMLButtonElement>('[aria-label="编辑"]')!.click();
    expect(onEdit).toHaveBeenCalledOnce();
    expect(api.editing.isRowActive()).toBe(false);
    expect(host.querySelector('[aria-label="删除"]')).toBeTruthy();
    const more = host.querySelector<HTMLButtonElement>('[aria-label="更多操作"]')!;
    more.click();
    expect(document.querySelector('[role="menuitem"]')?.textContent).toBe("复制");
    api.destroy();
  });

  it("supports arbitrary actions inline without injecting view/edit/delete", () => {
    const host = createHost();
    const calls: string[] = [];
    const api = createGrid<Person>(host, {
      columnDefs: [
        { field: "name" },
        actionsColumn<Person>({
          overflow: "inline",
          max: 1,
          actions: [
            { icon: "copy", title: "Clone", onClick: () => calls.push("clone") },
            { icon: "download", title: "Export", onClick: () => calls.push("export") },
            { icon: "refresh", title: "Retry", onClick: () => calls.push("retry") },
            { icon: "plus", title: "Assign", onClick: () => calls.push("assign") }
          ]
        })
      ],
      rowData: [{ id: "1", name: "A", age: 20, status: "active" }]
    });
    expect(host.querySelectorAll(".mach-actions .mach-action-btn")).toHaveLength(4);
    expect(host.querySelector('[aria-label="More actions"]')).toBeNull();
    host.querySelector<HTMLButtonElement>('[aria-label="Retry"]')!.click();
    expect(calls).toEqual(["retry"]);
    api.destroy();
  });

  it("opens overflow actions in an accessible drawer and closes with Escape", () => {
    const host = createHost();
    const api = createGrid<Person>(host, {
      columnDefs: [
        { field: "name" },
        actionsColumn<Person>({
          max: 1,
          overflow: "drawer",
          drawerTitle: "更多操作",
          actions: [
            { icon: "view", title: "查看", onClick: () => undefined },
            { icon: "copy", label: "复制", onClick: () => undefined },
            { icon: "download", label: "导出", onClick: () => undefined }
          ]
        })
      ],
      rowData: [{ id: "1", name: "A", age: 20, status: "active" }]
    });
    const more = host.querySelector<HTMLButtonElement>('[aria-label="更多操作"]')!;
    more.click();
    expect(document.querySelector('[role="dialog"][aria-label="更多操作"]')).toBeTruthy();
    expect(more.getAttribute("aria-expanded")).toBe("true");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".mach-action-drawer-backdrop")).toBeNull();
    expect(more.getAttribute("aria-expanded")).toBe("false");
    api.destroy();
  });
});
