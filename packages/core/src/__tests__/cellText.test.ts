// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createGrid } from "../index";

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

it("reuses text labels for default, string and failed renderers while keeping edit hints as siblings", () => {
  vi.spyOn(console,"error").mockImplementation(() => {});
  const host = document.createElement("div");
  document.body.append(host);
  const api = createGrid(host, {
    rowKey:"id",rowNumber:false,pagination:false,editableIndicator:"always",
    columnDefs:[{field:"plain",editable:true},{field:"string",cellRenderer:p => String(p.value)},
      {field:"fallback",cellRenderer:() => { throw new Error("expected renderer failure"); }}],
    rowData:[{id:"one",plain:"default",string:"string",fallback:"fallback"}]
  });
  const labels = ["plain","string","fallback"].map(id => host.querySelector(`.mach-cell[data-col-id="${id}"] > .mach-cell-text`));
  expect(labels.every(Boolean)).toBe(true);
  const plain = labels[0]!;
  expect(plain.nextElementSibling?.classList.contains("mach-cell-edit-trigger")).toBe(true);
  api.view.refreshCells();
  for (const label of labels) expect(label!.parentElement?.querySelector(".mach-cell-text")).toBe(label);
  expect(host.querySelectorAll('.mach-cell[data-col-id="plain"] > .mach-cell-edit-trigger')).toHaveLength(1);
  api.rows.transact({update:[{id:"one",plain:"changed",string:"next",fallback:"safe"}]});
  expect(labels.map(label => label!.textContent)).toEqual(["changed","next","safe"]);
  api.destroy();
});

it("preserves rich renderer, tree and editor ownership without adding text layers", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const button = document.createElement("button");
  button.textContent = "Action";
  const api = createGrid(host, {
    rowNumber:false,pagination:false,treeData:true,
    columnDefs:[{field:"name"},{field:"rich",cellRenderer:() => button},{field:"edit",editable:true}],
    rowData:[{id:"one",name:"Parent",rich:"value",edit:"draft",children:[{id:"child",name:"Child"}]}]
  });
  const rich = host.querySelector('.mach-cell[data-col-id="rich"]')!;
  const tree = host.querySelector('.mach-cell[data-col-id="name"]')!;
  expect(rich.firstElementChild).toBe(button);
  expect(tree.firstElementChild?.className).toBe("mach-tree-cell");
  expect(rich.querySelector(".mach-cell-text")).toBeNull();
  expect(tree.querySelector(".mach-cell-text")).toBeNull();
  expect(api.editing.startCell({rowIndex:0,colId:"edit"})).toBe(true);
  const edit = host.querySelector('.mach-cell[data-col-id="edit"]')!;
  expect(edit.querySelector(".mach-cell-text")).toBeNull();
  expect(edit.querySelector<HTMLInputElement>("input")?.value).toBe("draft");
  await api.editing.stop({cancel:true});
  expect(edit.querySelector(".mach-cell-text")?.textContent).toBe("draft");
  api.destroy();
});
