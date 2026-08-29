import {
  createElement,
  useEffect,
  useRef,
  type CSSProperties,
  type MutableRefObject
} from "react";
import { createGrid, createMachTablePreset, GRID_OPTION_KEYS, EVENT_TYPES } from "@agile-team/mach-table";
import type { GridApi, GridOptions } from "@agile-team/mach-table";
import { useMachTableDefaults } from "./defaults";

type AdapterOnlyGridOption = "className" | "ariaLabel" | "ariaLabelledBy" | "ariaDescribedBy";

export type MachTableReactProps<TData = any> = Omit<GridOptions<TData>, AdapterOnlyGridOption> & {
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
  defaults: Partial<GridOptions<TData>>
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
  return createMachTablePreset(defaults, explicit as Partial<GridOptions<TData>>);
}

export function MachTable<TData = any>(props: MachTableReactProps<TData>) {
  const { className, style, apiRef } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const gridApiRef = useRef<GridApi<TData> | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const defaults = useMachTableDefaults<TData>();
  const effectiveInputs = [
    defaults,
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
    effectiveCache.current = { inputs: effectiveInputs, options: collectGridOptions(props, defaults) };
  }
  const effectiveOptions = effectiveCache.current.options;
  const effectiveRef = useRef(effectiveOptions);
  effectiveRef.current = effectiveOptions;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const options = { ...effectiveRef.current } as Record<string, unknown>;
    for (const eventType of EVENT_TYPES) {
      const handlerKey = `on${eventType.charAt(0).toUpperCase()}${eventType.slice(1)}`;
      options[handlerKey] = (event: unknown) => {
        const defaultHandler = (effectiveRef.current as Record<string, unknown>)[handlerKey];
        if (typeof defaultHandler === "function") (defaultHandler as (value: unknown) => void)(event);
        const latest = propsRef.current as Record<string, unknown>;
        const handler = latest[handlerKey];
        if (typeof handler === "function" && handler !== defaultHandler) {
          (handler as (value: unknown) => void)(event);
        }
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
      changed[GRID_OPTION_KEYS[index]] = value;
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

/** @deprecated Use MachTable. Kept as a source-compatible alias through 0.x. */
export const RobotGrid = MachTable;
/** @deprecated Use MachTableReactProps. */
export type RobotGridReactProps<TData = any> = MachTableReactProps<TData>;
