import { describe, expect, it, vi } from "vitest";
import { createXlsxExtension, exportGridToXlsx, importGridFromXlsx, type XlsxEngine } from "../index";
import type { GridApi } from "@agile-team/mach-table";

function engine(): XlsxEngine {
  return {
    utils: {
      book_new: () => ({ SheetNames: [], Sheets: {} }),
      aoa_to_sheet: (rows) => rows,
      book_append_sheet: (book, sheet, name = "Sheet1") => {
        book.SheetNames.push(name);
        book.Sheets[name] = sheet;
      },
      sheet_to_json: (sheet) => sheet as unknown[][]
    },
    writeFileXLSX: vi.fn(),
    read: (data) => data as ReturnType<XlsxEngine["utils"]["book_new"]>
  };
}

describe("optional XLSX extension", () => {
  it("loads the engine on demand and exports a sanitized workbook", async () => {
    const adapter = engine();
    const loader = vi.fn(async () => ({ default: adapter }));
    const api = { getDataAsCsv: () => "Name,Age\nMach,3" } as GridApi;
    const workbook = await exportGridToXlsx(api, loader, { fileName: "report", sheetName: "B/Data" });
    expect(loader).toHaveBeenCalledOnce();
    expect(workbook.SheetNames).toEqual(["B Data"]);
    expect(adapter.writeFileXLSX).toHaveBeenCalledWith(workbook, "report.xlsx", undefined);
  });

  it("imports a selected worksheet through the core CSV path", async () => {
    const adapter = engine();
    const workbook = { SheetNames: ["Data"], Sheets: { Data: [["name", "note"], ["Mach", "a,b"]] } };
    const importCsv = vi.fn(() => true);
    const api = { importCsv } as unknown as GridApi;
    await expect(importGridFromXlsx(api, adapter, workbook, { mode: "append" })).resolves.toBe(true);
    expect(importCsv).toHaveBeenCalledWith('name,note\nMach,"a,b"', { mode: "append" });
  });

  it("creates a reusable extension without loading until use", async () => {
    const adapter = engine();
    const loader = vi.fn(async () => adapter);
    const extension = createXlsxExtension(loader);
    expect(loader).not.toHaveBeenCalled();
    await extension.export({ getDataAsCsv: () => "A\n1" } as GridApi);
    expect(loader).toHaveBeenCalledOnce();
  });

  it("supports the generic writer, cell transforms and empty sanitized names", async () => {
    const adapter = engine();
    const writeFile = vi.fn();
    delete adapter.writeFileXLSX;
    adapter.writeFile = writeFile;
    const transformCell = vi.fn((value: string, row: number, column: number) =>
      row === 1 && column === 0 ? Number(value) : value
    );
    const workbook = await exportGridToXlsx(
      { getDataAsCsv: () => "Value\n42" } as GridApi,
      adapter,
      { fileName: "report.XLSX", sheetName: "/?:*[]", transformCell, writeOptions: { compression: true } }
    );
    expect(workbook.SheetNames).toEqual(["Data"]);
    expect(workbook.Sheets.Data).toEqual([["Value"], [42]]);
    expect(transformCell).toHaveBeenCalledTimes(2);
    expect(writeFile).toHaveBeenCalledWith(workbook, "report.XLSX", { compression: true });
  });

  it("sanitizes browser filenames and validates CSV bridge separators", async () => {
    const adapter = engine();
    const api = { getDataAsCsv: () => "A\n1" } as GridApi;
    await exportGridToXlsx(api, adapter, { fileName: "../unsafe:name" });
    expect(adapter.writeFileXLSX).toHaveBeenCalledWith(expect.any(Object), ".. unsafe name.xlsx", undefined);
    await expect(exportGridToXlsx(api, adapter, { columnSeparator: "||" })).rejects.toThrow(
      "single non-quote separator"
    );
  });

  it("rejects invalid engines and engines without a writer", async () => {
    const api = { getDataAsCsv: () => "A\n1" } as GridApi;
    await expect(exportGridToXlsx(api, null as unknown as XlsxEngine)).rejects.toThrow(
      "Invalid XLSX engine adapter"
    );
    await expect(exportGridToXlsx(api, { default: { utils: {} } } as unknown as XlsxEngine)).rejects.toThrow(
      "Invalid XLSX engine adapter"
    );
    const adapter = engine();
    delete adapter.writeFileXLSX;
    await expect(exportGridToXlsx(api, adapter)).rejects.toThrow("must expose writeFileXLSX or writeFile");
  });

  it("serializes workbook cell types and forwards import options", async () => {
    const adapter = engine();
    const namedCell = function namedCell() { return undefined; };
    const workbook = {
      SheetNames: ["Skip", "Data"],
      Sheets: {
        Skip: [],
        Data: [[
          "plain",
          "a,\"b\"",
          "semi;colon",
          12,
          true,
          3n,
          Symbol("symbol"),
          Symbol(),
          namedCell,
          { id: 1 },
          { toJSON: () => undefined },
          null,
          undefined
        ]]
      }
    };
    adapter.read = vi.fn(() => workbook);
    const importCsv = vi.fn(() => true);
    const parseValue = vi.fn((params: { value: string }) => params.value);
    const api = { importCsv } as unknown as GridApi;
    await expect(importGridFromXlsx(api, adapter, new Uint8Array(), {
      sheet: 1,
      separator: ";",
      mode: "replace",
      headerRowIndex: 2,
      coerceNumbers: false,
      parseValue,
      readOptions: { type: "array" }
    })).resolves.toBe(true);
    expect(adapter.read).toHaveBeenCalledWith(expect.any(Uint8Array), { type: "array" });
    expect(importCsv).toHaveBeenCalledWith(
      `plain;"a,""b""";"semi;colon";12;true;3;symbol;;${namedCell.name};"{""id"":1}";;;`,
      { separator: ";", mode: "replace", headerRowIndex: 2, coerceNumbers: false, parseValue }
    );
  });

  it("validates import capabilities and worksheet selection", async () => {
    const api = { importCsv: vi.fn() } as unknown as GridApi;
    const missingReader = engine();
    delete missingReader.read;
    await expect(importGridFromXlsx(api, missingReader, {})).rejects.toThrow(
      "XLSX import requires engine.read and utils.sheet_to_json"
    );

    const adapter = engine();
    const workbook = { SheetNames: ["Data"], Sheets: { Data: [] } };
    await expect(importGridFromXlsx(api, adapter, workbook, { sheet: "Missing" })).rejects.toThrow(
      "Worksheet not found: Missing"
    );

    adapter.read = () => null as unknown as ReturnType<NonNullable<XlsxEngine["read"]>>;
    await expect(importGridFromXlsx(api, adapter, workbook)).rejects.toThrow("invalid workbook");
    adapter.read = (data) => data as ReturnType<NonNullable<XlsxEngine["read"]>>;
    adapter.utils.sheet_to_json = () => null as unknown as unknown[][];
    await expect(importGridFromXlsx(api, adapter, workbook)).rejects.toThrow("array of rows");
    adapter.utils.sheet_to_json = () => [];
    await expect(importGridFromXlsx(api, adapter, workbook, { separator: "\n" })).rejects.toThrow(
      "single non-quote separator"
    );

    const extension = createXlsxExtension(adapter);
    await expect(extension.import(api, workbook)).resolves.toBeUndefined();
    expect(api.importCsv).toHaveBeenCalledWith("", {});
  });
});
