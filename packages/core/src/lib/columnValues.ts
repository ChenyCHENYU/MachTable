import type { GridCore } from "../core/gridCore";
import type { Column } from "../services/column";
import type { RowNode } from "../types/row";
import type { ValueInputSource, ValueOutputTarget } from "../types/colDef";
import { formatCellValueWith } from "../render/cellContent";

type Context = Pick<GridCore<any>, "api" | "readCellValue" | "reportError">;

export function parseColumnValue(core: Context, node: RowNode, column: Column, value: unknown, source: ValueInputSource, oldValue?: unknown): any {
  const parser = column.colDef.valueParser;
  if (!parser) return value;
  const parsed = parser({ api: core.api, colDef: column.colDef, column, data: node.data, node, value, oldValue, source });
  if (parsed != null && typeof parsed.then === "function") throw new TypeError("valueParser must return a synchronous value");
  return parsed;
}

export function serializeColumnValue(core: Context, node: RowNode, column: Column, target: ValueOutputTarget): unknown {
  const value = core.readCellValue(node, column);
  const serializer = column.colDef.valueSerializer;
  if (serializer) {
    try {
      const output = serializer({ api: core.api, colDef: column.colDef, column, data: node.data, node, value, target });
      if (output != null && typeof (output as Promise<unknown>).then === "function") throw new TypeError("valueSerializer must return a synchronous value");
      return output;
    }
    catch (error) { core.reportError(error, "valueSerializer", { colId: column.id, rowId: node.id }); throw error; }
  }
  return target === "xlsx" || target === "csv" && typeof value === "number" ? value : formatCellValueWith(core, node, column, value);
}
