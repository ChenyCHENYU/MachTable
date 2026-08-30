import {
  MachTable,
  MachTablePlugin,
  provideMachTableDefaults,
  type MachTableVueProps
} from "@agile-team/mach-table-vue";
import { MachTableToolbar } from "@agile-team/mach-table-vue/ui";
import {
  useMachTableEditing,
  useMachTableController,
  useMachTableQuery
} from "@agile-team/mach-table-vue/workflows";

interface Row { id: string; name: string }

export const component = MachTable;
export const plugin = MachTablePlugin;
export const workflows = [useMachTableEditing, useMachTableQuery, useMachTableController];
export const toolbar = MachTableToolbar;
export const props: MachTableVueProps<Row> = {
  columnDefs: [{ field: "name" }],
  rowData: [{ id: "1", name: "Ada" }],
  rowKey: "id"
};

export function provideDefaults(): void {
  provideMachTableDefaults<Row>({ pagination: false, defaultColDef: { sortable: true } });
}
