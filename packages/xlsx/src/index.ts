import {
  type CsvExportParams,
  type GridApi,
  type ImportCsvOptions
} from "@agile-team/mach-table";
import { beginGridInput, canReplaceGridData } from "@agile-team/mach-table/adapter";

export interface XlsxWorkbook {
  SheetNames: string[];
  Sheets: Record<string, unknown>;
}

export interface XlsxEngine {
  utils: {
    book_new(): XlsxWorkbook;
    aoa_to_sheet(rows: readonly (readonly unknown[])[]): unknown;
    book_append_sheet(workbook: XlsxWorkbook, sheet: unknown, name?: string): void;
    sheet_to_json?(sheet: unknown, options?: Record<string, unknown>): unknown[][];
  };
  writeFileXLSX?(workbook: XlsxWorkbook, filename: string, options?: Record<string, unknown>): void | Promise<void>;
  writeFile?(workbook: XlsxWorkbook, filename: string, options?: Record<string, unknown>): void | Promise<void>;
  read?(data: unknown, options?: Record<string, unknown>): XlsxWorkbook;
}

export type XlsxEngineModule = XlsxEngine | { default: XlsxEngine };
export type XlsxEngineSource = XlsxEngineModule | (() => Promise<XlsxEngineModule>);

export interface ExportGridToXlsxParams extends CsvExportParams {
  fileName?: string;
  sheetName?: string;
  writeOptions?: Record<string, unknown>;
  transformCell?(value: string, rowIndex: number, columnIndex: number): unknown;
}

export interface ImportGridFromXlsxParams extends ImportCsvOptions {
  columns?: readonly string[];
  sheet?: string | number;
  readOptions?: Record<string, unknown>;
}

function isEngine(value: unknown): value is XlsxEngine {
  return typeof value === "object" && value !== null && "utils" in value;
}

async function resolveEngine(source: XlsxEngineSource): Promise<XlsxEngine> {
  const loaded = typeof source === "function" ? await source() : source;
  const moduleDefault = typeof loaded === "object" && loaded !== null && "default" in loaded
    ? loaded.default
    : undefined;
  const engine = isEngine(loaded) ? loaded : isEngine(moduleDefault) ? moduleDefault : undefined;
  if (!engine?.utils?.book_new || !engine.utils.aoa_to_sheet || !engine.utils.book_append_sheet) {
    throw new TypeError("[MachTable] Invalid XLSX engine adapter.");
  }
  return engine;
}

function safeSheetName(value: string | undefined): string {
  const name = (value ?? "Data").replace(/[\\/?*\[\]:]/g, " ").trim().slice(0, 31);
  return name || "Data";
}

function safeFileName(value: string | undefined): string {
  const input = value?.trim() || "mach-table.xlsx";
  const name = input.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").trim() || "mach-table.xlsx";
  return /\.xlsx$/i.test(name) ? name : `${name}.xlsx`;
}

function legacyText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return value.toString();
  if (typeof value === "symbol") return value.description ?? "";
  if (typeof value === "function") return value.name;
  return JSON.stringify(value) ?? "";
}

/** Uses a lazily supplied workbook engine, keeping it out of the main grid bundle. */
export async function exportGridToXlsx<TData>(
  api: GridApi<TData>,
  source: XlsxEngineSource,
  params: ExportGridToXlsxParams = {}
): Promise<XlsxWorkbook> {
  const engine = await resolveEngine(source);
  if (api.isDestroyed()) throw new Error("[MachTable] Cannot export a destroyed grid.");
  const matrix = api.io.exportMatrix({ ...params, target: "xlsx" });
  // Legacy string transforms remain explicit; the default matrix retains numbers, booleans and Dates.
  const rows = params.transformCell ? matrix.map((row, rowIndex) => row.map((value, columnIndex) => {
    const text = legacyText(value);
    return params.transformCell!(text, rowIndex, columnIndex) ?? text;
  })) : matrix;
  const workbook = engine.utils.book_new();
  const sheet = engine.utils.aoa_to_sheet(rows);
  engine.utils.book_append_sheet(workbook, sheet, safeSheetName(params.sheetName));
  const fileName = safeFileName(params.fileName);
  if (engine.writeFileXLSX) await engine.writeFileXLSX(workbook, fileName, params.writeOptions);
  else if (engine.writeFile) await engine.writeFile(workbook, fileName, params.writeOptions);
  else throw new TypeError("[MachTable] XLSX engine must expose writeFileXLSX or writeFile.");
  return workbook;
}

function readWorksheet(engine: XlsxEngine, data: unknown, params: ImportGridFromXlsxParams): unknown[][] {
  if (!engine.read || !engine.utils.sheet_to_json) {
    throw new TypeError("[MachTable] XLSX import requires engine.read and utils.sheet_to_json.");
  }
  const workbook = engine.read(data, { cellDates: true, ...params.readOptions });
  if (!workbook || !Array.isArray(workbook.SheetNames) || !workbook.Sheets || typeof workbook.Sheets !== "object") {
    throw new TypeError("[MachTable] XLSX engine returned an invalid workbook.");
  }
  const sheetName = typeof params.sheet === "number"
    ? workbook.SheetNames[params.sheet]
    : params.sheet ?? workbook.SheetNames[0];
  if (!sheetName || !(sheetName in workbook.Sheets)) {
    throw new RangeError(`[MachTable] Worksheet not found: ${String(params.sheet ?? 0)}.`);
  }
  const rows = engine.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true });
  if (!Array.isArray(rows) || rows.some((row) => !Array.isArray(row))) {
    throw new TypeError("[MachTable] XLSX worksheet must resolve to an array of rows.");
  }
  return rows;
}

/** Reads typed cells directly: replace/append load records; paste starts interactive validation. No import-plan preview. */
export async function importGridFromXlsx<TData>(
  api: GridApi<TData>,
  source: XlsxEngineSource,
  data: unknown,
  params: ImportGridFromXlsxParams = {}
): Promise<boolean> {
  if (!canReplaceGridData(api)) return false;
  const current = beginGridInput(api);
  let changed = false;
  const off = (["modelUpdated", "cellValueChanged", "cellEditingStarted", "rowEditingStarted"] as const)
    .map(type => api.on(type, () => { changed = true; }));
  const valid = (): boolean => !changed && current() && canReplaceGridData(api);
  try {
    const engine = await resolveEngine(source);
    if (!valid()) return false;
    const rows = readWorksheet(engine, data, params);
    if (!valid()) return false;
    return api.io.importMatrix(rows, {
      mode: params.mode,
      headerRowIndex: params.headerRowIndex,
      columns: params.columns,
      coerceNumbers: params.coerceNumbers,
      // Preserve the old per-call string callback contract; column parsers receive raw typed values.
      parseValue: params.parseValue ? value => params.parseValue!({ ...value, value: legacyText(value.value) }) : undefined
    });
  } finally { off.forEach(unsubscribe => unsubscribe()); }
}

export function createXlsxExtension(source: XlsxEngineSource) {
  return {
    export<TData>(api: GridApi<TData>, params?: ExportGridToXlsxParams) {
      return exportGridToXlsx(api, source, params);
    },
    import<TData>(api: GridApi<TData>, data: unknown, params?: ImportGridFromXlsxParams) {
      return importGridFromXlsx(api, source, data, params);
    }
  };
}
