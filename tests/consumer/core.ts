import {
  createColumnHelper,
  createEnterprisePreset,
  defineGridOptions,
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
    column.accessor("amount", { editable: true })
  ],
  rowData: [],
  getRowId: ({ data }) => data.id,
  onCellValueChanged: ({ data, api }) => {
    data.amount.toFixed(2);
    api.getDiagnostics();
  }
});

export async function save(api: GridApi<Order>, handler: SaveChangesHandler<Order>): Promise<GridDiagnostics> {
  const state: GridState = api.getState();
  api.applyState(state);
  await api.saveChanges(handler);
  return api.getDiagnostics();
}
