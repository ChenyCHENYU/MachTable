import {
  createColumnHelper,
  createEnterprisePreset,
  defineGridOptions,
  rowActionsColumn,
  type GridApi,
  type GridDiagnostics,
  type GridState,
  type SaveChangesHandler
} from "@agile-team/mach-table";

interface Order {
  id: string;
  customer: { name: string };
  amount: number;
}

const column = createColumnHelper<Order>();
export const options = defineGridOptions<Order>({
  ...createEnterprisePreset<Order>(),
  columnDefs: [
    column.accessor("customer.name", { headerName: "Customer" }),
    column.accessor("amount", { editable: true }),
    rowActionsColumn<Order>({
      onView: ({ data }) => data?.customer.name,
      extraActions: [{ icon: "download", title: "Export", onClick: ({ data }) => data?.id }]
    })
  ],
  editType: "fullRow",
  rowData: [],
  rowKey: "id",
  persistence: { key: "orders" },
  onCellValueChanged: ({ data, api }) => {
    data.amount.toFixed(2);
    api.diagnostics.get();
  }
});

export async function save(api: GridApi<Order>, handler: SaveChangesHandler<Order>): Promise<GridDiagnostics> {
  api.editing.startRow(0);
  await api.editing.stop();
  const state: GridState = api.state.get();
  api.state.apply(state);
  await api.editing.save(handler);
  return api.diagnostics.get();
}
