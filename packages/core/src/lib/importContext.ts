import type { GridCore } from "../core/gridCore";
import type { GridApi } from "../types/api";
import type { RowNode } from "../types/row";
import type { InputChange, InputError, InputRowResult, ValidatedInputRow } from "../services/inputService";
import type { ImportValueContext } from "./importData";
import { parseColumnValue } from "./columnValues";

/** Only explicit methods cross bundles: internal service properties are independently minified. */
export interface ImportContext extends ImportValueContext {
  begin(): () => boolean;
  revision(): number;
  isEditing(): boolean;
  pasteRows(limit: number): RowNode[];
  resolveId(data: any, index: number): string | undefined;
  validate(changes: readonly InputChange[], current: () => boolean): InputError[] | Promise<InputError[]>;
  guard(changes: readonly InputChange[]): () => boolean;
  commitRows(rows: readonly ValidatedInputRow[], errors: readonly InputError[][], current: () => boolean): InputRowResult[];
}
const key = Symbol.for("mach-table.import.v1");
export function attachImportContext(api: GridApi, core: GridCore<any>): void {
  const context: ImportContext = {
    begin: () => core.inputService.beginIntent(),
    revision: () => core.rowModel.getDataRevision(),
    isEditing: () => core.editingService.isEditing(),
    columns: () => core.columnModel.getColumns(),
    visibleColumns: () => core.columnModel.getOrderedVisible(),
    read: (node, column) => core.readCellValue(node, column),
    editable: (node, column) => core.editingService.isEditable(node, column),
    parse: (node, column, value, oldValue) => parseColumnValue(core, node, column, value, "import", oldValue),
    pasteRows: limit => {
      const targets: RowNode[] = [];
      for (const node of core.rowModel.getDisplayedRows()) {
        if (!node.isGroup && !node.isDetail) targets.push(node);
        if (targets.length >= limit) break;
      }
      return targets;
    },
    resolveId: (data, index) => core.gridOptions.resolveRowId?.({ data, index, api }),
    validate: (changes, current) => core.inputService.validateChanges(changes, current),
    guard: changes => core.inputService.guardChanges(changes),
    commitRows: (rows, errors, current) => core.inputService.commitValidatedRows(rows, errors, current)
  };
  Object.defineProperty(api, key, { value: context });
}
export function getImportContext(api: GridApi): ImportContext {
  const context = (api as GridApi & { [key]?: ImportContext })[key];
  if (!context) throw new TypeError("Import plans require a MachTable GridApi");
  return context;
}

/** Internal adapter boundary shared with lazy typed-file IO. */
export function beginGridInput(api: GridApi): () => boolean {
  return api.isDestroyed() ? () => false : getImportContext(api).begin();
}
