import {
  MachTable,
  MachTablePlugin,
  provideMachTableDefaults,
  type MachTableVueProps
} from "@agile-team/mach-table-vue";
import {
  useMachTableEditing,
  useMachTableQuery
} from "@agile-team/mach-table-vue/workflows";

interface Row { id: string; name: string }

export const component = MachTable;
export const plugin = MachTablePlugin;
export const workflows = [useMachTableEditing, useMachTableQuery];
export const props: MachTableVueProps<Row> = {
  columnDefs: [{ field: "name" }],
  rowData: [{ id: "1", name: "Ada" }],
  getRowId: ({ data }) => data.id
};

export function provideDefaults(): void {
  provideMachTableDefaults<Row>({ pagination: false, defaultColDef: { sortable: true } });
}
