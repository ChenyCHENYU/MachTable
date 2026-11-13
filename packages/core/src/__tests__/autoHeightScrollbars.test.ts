// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { createGrid } from "../index";
import type { GridApi } from "../index";

const grids: GridApi[] = [];
afterEach(() => { grids.splice(0).forEach(api => api.destroy()); document.body.replaceChildren(); });

it("accounts for a native horizontal scrollbar in natural height and respects the total body cap", () => {
  const host = document.body.appendChild(document.createElement("div"));
  const api = createGrid(host, {
    rowNumber: false, pagination: false, domLayout: "autoHeight", rowHeight: 30,
    columnDefs: [{ field: "name", width: 900 }], rowData: [{ name: "A" }, { name: "B" }]
  });
  grids.push(api);
  const body = host.querySelector<HTMLElement>(".mach-body")!;
  const viewport = host.querySelector<HTMLElement>(".mach-body-viewport--scroll")!;
  const container = viewport.querySelector<HTMLElement>(".mach-row-container")!;
  const height = () => parseFloat(body.style.height) || 0;
  Object.defineProperties(viewport, {
    clientWidth: { value: 500 },
    offsetHeight: { get: height },
    clientHeight: { get: () => Math.max(0, height() - (parseFloat(container.style.width) > 500 ? 10 : 0)) }
  });
  api.view.refreshLayout();
  expect(body.style.height).toBe("70px");
  expect(viewport.clientHeight).toBe(60);
  expect(viewport.style.overflowY).not.toBe("auto");
  for (let pass = 0; pass < 3; pass++) {
    api.columns.setWidth("name", 200);
    expect(body.style.height).toBe("60px");
    api.columns.setWidth("name", 900);
    expect(body.style.height).toBe("70px");
  }
  api.updateOptions({ maxBodyHeight: 60 });
  expect(body.style.height).toBe("60px");
  expect(viewport.clientHeight).toBe(50);
  expect(viewport.style.overflowY).toBe("auto");
  api.updateOptions({ maxBodyHeight: 80 });
  expect(body.style.height).toBe("70px");
  expect(viewport.style.overflowY).not.toBe("auto");
  api.rows.setData([]);
  expect(body.style.height).toBe("0px");
});
