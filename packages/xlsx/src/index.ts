import {
  parseCsv,
  type CsvExportParams,
  type GridApi,
  type ImportCsvOptions
} from "@agile-team/mach-table";

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

function safeSeparator(value: string | undefined): string {
  const separator = value ?? ",";
  if (separator.length !== 1 || /["\r\n]/.test(separator)) {
    throw new TypeError("[MachTable] XLSX CSV bridge requires a single non-quote separator character.");
  }
  return separator;
}

/** Uses a lazily supplied workbook engine, keeping it out of the main grid bundle. */
export async function exportGridToXlsx<TData>(
  api: GridApi<TData>,
  source: XlsxEngineSource,
  params: ExportGridToXlsxParams = {}
): Promise<XlsxWorkbook> {
  const engine = await resolveEngine(source);
  const separator = safeSeparator(params.columnSeparator);
  const csv = api.io.exportCsv(params);
  const rows = parseCsv(csv, separator).map((row, rowIndex) =>
    row.map((value, columnIndex) => params.transformCell?.(value, rowIndex, columnIndex) ?? value)
  );
  const workbook = engine.utils.book_new();
  const sheet = engine.utils.aoa_to_sheet(rows);
  engine.utils.book_append_sheet(workbook, sheet, safeSheetName(params.sheetName));
  const fileName = safeFileName(params.fileName);
  if (engine.writeFileXLSX) await engine.writeFileXLSX(workbook, fileName, params.writeOptions);
  else if (engine.writeFile) await engine.writeFile(workbook, fileName, params.writeOptions);
  else throw new TypeError("[MachTable] XLSX engine must expose writeFileXLSX or writeFile.");
  return workbook;
}

function csvCell(value: unknown, separator: string): string {
  let text = "";
  if (typeof value === "string") text = value;
  else if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") text = value.toString();
  else if (typeof value === "symbol") text = value.description ?? "";
  else if (typeof value === "function") text = value.name;
  else if (value != null) text = JSON.stringify(value) ?? "";
  return text.includes(separator) || /["\n\r]/.test(text)
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}

/** Reads the selected worksheet through the host engine and reuses core's safe CSV importer. */
export async function importGridFromXlsx<TData>(
  api: GridApi<TData>,
  source: XlsxEngineSource,
  data: unknown,
  params: ImportGridFromXlsxParams = {}
): Promise<boolean> {
  const engine = await resolveEngine(source);
  if (!engine.read || !engine.utils.sheet_to_json) {
    throw new TypeError("[MachTable] XLSX import requires engine.read and utils.sheet_to_json.");
  }
  const workbook = engine.read(data, params.readOptions);
  if (!workbook || !Array.isArray(workbook.SheetNames) || !workbook.Sheets || typeof workbook.Sheets !== "object") {
    throw new TypeError("[MachTable] XLSX engine returned an invalid workbook.");
  }
  const sheetName = typeof params.sheet === "number"
    ? workbook.SheetNames[params.sheet]
    : params.sheet ?? workbook.SheetNames[0];
  if (!sheetName || !(sheetName in workbook.Sheets)) {
    throw new RangeError(`[MachTable] Worksheet not found: ${String(params.sheet ?? 0)}.`);
  }
  const rows = engine.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: false });
  if (!Array.isArray(rows) || rows.some((row) => !Array.isArray(row))) {
    throw new TypeError("[MachTable] XLSX worksheet must resolve to an array of rows.");
  }
  const separator = safeSeparator(params.separator);
  const csv = rows.map((row) => row.map((value) => csvCell(value, separator)).join(separator)).join("\n");
  const csvOptions: ImportCsvOptions = {
    separator: params.separator,
    mode: params.mode,
    headerRowIndex: params.headerRowIndex,
    coerceNumbers: params.coerceNumbers,
    parseValue: params.parseValue
  };
  return api.io.importCsv(csv, csvOptions);
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
