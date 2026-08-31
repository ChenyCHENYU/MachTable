import {
  createElement,
  useEffect,
  useRef,
  type CSSProperties,
  type MutableRefObject
} from "react";
import { createGrid, EVENT_TYPES } from "@agile-team/mach-table";
import { GRID_OPTION_KEYS, resolveMachTableGridOptions } from "@agile-team/mach-table/adapter";
import type { GridApi, GridOptions, MachTablePresetSelection } from "@agile-team/mach-table";
import { useMachTableConfig } from "./defaults";

type AdapterOnlyGridOption = "className" | "ariaLabel" | "ariaLabelledBy" | "ariaDescribedBy";

function handlerNameOf(eventType: string): string {
  return `on${eventType.charAt(0).toUpperCase()}${eventType.slice(1)}`;
}

export type MachTableReactProps<TData = any> = Omit<GridOptions<TData>, AdapterOnlyGridOption> & {
  /** Named application preset(s). Explicit component props still win. */
  preset?: MachTablePresetSelection;
  /** CSS class applied to the React host element. */
  className?: string;
  /** CSS class forwarded to MachTable's inner grid root. */
  gridClassName?: string;
  gridAriaLabel?: string;
  gridAriaLabelledBy?: string;
  gridAriaDescribedBy?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  style?: CSSProperties;
  apiRef?: MutableRefObject<GridApi<TData> | null>;
};

function collectGridOptions<TData>(
  props: MachTableReactProps<TData>,
  config: ReturnType<typeof useMachTableConfig>
): GridOptions<TData> {
  const explicit: Record<string, unknown> = {};
  for (const key of GRID_OPTION_KEYS) {
    if (key === "className") continue;
    const value = key === "ariaLabel"
      ? props.gridAriaLabel
      : key === "ariaLabelledBy"
        ? props.gridAriaLabelledBy
        : key === "ariaDescribedBy"
          ? props.gridAriaDescribedBy
          : props[key];
    if (value !== undefined) explicit[key] = value;
  }
  if (props.gridClassName !== undefined) explicit.className = props.gridClassName;
  return resolveMachTableGridOptions(config, props.preset, explicit as Partial<GridOptions<TData>>).options;
}

export function MachTable<TData = any>(props: MachTableReactProps<TData>) {
  const { className, style, apiRef } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const gridApiRef = useRef<GridApi<TData> | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const config = useMachTableConfig();
  const effectiveInputs = [
    config,
    props.preset,
    ...GRID_OPTION_KEYS.map((key) => key === "className"
      ? props.gridClassName
      : key === "ariaLabel"
        ? props.gridAriaLabel
        : key === "ariaLabelledBy"
          ? props.gridAriaLabelledBy
          : key === "ariaDescribedBy"
            ? props.gridAriaDescribedBy
            : props[key])
  ];
  const effectiveCache = useRef<{ inputs: readonly unknown[]; options: GridOptions<TData> } | null>(null);
  if (
    !effectiveCache.current ||
    effectiveCache.current.inputs.length !== effectiveInputs.length ||
    effectiveInputs.some((value, index) => !Object.is(value, effectiveCache.current?.inputs[index]))
  ) {
    effectiveCache.current = { inputs: effectiveInputs, options: collectGridOptions(props, config) };
  }
  const effectiveOptions = effectiveCache.current.options;
  const effectiveRef = useRef(effectiveOptions);
  effectiveRef.current = effectiveOptions;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const options = { ...effectiveRef.current } as Record<string, unknown>;
    for (const eventType of EVENT_TYPES) {
      const handlerKey = handlerNameOf(eventType);
      options[handlerKey] = (event: unknown) => {
        const handler = (propsRef.current as Record<string, unknown>)[handlerKey];
        if (typeof handler === "function") (handler as (value: unknown) => void)(event);
      };
    }

    const api = createGrid<TData>(host, options);
    gridApiRef.current = api;
    return () => {
      api.destroy();
      gridApiRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!apiRef) return;
    const assigned = gridApiRef.current;
    apiRef.current = assigned;
    return () => {
      if (apiRef.current === assigned) apiRef.current = null;
    };
  }, [apiRef]);

  const optionValues = GRID_OPTION_KEYS.map((key) => effectiveOptions[key]);
  const previousOptionValues = useRef<readonly unknown[] | null>(null);
  useEffect(() => {
    const previous = previousOptionValues.current;
    previousOptionValues.current = optionValues;
    if (!previous) {
      return;
    }
    const changed: Record<string, unknown> = {};
    optionValues.forEach((value, index) => {
      if (Object.is(value, previous[index])) return;
      const key = GRID_OPTION_KEYS[index];
      changed[key] = value;
    });
    if (Object.keys(changed).length > 0) {
      gridApiRef.current?.updateOptions(changed);
    }
  }, optionValues);

  return createElement("div", {
    ref: hostRef,
    className: `mach-react-host ${className ?? ""}`.trim() || undefined,
    style,
    "aria-label": props["aria-label"],
    "aria-labelledby": props["aria-labelledby"],
    "aria-describedby": props["aria-describedby"]
  });
}
