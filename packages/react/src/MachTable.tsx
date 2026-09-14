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

const EVENT_HANDLER_KEYS = new Set(EVENT_TYPES.map(handlerNameOf));

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function equivalentConfigValue(left: unknown, right: unknown, depth = 2): boolean {
  if (Object.is(left, right)) return true;
  if (depth <= 0) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || left.length > 100) return false;
    return left.every((value, index) => equivalentConfigValue(value, right[index], depth - 1));
  }
  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length || keys.length > 50) return false;
  return keys.every((key) => Object.prototype.hasOwnProperty.call(right, key) &&
    equivalentConfigValue(left[key], right[key], depth - 1));
}

function effectiveInputsEqual(
  current: readonly unknown[],
  previous: readonly unknown[]
): boolean {
  if (current.length !== previous.length) return false;
  return current.every((value, index) => {
    if (index < 2) return Object.is(value, previous[index]);
    const key = GRID_OPTION_KEYS[index - 2];
    if (EVENT_HANDLER_KEYS.has(key)) return true;
    if (key === "rowData" || key === "columnDefs") return Object.is(value, previous[index]);
    return equivalentConfigValue(value, previous[index]);
  });
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
    ...GRID_OPTION_KEYS.map((key) => {
      // Event bridges read propsRef/effectiveRef at dispatch time. Treating an
      // inline React callback as a grid-option change would rebuild merged
      // object options and can tear down an active editor during a host render.
      if (EVENT_HANDLER_KEYS.has(key)) return undefined;
      return key === "className"
        ? props.gridClassName
        : key === "ariaLabel"
          ? props.gridAriaLabel
          : key === "ariaLabelledBy"
            ? props.gridAriaLabelledBy
            : key === "ariaDescribedBy"
              ? props.gridAriaDescribedBy
              : props[key];
    })
  ];
  const effectiveCache = useRef<{ inputs: readonly unknown[]; options: GridOptions<TData> } | null>(null);
  if (
    !effectiveCache.current ||
    !effectiveInputsEqual(effectiveInputs, effectiveCache.current.inputs)
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
        const defaultHandler = (effectiveRef.current as Record<string, unknown>)[handlerKey];
        const propHandler = (propsRef.current as Record<string, unknown>)[handlerKey];
        try {
          if (typeof defaultHandler === "function") {
            (defaultHandler as (value: unknown) => void)(event);
          }
        } finally {
          if (typeof propHandler === "function" && propHandler !== defaultHandler) {
            (propHandler as (value: unknown) => void)(event);
          }
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
