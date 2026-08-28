import {
  MachTable,
  MachTableProvider,
  type MachTableReactProps
} from "@agile-team/mach-table-react";

interface Row { id: string; name: string }

export const props: MachTableReactProps<Row> = {
  columnDefs: [{ field: "name" }],
  rowData: [{ id: "1", name: "Ada" }],
  getRowId: ({ data }) => data.id
};

export function Table() {
  return (
    <MachTableProvider<Row> defaults={{ pagination: false }}>
      <MachTable<Row> {...props} />
    </MachTableProvider>
  );
}
