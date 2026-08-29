import {
  createApp,
  getCurrentInstance,
  h,
  render,
  shallowReactive,
  type AppContext,
  type Component,
  type VNodeChild
} from "vue";
import type { CellEditorFactory, CellEditorParams } from "@agile-team/mach-table";

export interface VueCellEditorOptions<TData = any, TValue = any> {
  props?: Record<string, unknown> | ((params: CellEditorParams<TData, TValue>) => Record<string, unknown>);
  valueProp?: string;
  updateEvent?: string;
  children?: (context: {
    params: CellEditorParams<TData, TValue>;
    value: TValue;
    setValue(value: TValue): void;
  }) => VNodeChild;
  appContext?: AppContext;
  focusSelector?: string;
  className?: string;
}

function currentAppContext(explicit?: AppContext): AppContext | undefined {
  if (explicit) return explicit;
  try { return getCurrentInstance()?.appContext; } catch { return undefined; }
}

function mountEditor(component: Component, host: HTMLElement, appContext?: AppContext): () => void {
  if (appContext) {
    const vnode = h(component);
    vnode.appContext = appContext;
    render(vnode, host);
    return () => render(null, host);
  }
  const app = createApp(component);
  app.mount(host);
  return () => app.unmount();
}

/** Adapts any Vue v-model component to MachTable's editor lifecycle. */
export function vueCellEditor<TData = any, TValue = any>(
  component: Component,
  options: VueCellEditorOptions<TData, TValue> = {}
): CellEditorFactory {
  const appContext = currentAppContext(options.appContext);
  const valueProp = options.valueProp ?? "modelValue";
  const updateEvent = options.updateEvent ?? "onUpdate:modelValue";
  return (params: CellEditorParams<TData, TValue>) => {
    const state = shallowReactive<{ value: TValue }>({ value: params.value });
    const host = document.createElement("div");
    host.className = `mach-cell-vue mach-cell-vue--editor${options.className ? ` ${options.className}` : ""}`;
    host.style.width = "100%";
    const Root = {
      name: "MachTableVueCellEditor",
      setup: () => () => {
        const suppliedProps = typeof options.props === "function" ? options.props(params) : options.props;
        const setValue = (value: TValue) => { state.value = value; };
        return h(component, {
          ...(suppliedProps ?? {}),
          [valueProp]: state.value,
          [updateEvent]: setValue,
          style: [{ width: "100%" }, suppliedProps?.style]
        }, options.children ? () => options.children!({ params, value: state.value, setValue }) : undefined);
      }
    };
    const unmount = mountEditor(Root, host, appContext);
    let destroyed = false;
    return {
      el: host,
      getValue: () => state.value,
      focus: () => {
        const selector = options.focusSelector ??
          "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex='-1'])";
        host.querySelector<HTMLElement>(selector)?.focus();
      },
      destroy: () => {
        if (destroyed) return;
        destroyed = true;
        unmount();
      }
    };
  };
}

export interface ElementPlusEditorComponents {
  input?: Component;
  inputNumber?: Component;
  select?: Component;
  datePicker?: Component;
}

export interface ElementPlusEditors {
  input?: CellEditorFactory;
  number?: CellEditorFactory;
  select?: CellEditorFactory;
  date?: CellEditorFactory;
}

/** Optional Element Plus bridge; Element Plus remains owned by the host app. */
export function createElementPlusEditors(
  components: ElementPlusEditorComponents,
  defaults: Partial<Record<keyof ElementPlusEditors, VueCellEditorOptions>> = {}
): ElementPlusEditors {
  return {
    input: components.input ? vueCellEditor(components.input, defaults.input) : undefined,
    number: components.inputNumber ? vueCellEditor(components.inputNumber, defaults.number) : undefined,
    select: components.select ? vueCellEditor(components.select, { props: { teleported: true }, ...defaults.select }) : undefined,
    date: components.datePicker ? vueCellEditor(components.datePicker, {
      props: { teleported: true, valueFormat: "YYYY-MM-DD" },
      ...defaults.date
    }) : undefined
  };
}
