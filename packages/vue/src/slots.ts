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
  vueRenderCell,
  type VueCellEditorSlotProps
} from "./adapters";
import type { VueColDef } from "./columns";

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

/** Stable proxies observe same-name slot replacements without rebuilding Core columns. */
function liveSlot(slots: Slots, name: string): Slot | undefined {
  if (!slots[name]) name = name.replace(/[.\s]+/g, "-");
  return slots[name] ? (props) => slots[name]!(props) : undefined;
}

function enhanceColumns<TData>(
  definitions: readonly (ColDef<TData> | ColDefGroup<TData>)[],
  slots: Slots,
  context: { appContext?: AppContext }
): (ColDef<TData> | ColDefGroup<TData>)[] {
  return definitions.map((definition, index) => {
    if (Array.isArray((definition as ColDefGroup<TData>).children)) {
      const group = definition as ColDefGroup<TData>;
      return { ...group, children: enhanceColumns(group.children, slots, context) };
    }
    const column = definition as VueColDef<TData>;
    const id = column.colId ?? column.field ?? `col_${index}`;
    const { render, ...coreColumn } = column;
    // Named slots override render; the general cell slot is only a fallback.
    const cell = liveSlot(slots, `cell-${id}`) ?? (id === "op" ? liveSlot(slots, "actions") : undefined)
      ?? (render ? undefined : liveSlot(slots, "cell"));
    const header = liveSlot(slots, `header-${id}`) ?? liveSlot(slots, "header");
    const editor = liveSlot(slots, `editor-${id}`) ?? liveSlot(slots, "editor");
    return {
      ...coreColumn,
      ...(cell
        ? { cellRenderer: vueCellSlotRenderer(cell, context) }
        : render
          ? { cellRenderer: vueRenderCell(render, context) }
          : {}),
      ...(header ? { headerComponent: vueHeaderSlotRenderer(header, context) } : {}),
      ...(editor ? { cellEditor: vueCellEditorSlot(editor, context) } : {})
    };
  });
}

export function applyVueSlots<TData>(
  options: GridOptions<TData>,
  slots: Slots,
  appContext?: AppContext
): GridOptions<TData> {
  return createVueSlotEnhancer<TData>(slots, appContext)(options);
}

/** Creates a stable enhancer so unrelated reactive prop updates do not rebuild columns. */
export function createVueSlotEnhancer<TData>(slots: Slots, appContext?: AppContext) {
  const context = { appContext };
  let previousDefinitions: GridOptions<TData>["columnDefs"];
  let enhancedDefinitions: GridOptions<TData>["columnDefs"];
  let previousSlots = "";
  let templates: GridOptions<TData> = {};

  return (options: GridOptions<TData>): GridOptions<TData> => {
    const slotKeys = Object.keys(slots).join("\0");
    if (options.columnDefs !== previousDefinitions || slotKeys !== previousSlots) {
      previousDefinitions = options.columnDefs;
      enhancedDefinitions = options.columnDefs
        ? enhanceColumns(options.columnDefs, slots, context)
        : options.columnDefs;
    }
    if (slotKeys !== previousSlots) {
      previousSlots = slotKeys;
      templates = {};
      const detail = liveSlot(slots, "detail"), loading = liveSlot(slots, "loading"), empty = liveSlot(slots, "empty");
      if (detail) templates.detailRowRenderer = vueDetailSlotRenderer<TData>(detail, context);
      if (loading) templates.overlayLoadingTemplate = vueOverlaySlot(loading, context);
      if (empty) templates.overlayNoRowsTemplate = vueOverlaySlot(empty, context);
    }
    return {
      ...options,
      ...templates,
      detailRowRenderer: options.detailRowRenderer ?? templates.detailRowRenderer,
      columnDefs: enhancedDefinitions,
    };
  };
}
