import {
  createBusinessColumnTypes,
  createLocalColumnStateStore,
  defineMachTableConfig,
  defineMachTablePreset,
  LOCALE_EN
} from "@agile-team/mach-table-vue";

const businessColumnTypes = createBusinessColumnTypes({
  locale: "zh-CN",
  currency: "CNY",
  timeZone: "Asia/Shanghai",
  emptyText: "—"
});

const columnStateStore = createLocalColumnStateStore({
  namespace: "mach-demo:column-layout",
  version: 1
});

// Demo fallback. Production projects should delegate to their permission store.
const hasPermission = (_permission: string): boolean => true;

/**
 * MachTable application control center.
 *
 * Keep stable application conventions here instead of repeating them on every
 * page. A route can refine these values with provideMachTableConfig(), and an
 * individual <MachTable> prop always has the final say.
 */
export const machTableConfig = defineMachTableConfig({
  /** Defaults inherited by every table. Do not put page data or columns here. */
  defaults: {
    size: "compact",
    theme: "auto",
    columnLayout: "fit",
    enableColumnResize: true,
    stripedRows: true,
    columnMenu: true,
    columnStateStore,
    pagination: {
      pageSize: 20,
      pageSizeOptions: [20, 50, 100, 200],
      showTotal: true,
      showPageSizeSelector: true
    },
    defaultColDef: {
      minWidth: 100,
      sortable: true,
      resizable: true,
      movable: true,
      filter: true
    },
    /** Replace with telemetry/Sentry integration in a production application. */
    onGridError: ({ code, error, source }) => {
      console.error("[business-grid]", code, source, error);
    },
    /** All action columns share the same permission/confirmation/error rules. */
    actionPolicy: {
      canAccess: ({ permissions }) => permissions.every(hasPermission),
      confirm: ({ message }) => Promise.resolve(window.confirm(message ?? "确认执行此操作？")),
      onError: (error, { actionId }) => {
        console.error("[business-action]", actionId, error);
      }
    }
  },

  /** Used when a table does not explicitly select another preset. */
  defaultPreset: "list",

  /** Reusable behavior profiles. Keep environment settings in defaults above. */
  presets: {
    list: defineMachTablePreset({
      rowSelection: "none",
      contextMenu: true
    }),
    crud: defineMachTablePreset({
      rowSelection: "multiple",
      editType: "fullRow",
      editableIndicator: "hover",
      enableRangeSelection: true,
      statusBar: true
    }),
    picker: defineMachTablePreset({
      rowSelection: "multiple",
      pagination: { pageSize: 10, pageSizeOptions: [10, 20, 50] }
    }),
    tree: defineMachTablePreset({
      treeData: true,
      defaultExpandAll: false,
      rowSelection: "multiple"
    }),
    /** Example showing that a preset can override locale for one table. */
    english: defineMachTablePreset({ locale: LOCALE_EN })
  },

  /** Semantic column types remove formatter/editor boilerplate from pages. */
  columnTypes: {
    ...businessColumnTypes,
    readonly: {
      editable: false
    }
  },

  /** Non-fatal config mistakes are observable and can be sent to monitoring. */
  onConfigWarning: (warning) => {
    console.warn(warning.message);
  }
});

export default machTableConfig;
