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
  getRowId: ({ data }) => data.id,
  onCellValueChanged: ({ data, api }) => {
    data.amount.toFixed(2);
    api.getDiagnostics();
  }
});

export async function save(api: GridApi<Order>, handler: SaveChangesHandler<Order>): Promise<GridDiagnostics> {
  api.startEditingRow(0);
  await api.stopEditingRow(true);
  const state: GridState = api.getState();
  api.applyState(state);
  await api.saveChanges(handler);
  return api.getDiagnostics();
}
