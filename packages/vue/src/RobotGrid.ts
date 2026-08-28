import { defineComponent, h, onBeforeUnmount, onMounted, ref, watch, type DefineComponent } from "vue";
import {
  createGrid,
  DIRECT_GRID_OPTION_KEYS,
  EVENT_TYPES,
  GRID_OPTION_KEYS,
  GRID_OPTION_META
} from "@agile-team/mach-table";
import type { GridApi, GridOptions } from "@agile-team/mach-table";

export type RobotGridVueProps<TData = any> = Omit<GridOptions<TData>, "className"> & {
  /** CSS class applied to the Vue host element. */
  className?: string;
  /** CSS class forwarded to MachTable's inner grid root. */
  gridClassName?: string;
};

const ADAPTER_OPTION_KEYS = GRID_OPTION_KEYS.filter((key) => key !== "className");
const DIRECT_OPTION_KEYS = DIRECT_GRID_OPTION_KEYS.filter((key) => key !== "className");

const runtimeProps: Record<string, { type?: any; default: undefined }> = {};
for (const key of ADAPTER_OPTION_KEYS) {
  const kind = GRID_OPTION_META[key].kind;
  const type = kind === "boolean"
    ? Boolean
    : kind === "number"
      ? Number
      : kind === "array"
        ? Array
        : kind === "function"
          ? Function
          : kind === "boolean-object"
            ? [Boolean, Object]
            : kind === "object"
              ? Object
              : kind === "string"
                ? String
                : undefined;
  runtimeProps[key] = { ...(type ? { type } : {}), default: undefined };
}
runtimeProps.className = { type: String, default: undefined };
runtimeProps.gridClassName = { type: String, default: undefined };

function handlerNameOf(eventType: string): string {
  return "on" + eventType.charAt(0).toUpperCase() + eventType.slice(1);
}

const RobotGridImpl = defineComponent({
  name: "RobotGrid",
  inheritAttrs: false,
  props: runtimeProps,
  emits: [...EVENT_TYPES] as unknown as string[],
  setup(rawProps, { expose, attrs, emit }) {
    const props = rawProps as Readonly<Record<string, any>>;
    const host = ref<HTMLDivElement | null>(null);
    let api: GridApi | null = null;

    onMounted(() => {
      if (!host.value) return;
      const options: Record<string, unknown> = {};
      for (const key of ADAPTER_OPTION_KEYS) {
        const value = props[key];
        if (value !== undefined) options[key] = value;
      }
      if (props.gridClassName !== undefined) options.className = props.gridClassName;
      for (const type of EVENT_TYPES) {
        options[handlerNameOf(type)] = (event: unknown) => emit(type, event);
      }
      api = createGrid(host.value, options as GridOptions<any>);
    });

    onBeforeUnmount(() => {
      api?.destroy();
      api = null;
    });

    watch(() => props.rowData, (value) => api?.setRowData(value));
    watch(() => props.columnDefs, (value) => api?.setColumnDefs(value));
    watch(() => props.quickFilterText, (value) => api?.setQuickFilter(value));
    watch(() => props.gridClassName, (value) => api?.updateOptions({ className: value }));

    watch(
      () => DIRECT_OPTION_KEYS.map((key) => props[key]),
      (values, previous) => {
        if (!api) return;
        const changed: Record<string, unknown> = {};
        values.forEach((value, index) => {
          if (!Object.is(value, previous[index])) changed[DIRECT_OPTION_KEYS[index]] = value;
        });
        if (Object.keys(changed).length > 0) api.updateOptions(changed as Partial<GridOptions<any>>);
      }
    );

    expose({ getApi: (): GridApi | null => api });

    return () => h("div", {
      ...attrs,
      ref: host,
      class: ["mach-vue-host", props.className, attrs.class].filter(Boolean),
      style: attrs.style
    });
  }
});

export const RobotGrid = RobotGridImpl as unknown as DefineComponent<RobotGridVueProps<any>>;
