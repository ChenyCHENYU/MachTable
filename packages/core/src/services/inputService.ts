import type { GridCore } from "../core/gridCore";
import type { RowNode } from "../types/row";
import type { Column } from "./column";
import type { RowEditValidationResult } from "../types/options";

type InputContext = Pick<GridCore<any>,
  | "bodyRenderer" | "columnModel" | "editingService" | "api" | "readCellValue"
  | "isDisposed" | "notifyCellValueChanged" | "gridOptions" | "reportError" | "rowModel"
  | "statusBarService" | "summaryRenderer" | "undoService" | "writeValue"
>;

export interface InputChange {
  node: RowNode<any>;
  column: Column;
  oldValue: any;
  newValue: any;
}

export interface InputError { colId: string; message: string }
export interface ValidatedInputRow { changes: readonly InputChange[]; current: () => boolean }
export interface InputRowResult { applied: boolean; errors: InputError[] }
type MaybeAsync<T> = T | Promise<T>;

/** Preserve synchronous input when every configured validator is synchronous. */
export function isPromise<T>(value: MaybeAsync<T>): value is Promise<T> {
  return value != null && typeof (value as Promise<T>).then === "function";
}

/** @internal One validation and commit boundary for editor, clipboard, clear and fill input. */
export class InputService {
  private generation = 0;

  constructor(private core: InputContext) {}

  cancelPending(): void { this.generation++; }

  /** Begins one user intent, also invalidating clipboard reads and older validations. */
  beginIntent(): () => boolean {
    const generation = ++this.generation;
    return () => generation === this.generation && !this.core.isDisposed();
  }

  /** Reject late validation when rows/columns, data or observed values have changed. */
  guardChanges(changes: readonly InputChange[]): () => boolean {
    const node = changes[0].node;
    const columns = this.core.columnModel.getColumns();
    const values = columns.map((column) => this.core.readCellValue(node, column));
    const scope = this.captureScope(changes);
    const unchanged = changes.every((change) =>
      Object.is(this.core.readCellValue(node, change.column), change.oldValue));
    return () => unchanged && scope() && columns.every((column, index) =>
      Object.is(this.core.readCellValue(node, column), values[index]));
  }

  /** Array identity changes when columns are rebuilt/moved; each subsequent check is O(1). */
  captureScope(changes: readonly InputChange[]): () => boolean {
    const node = changes[0].node;
    const data = node.data;
    const columns = this.core.columnModel.getColumns();
    const members = new Set(columns);
    const valid = changes.every((change) => change.node === node && members.has(change.column));
    return () => valid && !this.core.isDisposed() && this.core.rowModel.getNodeById(node.id) === node
      && node.data === data && this.core.columnModel.getColumns() === columns;
  }

  validateChanges(changes: readonly InputChange[], current: () => boolean): MaybeAsync<InputError[]> {
    const results = changes.map((change) => this.validateCell(change, current));
    const finish = (errors: Array<InputError | null>): MaybeAsync<InputError[]> => {
      const invalid = errors.filter((error): error is InputError => error != null);
      if (invalid.length || !current()) return invalid;
      return this.validateRow(changes, current);
    };
    return results.some(isPromise) ? Promise.all(results.map((result) => Promise.resolve(result))).then(finish) : finish(results as Array<InputError | null>);
  }

  private validateCell(change: InputChange, current: () => boolean): MaybeAsync<InputError | null> {
    const { node, column, oldValue, newValue } = change;
    const fail = (error: unknown): InputError => {
      if (current()) this.core.reportError(error, "validate", { colId: column.id, rowId: node.id });
      return { colId: column.id, message: "Validation failed" };
    };
    const resultError = (result: unknown): InputError | null => typeof result === "string"
      ? { colId: column.id, message: result } : null;
    try {
      const result = column.colDef.validate?.(newValue, {
        oldValue, newValue, node, data: node.data!, column, colDef: column.colDef, api: this.core.api
      });
      return isPromise(result) ? result.then(resultError, fail) : resultError(result);
    } catch (error) { return fail(error); }
  }

  private validateRow(changes: readonly InputChange[], current: () => boolean): MaybeAsync<InputError[]> {
    const validator = this.core.gridOptions.rowEditValidator;
    if (!validator) return [];
    const node = changes[0].node;
    const values: Record<string, unknown> = Object.create(null);
    for (const column of this.core.columnModel.getColumns()) values[column.id] = this.core.readCellValue(node, column);
    for (const change of changes) values[change.column.id] = change.newValue;
    const errors = (result: RowEditValidationResult): InputError[] => {
      if (typeof result === "string") return [{ colId: changes[0].column.id, message: result }];
      return result && typeof result === "object"
        ? Object.entries(result).filter(([, message]) => typeof message === "string" && message)
          .map(([colId, message]) => ({ colId, message })) : [];
    };
    const fail = (error: unknown): InputError[] => {
      if (current()) this.core.reportError(error, "validate", { rowId: node.id });
      return [{ colId: changes[0].column.id, message: "Row validation failed" }];
    };
    try {
      const result = validator({ data: node.data!, node, values, api: this.core.api,
        changes: changes.map(({ column, oldValue, newValue }) => ({ colId: column.id, oldValue, newValue })) });
      return isPromise(result) ? result.then(errors, fail) : errors(result);
    } catch (error) { return fail(error); }
  }

  /** Writes a row before publishing events; rejected setters roll back already written values. */
  commitChanges(changes: readonly InputChange[], current: () => boolean): InputError | null {
    const applied: InputChange[] = [];
    const scope = this.captureScope(changes);
    for (const change of changes) {
      if (!current() || !scope()
        || !Object.is(this.core.readCellValue(change.node, change.column), change.oldValue)
        || !this.core.editingService.isEditable(change.node, change.column)
        || !this.core.writeValue(change.node, change.column, change.newValue, change.oldValue)) {
        for (const previous of applied.reverse()) {
          // Arbitrary setter side effects cannot be undone after the row is replaced or destroyed.
          if (!current() || !scope()) break;
          if (!this.core.writeValue(previous.node, previous.column, previous.oldValue, previous.newValue)) {
            this.core.reportError(new Error("A valueSetter rejected input rollback"), "inputRollback", { rowId: previous.node.id });
          }
        }
        return { colId: change.column.id, message: "Value was rejected by the column setter" };
      }
      applied.push(change);
    }
    return current() && scope()
      ? null : { colId: changes[0].column.id, message: "Input target changed during commit" };
  }

  /** Validation failures reject that row; other valid rows form one undoable operation. */
  applyChanges(input: readonly InputChange[]): void {
    const active = this.beginIntent();
    if (this.core.isDisposed() || this.core.editingService.isEditing()) return;
    const grouped = new Map<RowNode<any>, InputChange[]>();
    for (const change of input) {
      if (change.newValue === undefined || Object.is(change.oldValue, change.newValue)
        || !this.core.editingService.isEditable(change.node, change.column)) continue;
      const changes = grouped.get(change.node) ?? [];
      changes.push(change);
      grouped.set(change.node, changes);
    }
    const rows = [...grouped.values()].map((changes) => {
      const guard = this.guardChanges(changes);
      const current = () => active() && guard();
      return { changes, current, validation: this.validateChanges(changes, current) };
    });
    const finish = (validations: InputError[][]): void => { this.commitValidatedRows(rows, validations, active); };
    const validations = rows.map((row) => row.validation);
    if (validations.some(isPromise)) void Promise.all(validations.map((result) => Promise.resolve(result))).then(finish);
    else finish(validations as InputError[][]);
  }

  /** Optional import plans reuse the same setters, events and undo boundary after preview validation. */
  commitValidatedRows(rows: readonly ValidatedInputRow[], validations: readonly InputError[][], active: () => boolean): InputRowResult[] {
    const results = rows.map((): InputRowResult => ({ applied: false, errors: [] }));
    if (!active()) return results;
    const changedRows = new Set<number>();
    this.core.undoService.beginBatch();
    try {
      rows.forEach(({ changes, current }, index) => {
        const result = results[index];
        if (!current() || !changes.length) return;
        result.errors = [...validations[index]];
        const failure = result.errors.length ? null : this.commitChanges(changes, active);
        if (!active()) return;
        if (failure) result.errors.push(failure);
        if (result.errors.length) {
          this.core.reportError(new Error(result.errors.map(error => error.message).join("; ")), "validate", { rowId: changes[0].node.id, errors: result.errors });
          return;
        }
        const scope = this.captureScope(changes);
        result.applied = true;
        for (const change of changes) {
          if (!active() || !scope()) { result.applied = false; break; }
          this.core.notifyCellValueChanged(change.node, change.column, change.oldValue, change.newValue);
          if (change.node.rowIndex >= 0) changedRows.add(change.node.rowIndex);
        }
      });
    } finally { this.core.undoService.endBatch(); }
    if (changedRows.size && active()) {
      this.core.bodyRenderer.refreshRows([...changedRows]);
      this.core.summaryRenderer.refresh();
      this.core.statusBarService.refresh();
    }
    return results;
  }
}
