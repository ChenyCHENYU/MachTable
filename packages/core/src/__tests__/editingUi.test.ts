// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { actionsColumn, createGrid, rowActionsColumn } from "../index";

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
      getRowId: (params) => params.data.id,
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
    expect(api.getNodeById("1")?.data?.name).toBe("Before");

    host.querySelector<HTMLButtonElement>('.mach-cell[data-col-id="name"] .mach-cell-edit-trigger')!.click();
    const nextInput = host.querySelector<HTMLInputElement>('.mach-cell[data-col-id="name"] .mach-editor-input')!;
    nextInput.value = "Confirmed";
    host.querySelector<HTMLButtonElement>(".mach-edit-control--confirm")!.click();
    await flush();
    expect(api.getNodeById("1")?.data?.name).toBe("Confirmed");
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
      getRowId: (params) => params.data.id,
      onRowEditingStarted: started,
      onRowEditingStopped: stopped
    });

    host.querySelector<HTMLButtonElement>('[aria-label="编辑"]')!.click();
    expect(api.isRowEditing(0)).toBe(true);
    expect(host.querySelectorAll(".mach-row-editor-shell")).toHaveLength(2);
    expect(host.querySelector(".mach-cell-editor-controls")).toBeNull();
    expect(host.querySelector('[aria-label="保存"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="取消"]')).toBeTruthy();
    const inputs = host.querySelectorAll<HTMLInputElement>(".mach-row-editor-shell .mach-editor-input");
    inputs[0].value = "Cancelled";
    inputs[1].value = "30";
    host.querySelector<HTMLButtonElement>('[aria-label="取消"]')!.click();
    await flush();
    expect(api.getNodeById("1")?.data).toMatchObject({ name: "Before", age: 20 });

    host.querySelector<HTMLButtonElement>('[aria-label="编辑"]')!.click();
    const committed = host.querySelectorAll<HTMLInputElement>(".mach-row-editor-shell .mach-editor-input");
    committed[0].value = "After";
    committed[1].value = "31";
    host.querySelector<HTMLButtonElement>('[aria-label="保存"]')!.click();
    await flush();
    expect(api.getNodeById("1")?.data).toMatchObject({ name: "After", age: 31 });
    expect(started).toHaveBeenCalledTimes(2);
    expect(stopped).toHaveBeenLastCalledWith(expect.objectContaining({ cancelled: false, changes: expect.any(Array) }));
    expect(api.undo()).toBe(true);
    expect(api.getNodeById("1")?.data).toMatchObject({ name: "Before", age: 20 });
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
      getRowId: (params) => params.data.id
    });

    host.querySelector<HTMLButtonElement>('[aria-label="编辑"]')!.click();
    const inputs = host.querySelectorAll<HTMLInputElement>(".mach-row-editor-shell .mach-editor-input");
    inputs[0].value = "Should not leak";
    inputs[1].value = "12";
    host.querySelector<HTMLButtonElement>('[aria-label="确认"]')!.click();
    await flush();
    expect(api.isRowEditing(0)).toBe(true);
    expect(api.getNodeById("1")?.data).toMatchObject({ name: "Before", age: 20 });
    expect(host.querySelector(".mach-editor-invalid")).toBeTruthy();

    inputs[1].value = "22";
    inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
    host.querySelector<HTMLButtonElement>('[aria-label="确认"]')!.click();
    await flush();
    expect(api.isRowEditing()).toBe(false);
    expect(api.getNodeById("1")?.data).toMatchObject({ name: "Should not leak", age: 22 });
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
      getRowId: (params) => params.data.id
    });

    host.querySelector<HTMLButtonElement>('[aria-label="编辑"]')!.click();
    const inputs = host.querySelectorAll<HTMLInputElement>(".mach-row-editor-shell .mach-editor-input");
    inputs[0].value = "Supervisor";
    inputs[1].value = "19";
    host.querySelector<HTMLButtonElement>('[aria-label="确认"]')!.click();
    await flush();
    expect(validator).toHaveBeenCalledOnce();
    expect(api.getNodeById("1")?.data).toMatchObject({ name: "Before", age: 20 });
    expect(host.querySelector('.mach-cell[data-col-id="age"] .mach-editor-invalid')).toBeTruthy();

    inputs[1].value = "21";
    inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
    host.querySelector<HTMLButtonElement>('[aria-label="确认"]')!.click();
    await flush();
    expect(api.getNodeById("1")?.data).toMatchObject({ name: "Supervisor", age: 21 });
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
      getRowId: (params) => params.data.id,
      onCellValueChanged: changed
    });

    host.querySelector<HTMLButtonElement>('[aria-label="编辑"]')!.click();
    const inputs = host.querySelectorAll<HTMLInputElement>(".mach-row-editor-shell .mach-editor-input");
    inputs[0].value = "Must roll back";
    inputs[1].value = "13";
    host.querySelector<HTMLButtonElement>('[aria-label="确认"]')!.click();
    await flush();
    expect(api.getNodeById("1")?.data).toMatchObject({ name: "Before", age: 20 });
    expect(api.isRowEditing(0)).toBe(true);
    expect(changed).not.toHaveBeenCalled();

    inputs[1].value = "23";
    inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
    host.querySelector<HTMLButtonElement>('[aria-label="确认"]')!.click();
    await flush();
    expect(api.getNodeById("1")?.data).toMatchObject({ name: "Must roll back", age: 23 });
    expect(changed).toHaveBeenCalledTimes(2);
    api.destroy();
  });
});

describe("action column modes", () => {
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
