import { defineMachTableConfig, defineMachTablePreset } from "@agile-team/mach-table-react";

/** Application-wide table conventions. Page data and columns do not belong here. */
export default defineMachTableConfig({
  defaults: {
    size: "compact",
    columnLayout: "fit",
    stripedRows: true,
    defaultColDef: { minWidth: 100, sortable: true, resizable: true, movable: true, filter: true },
    pagination: { pageSize: 20, pageSizeOptions: [20, 50, 100], showTotal: true }
  },
  defaultPreset: "list",
  presets: {
    list: defineMachTablePreset({ rowSelection: "none" }),
    crud: defineMachTablePreset({ rowSelection: "multiple", editType: "fullRow", editableIndicator: "hover" })
  }
});
