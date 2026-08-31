import { createMachTablePreset } from "./presets";
import type { ColDef } from "../types/colDef";
import type { GridComponents, GridOptions } from "../types/options";

export type MachTablePresetSelection = string | readonly string[] | false;

export type MachTableInstanceOptionKey =
  | "rowData"
  | "columnDefs"
  | "datasource"
  | "loading"
  | "error"
  | "initialState"
  | "persistence"
  | "components"
  | "columnTypes";

/** Safe application/preset defaults. Data, request state and persistence identity stay per table. */
export type MachTableDefaults = Omit<Partial<GridOptions<any>>, MachTableInstanceOptionKey>;
export type MachTablePreset = MachTableDefaults;

export interface MachTableConfigWarning {
  code: "UNKNOWN_PRESET" | "INVALID_DEFAULT_OPTION" | "INVALID_PRESET_OPTION";
  message: string;
  preset?: string;
  option?: string;
  layer?: string;
}

export interface MachTableRuntimeConfig {
  /** Defaults inherited by every table in this application or subtree. */
  defaults?: MachTableDefaults;
  /** Application-wide semantic column types. Kept separate for config readability. */
  columnTypes?: Readonly<Record<string, Partial<ColDef<any>>>>;
  /** Application-wide renderer/editor registry. Per-table components can override it. */
  components?: GridComponents;
  /** Named, reusable behavior profiles such as `list`, `crud` or `picker`. */
  presets?: Readonly<Record<string, MachTablePreset>>;
  /** Preset used when a table does not declare its own preset. Set false to disable. */
  defaultPreset?: MachTablePresetSelection;
  /** Throw on unsafe config-center keys. Defaults to true. */
  strict?: boolean;
  onConfigWarning?: (warning: MachTableConfigWarning) => void;
}

export interface ResolvedMachTableConfig {
  readonly defaults: MachTableDefaults;
  readonly presets: Readonly<Record<string, MachTablePreset>>;
  readonly defaultPreset: MachTablePresetSelection;
  readonly strict: boolean;
  readonly onConfigWarning?: (warning: MachTableConfigWarning) => void;
}

export interface MachTableOptionExplanation {
  readonly key: keyof GridOptions<any> | string;
  readonly value: unknown;
  readonly source: string;
  readonly layers: readonly { name: string; value: unknown }[];
}

export interface ResolvedMachTableGridOptions<TData = any> {
  readonly options: GridOptions<TData>;
  explain(key: keyof GridOptions<TData> | string): MachTableOptionExplanation;
}

/** Type-checks a dedicated `mach-table.config.ts` without runtime work. */
export function defineMachTableConfig<const TConfig extends MachTableRuntimeConfig>(config: TConfig): TConfig {
  return config;
}

function presetNames(selection: MachTablePresetSelection | undefined): readonly string[] {
  if (!selection) return [];
  return (Array.isArray(selection) ? selection : [selection])
    .filter((name): name is string => typeof name === "string" && name.trim().length > 0);
}

const INSTANCE_ONLY_OPTIONS = new Set<string>([
  "rowData",
  "columnDefs",
  "datasource",
  "loading",
  "error",
  "initialState",
  "persistence",
  "components",
  "columnTypes",
  // Removed pre-0.24 persistence keys are also rejected instead of leaking into defaults.
  "stateKey",
  "stateStore",
  "stateSaveDebounceMs",
  "columnStateKey",
  "columnStateStore"
]);

function sanitizeConfigLayer(
  config: MachTableRuntimeConfig,
  value: unknown,
  layer: "defaults" | `preset:${string}`
): MachTableDefaults {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: Record<string, unknown> = {};
  for (const [key, optionValue] of Object.entries(value)) {
    if (!INSTANCE_ONLY_OPTIONS.has(key)) {
      output[key] = optionValue;
      continue;
    }
    const warning: MachTableConfigWarning = {
      code: layer === "defaults" ? "INVALID_DEFAULT_OPTION" : "INVALID_PRESET_OPTION",
      option: key,
      layer,
      message: `[MachTable] "${key}" is instance-only and cannot be declared in config ${layer}.`
    };
    config.onConfigWarning?.(warning);
    if (config.strict !== false) throw new TypeError(warning.message);
  }
  return output;
}

export function normalizeMachTableConfig(config: MachTableRuntimeConfig = {}): ResolvedMachTableConfig {
  const defaults = sanitizeConfigLayer(config, config.defaults, "defaults");
  return {
    defaults: createMachTablePreset(
      { columnTypes: config.columnTypes, components: config.components },
      defaults
    ) as MachTableDefaults,
    presets: Object.fromEntries(
      Object.entries(config.presets ?? {}).map(([name, preset]) => [
        name,
        createMachTablePreset(sanitizeConfigLayer(config, preset, `preset:${name}`)) as MachTablePreset
      ])
    ),
    defaultPreset: config.defaultPreset ?? false,
    strict: config.strict !== false,
    ...(config.onConfigWarning ? { onConfigWarning: config.onConfigWarning } : {})
  };
}

/** Merges app, route and layout configuration while preserving named presets. */
export function mergeMachTableConfig(
  parent: ResolvedMachTableConfig,
  child: MachTableRuntimeConfig
): ResolvedMachTableConfig {
  const normalizedChild = normalizeMachTableConfig({
    ...child,
    strict: child.strict ?? parent.strict,
    onConfigWarning: child.onConfigWarning ?? parent.onConfigWarning
  });
  const presets: Record<string, MachTablePreset> = { ...parent.presets };
  for (const [name, preset] of Object.entries(normalizedChild.presets)) {
    presets[name] = createMachTablePreset(parent.presets[name] ?? {}, preset);
  }
  return {
    defaults: createMachTablePreset(parent.defaults, normalizedChild.defaults) as MachTableDefaults,
    presets,
    defaultPreset: child.defaultPreset === undefined ? parent.defaultPreset : child.defaultPreset,
    strict: child.strict ?? parent.strict,
    ...(child.onConfigWarning ?? parent.onConfigWarning
      ? { onConfigWarning: child.onConfigWarning ?? parent.onConfigWarning }
      : {})
  };
}

export function resolveMachTableGridOptions<TData>(
  config: ResolvedMachTableConfig,
  requestedPreset: MachTablePresetSelection | undefined,
  explicit: Partial<GridOptions<TData>>,
  reportWarning?: (warning: MachTableConfigWarning) => void
): ResolvedMachTableGridOptions<TData> {
  const selected = requestedPreset === undefined ? config.defaultPreset : requestedPreset;
  const layers: { name: string; options: Partial<GridOptions<TData>> }[] = [
    { name: "application defaults", options: config.defaults as Partial<GridOptions<TData>> }
  ];
  for (const name of presetNames(selected)) {
    const preset = config.presets[name];
    if (!preset) {
      const warning: MachTableConfigWarning = {
        code: "UNKNOWN_PRESET",
        preset: name,
        message: `[MachTable] Unknown preset "${name}". Register it in mach-table.config.ts or remove the preset.`
      };
      if (reportWarning) reportWarning(warning);
      else if (config.onConfigWarning) config.onConfigWarning(warning);
      else console.warn(warning.message);
      continue;
    }
    layers.push({ name: `preset:${name}`, options: preset as Partial<GridOptions<TData>> });
  }
  layers.push({ name: "table props", options: explicit });
  const options = createMachTablePreset(...layers.map((layer) => layer.options));

  return {
    options,
    explain(key) {
      const declared = layers
        .filter((layer) => Object.prototype.hasOwnProperty.call(layer.options, key))
        .map((layer) => ({ name: layer.name, value: (layer.options as Record<string, unknown>)[key] }));
      const last = declared[declared.length - 1];
      return {
        key,
        value: (options as Record<string, unknown>)[key],
        source: last?.name ?? "MachTable built-in",
        layers: declared
      };
    }
  };
}
