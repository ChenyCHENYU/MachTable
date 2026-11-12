import type { GridOptions } from "../types/options";

/** Fresh option records keep one table or an explain snapshot from changing another scene. */
export function builtinTablePreset(name: string): Partial<GridOptions> | undefined {
  if (name === "list") return {
    rowNumber: true,
    columnMenu: true,
    enableColumnResize: true,
    defaultColDef: { filter: true }
  };
  if (name === "detail") return {
    rowNumber: true,
    domLayout: "autoHeight",
    maxBodyHeight: 330,
    pagination: false,
    columnMenu: false,
    enableColumnResize: false,
    statusBar: false,
    contextMenu: false,
    defaultColDef: {
      sortable: false, filter: false, resizable: false, movable: false, editable: false
    }
  };
  return undefined;
}
