import type { AppContext, Slot, Slots } from "vue";
import type {
  CellEditorParams,
  CellRendererParams,
  ColDef,
  ColDefGroup,
  DetailRowRendererParams,
  GridOptions,
  HeaderComponentParams
} from "@agile-team/mach-table";
import {
  vueCellEditorSlot,
  vueCellSlotRenderer,
  vueDetailSlotRenderer,
  vueHeaderSlotRenderer,
  vueOverlaySlot,
  type VueCellEditorSlotProps
} from "./adapters";

export interface MachTableVueSlots<TData = any> {
  cell?: (props: CellRendererParams<TData>) => any;
  header?: (props: HeaderComponentParams<TData>) => any;
  editor?: (props: VueCellEditorSlotProps<TData>) => any;
  detail?: (props: DetailRowRendererParams<TData>) => any;
  loading?: () => any;
  empty?: () => any;
  actions?: (props: CellRendererParams<TData>) => any;
  [name: `cell-${string}`]: ((props: CellRendererParams<TData>) => any) | undefined;
  [name: `header-${string}`]: ((props: HeaderComponentParams<TData>) => any) | undefined;
  [name: `editor-${string}`]: ((props: CellEditorParams<TData>) => any) | undefined;
}

function namedSlot(slots: Slots, prefix: string, id: string): Slot | undefined {
  return slots[`${prefix}-${id}`] ?? slots[`${prefix}-${id.replace(/[.\s]+/g, "-")}`];
}

function enhanceColumns<TData>(
  definitions: readonly (ColDef<TData> | ColDefGroup<TData>)[],
  slots: Slots,
  appContext?: AppContext
): (ColDef<TData> | ColDefGroup<TData>)[] {
  return definitions.map((definition, index) => {
    if (Array.isArray((definition as ColDefGroup<TData>).children)) {
      const group = definition as ColDefGroup<TData>;
      return { ...group, children: enhanceColumns(group.children, slots, appContext) };
    }
    const column = definition as ColDef<TData>;
    const id = column.colId ?? column.field ?? `col_${index}`;
    const cell = namedSlot(slots, "cell", id) ?? (id === "op" ? slots.actions : undefined) ?? slots.cell;
    const header = namedSlot(slots, "header", id) ?? slots.header;
    const editor = namedSlot(slots, "editor", id) ?? slots.editor;
    return {
      ...column,
      ...(cell ? { cellRenderer: vueCellSlotRenderer(cell, { appContext }) } : {}),
      ...(header ? { headerComponent: vueHeaderSlotRenderer(header, { appContext }) } : {}),
      ...(editor ? { cellEditor: vueCellEditorSlot(editor, { appContext }) } : {})
    };
  });
}

export function applyVueSlots<TData>(
  options: GridOptions<TData>,
  slots: Slots,
  appContext?: AppContext
): GridOptions<TData> {
  const columnDefs = options.columnDefs
    ? enhanceColumns(options.columnDefs, slots, appContext)
    : options.columnDefs;
  return {
    ...options,
    columnDefs,
    ...(slots.detail && !options.detailRowRenderer
      ? { detailRowRenderer: vueDetailSlotRenderer(slots.detail, { appContext }) }
      : {}),
    ...(slots.loading ? { overlayLoadingTemplate: vueOverlaySlot(slots.loading, { appContext }) } : {}),
    ...(slots.empty ? { overlayNoRowsTemplate: vueOverlaySlot(slots.empty, { appContext }) } : {})
  };
}

/** Creates a stable enhancer so unrelated reactive prop updates do not rebuild columns. */
export function createVueSlotEnhancer<TData>(slots: Slots, appContext?: AppContext) {
  let previousDefinitions: GridOptions<TData>["columnDefs"];
  let enhancedDefinitions: GridOptions<TData>["columnDefs"];
  const detailRenderer = slots.detail ? vueDetailSlotRenderer<TData>(slots.detail, { appContext }) : undefined;
  const loadingTemplate = slots.loading ? vueOverlaySlot(slots.loading, { appContext }) : undefined;
  const emptyTemplate = slots.empty ? vueOverlaySlot(slots.empty, { appContext }) : undefined;

  return (options: GridOptions<TData>): GridOptions<TData> => {
    if (options.columnDefs !== previousDefinitions) {
      previousDefinitions = options.columnDefs;
      enhancedDefinitions = options.columnDefs
        ? enhanceColumns(options.columnDefs, slots, appContext)
        : options.columnDefs;
    }
    return {
      ...options,
      columnDefs: enhancedDefinitions,
      ...(detailRenderer && !options.detailRowRenderer ? { detailRowRenderer: detailRenderer } : {}),
      ...(loadingTemplate ? { overlayLoadingTemplate: loadingTemplate } : {}),
      ...(emptyTemplate ? { overlayNoRowsTemplate: emptyTemplate } : {})
    };
  };
}
