import {
  MachTable,
  MachTableProvider,
  MachTableToolbar,
  defineMachTableConfig,
  type MachTableReactProps
} from "@agile-team/mach-table-react";
import { useMachTableController, useMachTableEditing, useMachTableQuery } from "@agile-team/mach-table-react/workflows";

interface Row { id: string; name: string }

export const props: MachTableReactProps<Row> = {
  columnDefs: [{ field: "name" }],
  rowData: [{ id: "1", name: "Ada" }],
  rowKey: "id"
};

export const config = defineMachTableConfig({
  defaults: { pagination: false },
  presets: { dense: { size: "compact" } },
  defaultPreset: "dense"
});
export const workflows = [useMachTableController, useMachTableEditing, useMachTableQuery];
export const toolbar = MachTableToolbar;

export function Table() {
  return (
    <MachTableProvider<Row> config={config}>
      <MachTable<Row> {...props} />
    </MachTableProvider>
  );
}
