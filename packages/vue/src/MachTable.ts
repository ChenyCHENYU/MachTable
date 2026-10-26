import { defineComponent, getCurrentInstance, h, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch, type DefineComponent } from "vue";
import {
  createGrid,
  EVENT_TYPES
} from "@agile-team/mach-table";
import { GRID_OPTION_KEYS, GRID_OPTION_META, equivalentGridOption, resumeGrid, suspendGrid } from "@agile-team/mach-table/adapter";
import type { GridApi, GridOptions } from "@agile-team/mach-table";
import { useMachTableConfig } from "./defaults";
import {
  resolveMachTableGridOptions,
  type MachTableOptionExplanation,
  type MachTablePresetSelection,
  type ResolvedMachTableGridOptions
} from "./configuration";
import { createVueSlotEnhancer } from "./slots";

type AdapterOnlyGridOption = "className" | "ariaLabel" | "ariaLabelledBy" | "ariaDescribedBy";

export type MachTableVueProps<TData = any> = Omit<GridOptions<TData>, AdapterOnlyGridOption> & {
  /** Named application preset(s). Explicit table props still win. */
  preset?: MachTablePresetSelection;
  /** CSS class applied to the Vue host element. */
  className?: string;
  /** CSS class forwarded to MachTable's inner grid root. */
  gridClassName?: string;
  /** Accessible name forwarded to MachTable's inner role=grid element. */
  gridAriaLabel?: string;
  gridAriaLabelledBy?: string;
  gridAriaDescribedBy?: string;
};

export interface MachTableVueExposed<TData = any> {
  getApi(): GridApi<TData> | null;
  getResolvedConfig(): GridOptions<TData>;
  explainOption(key: keyof GridOptions<TData> | string): MachTableOptionExplanation;
}

export interface MachTableVueComponent extends DefineComponent<MachTableVueProps<any>> {
  new <TData = any>(): {
    $props: MachTableVueProps<TData>;
    $exposed: MachTableVueExposed<TData>;
  };
}

const HOST_PROPS = {
  gridClassName: "className", gridAriaLabel: "ariaLabel",
  gridAriaLabelledBy: "ariaLabelledBy", gridAriaDescribedBy: "ariaDescribedBy"
} as const;
const HOST_PROP_ENTRIES = Object.entries(HOST_PROPS);
const INNER_OPTION_KEYS = new Set<string>(Object.values(HOST_PROPS));
const ADAPTER_OPTION_KEYS = GRID_OPTION_KEYS.filter(key => !INNER_OPTION_KEYS.has(key));

const PROP_TYPES: Readonly<Record<string, unknown>> = {
  boolean: Boolean, number: Number, array: Array, function: Function,
  "boolean-object": [Boolean, Object], "object-function": [Object, Function], object: Object, string: String
};
const runtimeProps: Record<string, { type?: any; default: undefined }> = {};
for (const key of ADAPTER_OPTION_KEYS) {
  runtimeProps[key] = { type: PROP_TYPES[GRID_OPTION_META[key].kind], default: undefined };
}
for (const key of ["className", ...Object.keys(HOST_PROPS)]) {
  runtimeProps[key] = { type: String, default: undefined };
}
runtimeProps.preset = { type: [String, Array, Boolean], default: undefined };

function handlerNameOf(eventType: string): string {
  return "on" + eventType.charAt(0).toUpperCase() + eventType.slice(1);
}

const MachTableImpl = defineComponent({
  name: "MachTable",
  inheritAttrs: false,
  props: runtimeProps,
  emits: [...EVENT_TYPES],
  setup(rawProps, { expose, attrs, emit, slots }) {
    const props = rawProps as Readonly<Record<string, any>>;
    const host = ref<HTMLDivElement | null>(null);
    let api: GridApi | null = null;
    const config = useMachTableConfig();
    const enhanceVueSlots = createVueSlotEnhancer<any>(slots, getCurrentInstance()?.appContext);
    let lastResolution: ResolvedMachTableGridOptions<any> | null = null;
    const reportedWarnings = new Set<string>();

    const collectOptions = (): GridOptions<any> => {
      const explicit: Record<string, unknown> = {};
      for (const key of ADAPTER_OPTION_KEYS) {
        const value = props[key];
        if (value !== undefined) explicit[key] = value;
      }
      for (const [prop, key] of HOST_PROP_ENTRIES) {
        if (props[prop] !== undefined) explicit[key] = props[prop];
      }
      const resolution = resolveMachTableGridOptions(
        config.value,
        props.preset as MachTablePresetSelection | undefined,
        explicit as Partial<GridOptions<any>>,
        (warning) => {
          const key = `${warning.code}:${warning.preset ?? ""}`;
          if (reportedWarnings.has(key)) return;
          reportedWarnings.add(key);
          if (config.value.onConfigWarning) config.value.onConfigWarning(warning);
          else console.warn(warning.message);
        }
      );
      const enhancedOptions = enhanceVueSlots(resolution.options);
      lastResolution = {
        options: enhancedOptions,
        explain: (key) => {
          if (key === "columnDefs" && enhancedOptions.columnDefs !== resolution.options.columnDefs) {
            return {
              key,
              value: enhancedOptions.columnDefs,
              source: "Vue slots",
              layers: [...resolution.explain(key).layers, { name: "Vue slots", value: enhancedOptions.columnDefs }]
            };
          }
          return resolution.explain(key);
        }
      };
      return lastResolution.options;
    };

    onMounted(() => {
      if (!host.value) return;
      // Keep the resolved configuration immutable: event bridges consult the
      // latest resolution while the core receives one stable mount snapshot.
      const options = { ...collectOptions() } as Record<string, unknown>;
      for (const type of EVENT_TYPES) {
        const handlerName = handlerNameOf(type);
        options[handlerName] = (event: unknown) => {
          const defaultHandler = (lastResolution?.options as Record<string, unknown> | undefined)?.[handlerName];
          try {
            if (typeof defaultHandler === "function") {
              (defaultHandler as (value: unknown) => void)(event);
            }
          } finally {
            emit(type, event);
          }
        };
      }
      api = createGrid(host.value, options as GridOptions<any>);
    });

    onBeforeUnmount(() => {
      api?.destroy();
      api = null;
    });

    // KeepAlive retains the model and API. Only transient interaction is
    // suspended; activation measures the restored host instead of remounting.
    onDeactivated(() => { if (api) suspendGrid(api); });
    onActivated(() => { if (api) resumeGrid(api); });

    watch(
      () => {
        const options = collectOptions() as Record<string, unknown>;
        return [...GRID_OPTION_KEYS.map((key) => options[key])];
      },
      (values, previous) => {
        if (!api) return;
        const changed: Record<string, unknown> = {};
        values.forEach((value, index) => {
          const key = GRID_OPTION_KEYS[index];
          if (equivalentGridOption(key, value, previous[index])) return;
          changed[key] = value;
        });
        if (Object.keys(changed).length > 0) api.updateOptions(changed as Partial<GridOptions<any>>);
      }
    );

    expose({
      getApi: (): GridApi | null => api,
      getResolvedConfig: (): GridOptions<any> => lastResolution?.options ?? collectOptions(),
      explainOption: (key: keyof GridOptions<any> | string): MachTableOptionExplanation =>
        (lastResolution ?? resolveMachTableGridOptions(config.value, props.preset, {})).explain(key)
    });

    return () => h("div", {
      ...attrs,
      ref: host,
      class: ["mach-vue-host", props.className, attrs.class]
    });
  }
});

export const MachTable = MachTableImpl as unknown as MachTableVueComponent;
