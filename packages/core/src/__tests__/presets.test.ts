// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createGrid, createStatusTagRenderer, createActionButtonsRenderer } from "../index";
import type { GridApi } from "../index";

interface Row {
  id: string;
  name: string;
  status: string;
  progress: number;
}

const rows: Row[] = [
  { id: "1", name: "a", status: "运行中", progress: 62 },
  { id: "2", name: "b", status: "故障", progress: 100 },
  { id: "3", name: "c", status: "custom-state", progress: 0 }
];

function createHost(): HTMLElement {
  const host = document.createElement("div");
  Object.defineProperty(host, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(host, "clientHeight", { value: 400, configurable: true });
  document.body.appendChild(host);
  return host;
}

function cellAt(host: HTMLElement, row: number, colId: string): HTMLElement {
  const cells = host.querySelectorAll(
    `.mach-row[data-index="${row}"] .mach-cell[data-col-id="${colId}"]`
  );
  if (cells.length === 0) throw new Error(`cell ${row}/${colId} missing`);
  return cells[0] as HTMLElement;
}

describe("preset renderers", () => {
  it("statusTag maps well-known values to semantic variants", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [
        { field: "name", headerName: "Name" },
        { field: "status", headerName: "Status", cellRenderer: "statusTag" }
      ],
      rowData: rows,
      getRowId: (p) => p.data.id
    });
    expect(cellAt(host, 0, "status").querySelector(".mach-tag--success")).toBeTruthy();
    expect(cellAt(host, 1, "status").querySelector(".mach-tag--danger")).toBeTruthy();
    expect(cellAt(host, 2, "status").querySelector(".mach-tag--neutral")).toBeTruthy();
    api.destroy();
  });

  it("createStatusTagRenderer honors custom variant/label maps", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [
        { field: "status", headerName: "Status",
          cellRenderer: createStatusTagRenderer({
            variantMap: { "custom-state": "info" },
            labelMap: { "custom-state": "自定义态" }
          }) }
      ],
      rowData: rows,
      getRowId: (p) => p.data.id
    });
    const tag = cellAt(host, 2, "status").querySelector(".mach-tag") as HTMLElement;
    expect(tag.className).toContain("mach-tag--info");
    expect(tag.textContent).toBe("自定义态");
    api.destroy();
  });

  it("progressBar renders clamped bar width and label", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "progress", headerName: "进度", cellRenderer: "progressBar" }],
      rowData: rows,
      getRowId: (p) => p.data.id
    });
    const cell0 = cellAt(host, 0, "progress");
    const bar = cell0.querySelector(".mach-progress__bar") as HTMLElement;
    expect(bar.style.width).toBe("62%");
    expect(cell0.querySelector(".mach-progress__label")?.textContent).toBe("62%");

    const bar1 = cellAt(host, 1, "progress").querySelector(".mach-progress__bar") as HTMLElement;
    expect(bar1.style.width).toBe("100%");
    api.destroy();
  });

  it("link renders clickable styled span", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "name", headerName: "Name", cellRenderer: "link" }],
      rowData: rows,
      getRowId: (p) => p.data.id
    });
    const link = cellAt(host, 0, "name").querySelector(".mach-link") as HTMLElement;
    expect(link.textContent).toBe("a");
    api.destroy();
  });

  it("actionButtons renders icons, folds overflow into more menu", () => {
    const clicks: string[] = [];
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [
        { field: "name", headerName: "Name" },
        {
          colId: "op",
          headerName: "操作",
          width: 120,
          pinned: "right",
          sortable: false,
          resizable: false,
          movable: false,
          cellRenderer: createActionButtonsRenderer({
            max: 2,
            actions: [
              { icon: "edit", title: "编辑", onClick: () => clicks.push("edit") },
              { icon: "delete", title: "删除", danger: true, onClick: () => clicks.push("delete") },
              { label: "复制", onClick: () => clicks.push("copy") },
              { label: "导出", onClick: () => clicks.push("export") }
            ]
          })
        }
      ],
      rowData: rows,
      getRowId: (p) => p.data.id
    });

    const opCell = cellAt(host, 0, "op");
    const buttons = opCell.querySelectorAll(".mach-action-btn");
    expect(buttons.length).toBe(3);
    expect(buttons[1].classList.contains("mach-action-btn--danger")).toBe(true);

    buttons[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicks).toEqual(["edit"]);

    const more = buttons[2];
    expect(more.textContent).toBe("⋯");
    more.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const menu = document.querySelector(".mach-context-menu") as HTMLElement;
    expect(menu).toBeTruthy();
    const items = menu.querySelectorAll("button");
    expect(items.length).toBe(2);
    items[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicks).toEqual(["edit", "copy"]);
    expect(document.querySelector(".mach-context-menu")).toBeNull();
    api.destroy();
  });

  it("actionButtons respects show filter and rendererParams passthrough", () => {
    const host = createHost();
    const seen: string[] = [];
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [
        { field: "name", headerName: "Name" },
        {
          colId: "op",
          headerName: "操作",
          width: 100,
          cellRenderer: createActionButtonsRenderer({
            actions: [
              { icon: "view", title: "查看", onClick: (p) => seen.push(p.rendererParams?.tag ?? "") },
              { label: "隐藏项", show: () => false, onClick: () => seen.push("hidden") }
            ]
          }),
          cellRendererParams: { tag: "row-context" }
        }
      ],
      rowData: rows,
      getRowId: (p) => p.data.id
    });

    const buttons = cellAt(host, 0, "op").querySelectorAll(".mach-action-btn");
    expect(buttons.length).toBe(1);
    buttons[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(seen).toEqual(["row-context"]);
    api.destroy();
  });

  it("centralises action permission, confirmation and error handling", async () => {
    const onDelete = vi.fn();
    const onError = vi.fn();
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{
        colId: "op",
        cellRenderer: createActionButtonsRenderer<Row>({
          overflow: "inline",
          actions: [
            { id: "secret", label: "Secret", permission: "secret.read", onClick: vi.fn() },
            { id: "delete", label: "Delete", permission: "order.delete", confirm: "确认删除？", onClick: onDelete },
            { id: "broken", label: "Broken", onClick: () => { throw new Error("failed"); } }
          ]
        })
      }],
      rowData: rows,
      actionPolicy: {
        canAccess: ({ permissions }) => !permissions.includes("secret.read"),
        confirm: async ({ actionId, message }) => actionId === "delete" && message === "确认删除？",
        onError
      }
    });
    const buttons = cellAt(host, 0, "op").querySelectorAll<HTMLButtonElement>("button");
    expect([...buttons].map((button) => button.textContent)).toEqual(["Delete", "Broken"]);
    buttons[0].click();
    await Promise.resolve();
    await Promise.resolve();
    expect(onDelete).toHaveBeenCalledOnce();
    buttons[1].click();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ actionId: "broken" }));
    api.destroy();
  });
});

describe("getRowHeight cache", () => {
  it("invokes callback once per node until invalidated", () => {
    const host = createHost();
    const calls: string[] = [];
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "name", headerName: "Name", editable: true }],
      rowData: rows,
      getRowId: (p) => p.data.id,
      getRowHeight: (p) => {
        calls.push(p.data!.id);
        return 36;
      }
    });
    expect(calls.length).toBe(rows.length);

    api.refreshLayout();
    api.refreshLayout();
    expect(calls.length).toBe(rows.length);

    api.startEditingCell({ rowIndex: 0, colId: "name" });
    const input = host.querySelector(".mach-editor-input") as HTMLInputElement;
    input.value = "changed-and-longer-remark";
    api.stopEditing(false);
    api.refreshLayout();
    expect(calls.filter((id) => id === "1").length).toBe(2);
    expect(calls.filter((id) => id === "2").length).toBe(1);
    api.destroy();
  });

  it("updateOptions replacing getRowHeight clears all cached heights", () => {
    const host = createHost();
    let calls = 0;
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "name", headerName: "Name" }],
      rowData: rows,
      getRowId: (p) => p.data.id,
      getRowHeight: () => {
        calls++;
        return 36;
      }
    });
    expect(calls).toBe(rows.length);

    let nextCalls = 0;
    api.updateOptions({
      getRowHeight: () => {
        nextCalls++;
        return 48;
      }
    });
    expect(nextCalls).toBe(rows.length);
    const row0 = host.querySelector('.mach-row[data-index="0"]') as HTMLElement;
    expect(row0.style.height).toBe("48px");
    api.destroy();
  });
});
