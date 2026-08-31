// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createGrid } from "../index";
import type { GridApi } from "../index";

interface Row {
  id: string;
  name: string;
  score: number;
}

function makeRows(count: number, offset = 0): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `r${offset + i}`,
    name: `n${offset + i}`,
    score: offset + i + 1
  }));
}

function createHost(): HTMLElement {
  const host = document.createElement("div");
  Object.defineProperty(host, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(host, "clientHeight", { value: 400, configurable: true });
  document.body.appendChild(host);
  return host;
}

function editCell(api: GridApi<Row>, host: HTMLElement, row: number, colId: string, value: string): void {
  api.editing.startCell({ rowIndex: row, colId });
  const input = host.querySelector(".mach-editor-input") as HTMLInputElement;
  input.value = value;
  api.editing.stop();
}

describe("fixes round 3", () => {
  it("pinned top and bottom setters do not clear each other", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "name", headerName: "Name" }],
      rowData: makeRows(3),
      rowKey: (row) => row.id
    });

    api.view.setPinnedRows("top", [{ id: "t", name: "顶部", score: 1 }]);
    api.view.setPinnedRows("bottom", [{ id: "b", name: "底部", score: 2 }]);

    expect(api.view.getPinnedRows("top").length).toBe(1);
    expect(api.view.getPinnedRows("bottom").length).toBe(1);

    const top = host.querySelector(".mach-pinned-rows--top") as HTMLElement;
    const bottom = host.querySelector(".mach-pinned-rows--bottom") as HTMLElement;
    expect(top.style.display).toBe("");
    expect(bottom.style.display).toBe("");
    expect(top.textContent).toContain("顶部");
    expect(bottom.textContent).toContain("底部");

    api.view.setPinnedRows("top", [{ id: "t2", name: "顶部2", score: 3 }]);
    expect(api.view.getPinnedRows("bottom").length).toBe(1);
    expect(bottom.textContent).toContain("底部");
    expect(top.textContent).toContain("顶部2");

    api.view.setPinnedRows("top", null);
    expect(api.view.getPinnedRows("bottom").length).toBe(1);
    expect(top.style.display).toBe("none");
    api.destroy();
  });

  it("ctrl+z / ctrl+y keyboard shortcuts undo and redo", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "name", headerName: "Name", editable: true }],
      rowData: makeRows(2),
      rowKey: (row) => row.id
    });
    const root = host.querySelector(".mach-root") as HTMLElement;

    editCell(api, host, 0, "name", "edited");
    expect(api.rows.getById("r0")?.data?.name).toBe("edited");

    root.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(api.rows.getById("r0")?.data?.name).toBe("n0");

    root.dispatchEvent(new KeyboardEvent("keydown", { key: "y", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(api.rows.getById("r0")?.data?.name).toBe("edited");

    root.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    expect(api.rows.getById("r0")?.data?.name).toBe("edited");
    api.destroy();
  });

  it("infinite reload clears undo history", async () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "name", headerName: "Name", editable: true }],
      blockSize: 10,
      rowKey: (row) => row.id,
      datasource: {
        getRows(params) {
          setTimeout(() => params.onSuccess(makeRows(10, params.startRow), 10), 0);
        }
      }
    });
    await new Promise((r) => setTimeout(r, 15));

    editCell(api, host, 0, "name", "x");
    expect(api.editing.canUndo()).toBe(true);

    void api.rows.reload();
    await new Promise((r) => setTimeout(r, 15));
    expect(api.editing.canUndo()).toBe(false);
    api.destroy();
  });

  it("undo passes correct oldValue to custom valueSetter", () => {
    const host = createHost();
    const seenOld: any[] = [];
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [
        {
          field: "score",
          headerName: "Score",
          editable: true,
          valueSetter: (p) => {
            seenOld.push(p.oldValue);
            if (p.newValue == null) return false;
            p.data.score = p.newValue;
            return true;
          }
        }
      ],
      rowData: makeRows(2),
      rowKey: (row) => row.id
    });

    editCell(api, host, 0, "score", "9");
    expect(seenOld[seenOld.length - 1]).toBe(1);

    api.editing.undo();
    expect(seenOld[seenOld.length - 1]).toBe(9);

    api.editing.redo();
    expect(seenOld[seenOld.length - 1]).toBe(1);
    expect(api.rows.getById("r0")?.data?.score).toBe(9);
    api.destroy();
  });

  it("reducing undoStackSize trims history immediately", () => {
    const host = createHost();
    const api: GridApi<Row> = createGrid<Row>(host, {
      columnDefs: [{ field: "name", headerName: "Name", editable: true }],
      rowData: makeRows(2),
      rowKey: (row) => row.id
    });

    editCell(api, host, 0, "name", "a");
    editCell(api, host, 0, "name", "b");
    editCell(api, host, 0, "name", "c");
    expect(api.editing.canUndo()).toBe(true);

    api.updateOptions({ undoStackSize: 1 });
    api.editing.undo();
    expect(api.editing.canUndo()).toBe(false);
    api.destroy();
  });
});
