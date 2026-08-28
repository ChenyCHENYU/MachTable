import {
  createElement,
  useEffect,
  useRef,
  type CSSProperties,
  type MutableRefObject
} from "react";
import { createGrid, DIRECT_GRID_OPTION_KEYS, EVENT_TYPES } from "@agile-team/mach-table";
import type { GridApi, GridOptions } from "@agile-team/mach-table";

export type RobotGridReactProps<TData = any> = Omit<GridOptions<TData>, "className"> & {
  /** CSS class applied to the React host element. */
  className?: string;
  /** CSS class forwarded to MachTable's inner grid root. */
  gridClassName?: string;
  style?: CSSProperties;
  apiRef?: MutableRefObject<GridApi<TData> | null>;
};

const UPDATABLE_KEYS = DIRECT_GRID_OPTION_KEYS.filter((key) => key !== "className");

export function RobotGrid<TData = any>(props: RobotGridReactProps<TData>) {
  const { className, style, apiRef } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const gridApiRef = useRef<GridApi<TData> | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const initial = propsRef.current;
    const options: Record<string, unknown> = {};
    for (const key of Object.keys(initial) as string[]) {
      if (key === "className" || key === "gridClassName" || key === "style" || key === "apiRef") continue;
      if (key.startsWith("on")) continue;
      options[key] = (initial as Record<string, unknown>)[key];
    }
    if (initial.gridClassName !== undefined) options.className = initial.gridClassName;
    for (const eventType of EVENT_TYPES) {
      const handlerKey = `on${eventType.charAt(0).toUpperCase()}${eventType.slice(1)}`;
      options[handlerKey] = (event: unknown) => {
        const latest = propsRef.current as Record<string, unknown>;
        const handler = latest[handlerKey];
        if (typeof handler === "function") (handler as (event: unknown) => void)(event);
      };
    }

    const api = createGrid<TData>(host, options as GridOptions<TData>);
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

  const rowDataReady = useRef(false);
  useEffect(() => {
    if (!rowDataReady.current) {
      rowDataReady.current = true;
      return;
    }
    gridApiRef.current?.setRowData(props.rowData);
  }, [props.rowData]);

  const columnDefsReady = useRef(false);
  useEffect(() => {
    if (!columnDefsReady.current) {
      columnDefsReady.current = true;
      return;
    }
    gridApiRef.current?.setColumnDefs(props.columnDefs);
  }, [props.columnDefs]);

  const quickFilterReady = useRef(false);
  useEffect(() => {
    if (!quickFilterReady.current) {
      quickFilterReady.current = true;
      return;
    }
    gridApiRef.current?.setQuickFilter(props.quickFilterText);
  }, [props.quickFilterText]);

  const gridClassNameReady = useRef(false);
  useEffect(() => {
    if (!gridClassNameReady.current) {
      gridClassNameReady.current = true;
      return;
    }
    gridApiRef.current?.updateOptions({ className: props.gridClassName });
  }, [props.gridClassName]);

  const optionValues = UPDATABLE_KEYS.map((key) => props[key]);
  const previousOptionValues = useRef<readonly unknown[] | null>(null);
  useEffect(() => {
    const previous = previousOptionValues.current;
    previousOptionValues.current = optionValues;
    if (!previous) {
      return;
    }
    const changed: Record<string, unknown> = {};
    optionValues.forEach((value, index) => {
      if (!Object.is(value, previous[index])) changed[UPDATABLE_KEYS[index]] = value;
    });
    if (Object.keys(changed).length > 0) {
      gridApiRef.current?.updateOptions(changed as Partial<GridOptions<TData>>);
    }
  }, optionValues);

  return createElement("div", {
    ref: hostRef,
    className: `mach-react-host ${className ?? ""}`.trim() || undefined,
    style
  });
}
