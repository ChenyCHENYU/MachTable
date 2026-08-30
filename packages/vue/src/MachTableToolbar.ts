import { defineComponent, h, type PropType, type VNodeChild } from "vue";
import type { GridApi, GridSize, MachTableCommands } from "@agile-team/mach-table";

export interface MachTableToolbarFeatures {
  search?: boolean;
  refresh?: boolean;
  columns?: boolean;
  density?: boolean;
  export?: boolean;
  undoRedo?: boolean;
  fullscreen?: boolean;
}

const DEFAULT_FEATURES: Required<MachTableToolbarFeatures> = {
  search: true, refresh: true, columns: true, density: true,
  export: true, undoRedo: false, fullscreen: false
};

export const MachTableToolbar = defineComponent({
  name: "MachTableToolbar",
  props: {
    api: { type: Object as PropType<GridApi<any> | null>, default: null },
    commands: { type: Object as PropType<MachTableCommands | null>, default: null },
    modelValue: { type: String, default: "" },
    loading: { type: Boolean, default: false },
    selectedCount: { type: Number, default: 0 },
    searchPlaceholder: { type: String, default: "搜索当前结果" },
    exportFilename: { type: String, default: "mach-table.csv" },
    features: { type: Object as PropType<MachTableToolbarFeatures>, default: () => ({}) }
  },
  emits: ["update:modelValue", "refresh", "clearSelection"],
  setup(props, { emit, slots }) {
    const enabled = (key: keyof MachTableToolbarFeatures): boolean => props.features[key] ?? DEFAULT_FEATURES[key];
    const command = (key: keyof MachTableCommands, ...args: unknown[]): unknown => {
      const fn = props.commands ? Reflect.get(props.commands, key) as unknown : undefined;
      return typeof fn === "function" && props.commands ? Reflect.apply(fn, props.commands, args) : undefined;
    };
    const button = (label: string, icon: string, click: (event: MouseEvent) => void, disabled = false) =>
      h("button", { type: "button", class: "mach-toolbar__button", title: label, "aria-label": label, disabled, onClick: click }, icon);

    const renderMain = () => {
      const children: VNodeChild[] = [...(slots.start?.() ?? [])];
      if (enabled("search")) children.push(h("label", { class: "mach-toolbar__search" }, [
          h("span", { class: "mach-sr-only" }, props.searchPlaceholder),
          h("span", { "aria-hidden": "true" }, "⌕"),
          h("input", {
            value: props.modelValue,
            type: "search",
            placeholder: props.searchPlaceholder,
            onInput: (event: Event) => {
              const value = (event.target as HTMLInputElement).value;
              emit("update:modelValue", value);
              if (props.commands) command("search", value || null);
              else props.api?.setQuickFilter(value || null);
            }
          })
        ]));
      if (enabled("refresh")) children.push(button("刷新", props.loading ? "…" : "↻", () => {
          emit("refresh");
          if (props.commands) void command("refresh");
          else if (props.api?.isInfinite()) void props.api.reload();
          else props.api?.refreshCells();
        }, props.loading));
      if (enabled("columns")) children.push(button("列设置", "☷", (event) => {
          const anchor = event.currentTarget;
          if (!(anchor instanceof HTMLElement)) return;
          if (props.commands) command("openColumns", anchor);
          else props.api?.openColumnWorkbench(anchor);
        }));
      if (enabled("density")) children.push(h("select", {
          class: "mach-toolbar__select",
          value: props.api?.getGridOption("size") ?? "normal",
          "aria-label": "表格密度",
          onChange: (event: Event) => {
            const size = (event.target as HTMLSelectElement).value as GridSize;
            if (props.commands) command("setDensity", size);
            else props.api?.setGridOption("size", size);
          }
        }, [h("option", { value: "compact" }, "紧凑"), h("option", { value: "normal" }, "标准"), h("option", { value: "large" }, "宽松")]));
      children.push(...(slots.default?.() ?? []));
      return h("div", { class: "mach-toolbar__main" }, children);
    };

    const renderAside = () => {
      const children: VNodeChild[] = [];
      if (props.selectedCount > 0) children.push(h("button", {
        type: "button", class: "mach-toolbar__selection", onClick: () => emit("clearSelection")
      }, `已选 ${props.selectedCount} 项 ×`));
      if (enabled("undoRedo")) {
        children.push(button("撤销", "↶", () => {
          if (props.commands) command("undo"); else props.api?.undo();
        }, props.commands ? !props.commands.canUndo() : !props.api?.canUndo()));
        children.push(button("重做", "↷", () => {
          if (props.commands) command("redo"); else props.api?.redo();
        }, props.commands ? !props.commands.canRedo() : !props.api?.canRedo()));
      }
      if (enabled("export")) children.push(button("导出 CSV", "⇩", () => { if (props.commands) command("exportCsv", props.exportFilename); }, !props.commands));
      if (enabled("fullscreen")) children.push(button("全屏", "⛶", () => { void command("toggleFullscreen"); }, !props.commands));
      children.push(...(slots.end?.() ?? []));
      return h("div", { class: "mach-toolbar__aside" }, children);
    };

    return () => h("div", { class: "mach-toolbar", role: "toolbar", "aria-label": "表格工具栏" }, [
      renderMain(), renderAside()
    ]);
  }
});
