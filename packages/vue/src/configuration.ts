import {
  createMachTablePreset,
  type ColDef,
  type GridComponents,
  type GridOptions
} from "@agile-team/mach-table";

export type MachTablePresetSelection = string | readonly string[] | false | null;

export interface MachTableConfigWarning {
  code: "UNKNOWN_PRESET";
  message: string;
  preset?: string;
}

export interface MachTableRuntimeConfig {
  /** Defaults inherited by every table in this application or subtree. */
  defaults?: Partial<GridOptions<any>>;
  /** Application-wide semantic column types. Kept separate for config readability. */
  columnTypes?: Readonly<Record<string, Partial<ColDef<any>>>>;
  /** Application-wide renderer/editor registry. Per-table components can override it. */
  components?: GridComponents;
  /** Named, reusable behavior profiles such as `list`, `crud` or `picker`. */
  presets?: Readonly<Record<string, Partial<GridOptions<any>>>>;
  /** Preset used when a table does not declare its own `preset`. Set false to disable. */
  defaultPreset?: MachTablePresetSelection;
  /** Receives non-fatal configuration diagnostics. */
  onConfigWarning?: (warning: MachTableConfigWarning) => void;
}

export interface ResolvedMachTableConfig {
  readonly defaults: Partial<GridOptions<any>>;
  readonly presets: Readonly<Record<string, Partial<GridOptions<any>>>>;
  readonly defaultPreset: MachTablePresetSelection;
  readonly onConfigWarning?: (warning: MachTableConfigWarning) => void;
}

export interface MachTableOptionExplanation {
  readonly key: keyof GridOptions<any> | string;
  readonly value: unknown;
  /** The most specific layer that declared the option. */
  readonly source: string;
  readonly layers: readonly { name: string; value: unknown }[];
}

export interface ResolvedMachTableGridOptions<TData = any> {
  readonly options: GridOptions<TData>;
  explain(key: keyof GridOptions<TData> | string): MachTableOptionExplanation;
}

/**
 * Type-checks an application configuration without adding runtime work.
 * Put the result in a dedicated `mach-table.config.ts` and pass it to app.use().
 */
export function defineMachTableConfig<const TConfig extends MachTableRuntimeConfig>(config: TConfig): TConfig {
  return config;
}

function presetNames(selection: MachTablePresetSelection | undefined): readonly string[] {
  if (!selection) return [];
  return (Array.isArray(selection) ? selection : [selection])
    .filter((name): name is string => typeof name === "string" && name.trim().length > 0);
}

export function normalizeMachTableConfig(config: MachTableRuntimeConfig = {}): ResolvedMachTableConfig {
  return {
    defaults: createMachTablePreset(
      { columnTypes: config.columnTypes, components: config.components },
      config.defaults ?? {}
    ),
    presets: Object.fromEntries(
      Object.entries(config.presets ?? {}).map(([name, preset]) => [name, createMachTablePreset(preset)])
    ),
    defaultPreset: config.defaultPreset ?? false,
    ...(config.onConfigWarning ? { onConfigWarning: config.onConfigWarning } : {})
  };
}

/** Merges an app/route configuration while preserving parent preset definitions. */
export function mergeMachTableConfig(
  parent: ResolvedMachTableConfig,
  child: MachTableRuntimeConfig
): ResolvedMachTableConfig {
  const normalizedChild = normalizeMachTableConfig(child);
  const presets: Record<string, Partial<GridOptions<any>>> = { ...parent.presets };
  for (const [name, preset] of Object.entries(child.presets ?? {})) {
    presets[name] = createMachTablePreset(parent.presets[name] ?? {}, preset);
  }
  return {
    defaults: createMachTablePreset(parent.defaults, normalizedChild.defaults),
    presets,
    defaultPreset: child.defaultPreset === undefined ? parent.defaultPreset : child.defaultPreset,
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
        message: `[MachTable] Unknown preset \"${name}\". Register it in mach-table.config.ts or remove the preset prop.`
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
