import {
  defineMachTableConfig,
  defineMachTablePreset,
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
