import {
  createGrid,
  createMachTablePreset,
  defineMachTableConfig,
  defineMachTablePreset,
  type GridApi,
  type GridDataProcessor,
  type GridOptions
} from "@agile-team/mach-table";

interface Row { id: string }
declare const factory: () => GridDataProcessor<Row>;
declare const owned: GridDataProcessor<Row>;

export const config = defineMachTableConfig({
  presets: {
    ordinary: defineMachTablePreset<Row>({ rowSelection: "multiple" }),
    worker: defineMachTablePreset<Row>({ dataProcessor: factory })
  }
});
export const tableOptions: GridOptions<Row> = defineMachTablePreset<Row>({ dataProcessor: owned });
// @ts-expect-error An already-owned instance cannot become shared application defaults.
defineMachTableConfig({ defaults: defineMachTablePreset<Row>({ dataProcessor: owned }) });

const sceneOptions: GridOptions<Row> = {
  rowKey: "id",
  columnDefs: [{ field: "id", headerName: "ID" }],
  rowData: [{ id: "one" }]
};

// The documented native entry point accepts the same named scene composer.
export function createSceneGrids(host: HTMLElement): GridApi<Row>[] {
  return [
    createGrid<Row>(host, createMachTablePreset<Row>("list", sceneOptions)),
    createGrid<Row>(host, createMachTablePreset<Row>("detail", sceneOptions))
  ];
}

// Inherited scenes are also reusable application presets, including worker factories.
export const sceneConfig = defineMachTableConfig({
  presets: {
    list: createMachTablePreset<Row>("list", { defaultColDef: { sortable: false } }),
    detail: createMachTablePreset<Row>("detail", { maxBodyHeight: 240 }),
    worker: createMachTablePreset<Row>("list", { dataProcessor: factory })
  }
});
