import type { GridCore } from "../core/gridCore";
import type { RowNode } from "../types/row";
import type { Column } from "./column";
import type { RowEditValidationResult } from "../types/options";

type InputContext = Pick<GridCore<any>,
  | "bodyRenderer" | "columnModel" | "editingService" | "getApi" | "getCellValue"
  | "isDestroyed" | "notifyCellValueChanged" | "options" | "reportError" | "rowModel"
  | "statusBarService" | "summaryRenderer" | "undoService" | "writeValue"
>;

export interface InputChange {
  node: RowNode<any>;
  column: Column;
  oldValue: any;
  newValue: any;
}

interface InputError { colId: string; message: string }
type MaybeAsync<T> = T | Promise<T>;

/** Preserve synchronous input when every configured validator is synchronous. */
export function isPromise<T>(value: MaybeAsync<T>): value is Promise<T> {
  return value != null && typeof (value as Promise<T>).then === "function";
}

/** One validation and commit boundary for editor, clipboard, clear and fill input. */
export class InputService {
  private generation = 0;

  constructor(private core: InputContext) {}

  cancel(): void { this.generation++; }

  /** Begins one user intent, also invalidating clipboard reads and older validations. */
  begin(): () => boolean {
    const generation = ++this.generation;
    return () => generation === this.generation && !this.core.isDestroyed();
  }

  /** Reject late validation when rows/columns, data or observed values have changed. */
  guard(changes: readonly InputChange[]): () => boolean {
    const node = changes[0].node;
    const columns = this.core.columnModel.getColumns();
    const values = columns.map((column) => this.core.getCellValue(node, column));
    const scope = this.scope(changes);
    const unchanged = changes.every((change) =>
      Object.is(this.core.getCellValue(node, change.column), change.oldValue));
    return () => unchanged && scope() && columns.every((column, index) =>
      Object.is(this.core.getCellValue(node, column), values[index]));
  }

  /** Array identity changes when columns are rebuilt/moved; each subsequent check is O(1). */
  scope(changes: readonly InputChange[]): () => boolean {
    const node = changes[0].node;
    const data = node.data;
    const columns = this.core.columnModel.getColumns();
    const members = new Set(columns);
    const valid = changes.every((change) => change.node === node && members.has(change.column));
    return () => valid && !this.core.isDestroyed() && this.core.rowModel.getNodeById(node.id) === node
      && node.data === data && this.core.columnModel.getColumns() === columns;
  }

  validate(changes: readonly InputChange[], current: () => boolean): MaybeAsync<InputError[]> {
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
        oldValue, newValue, node, data: node.data!, column, colDef: column.colDef, api: this.core.getApi()
      });
      return isPromise(result) ? result.then(resultError, fail) : resultError(result);
    } catch (error) { return fail(error); }
  }

  private validateRow(changes: readonly InputChange[], current: () => boolean): MaybeAsync<InputError[]> {
    const validator = this.core.options.rowEditValidator;
    if (!validator) return [];
    const node = changes[0].node;
    const values: Record<string, unknown> = Object.create(null);
    for (const column of this.core.columnModel.getColumns()) values[column.id] = this.core.getCellValue(node, column);
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
      const result = validator({ data: node.data!, node, values, api: this.core.getApi(),
        changes: changes.map(({ column, oldValue, newValue }) => ({ colId: column.id, oldValue, newValue })) });
      return isPromise(result) ? result.then(errors, fail) : errors(result);
    } catch (error) { return fail(error); }
  }

  /** Writes a row before publishing events; rejected setters roll back already written values. */
  commit(changes: readonly InputChange[], current: () => boolean): InputError | null {
    const applied: InputChange[] = [];
    const scope = this.scope(changes);
    for (const change of changes) {
      if (!current() || !scope()
        || !Object.is(this.core.getCellValue(change.node, change.column), change.oldValue)
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
  apply(input: readonly InputChange[]): void {
    const active = this.begin();
    if (this.core.isDestroyed() || this.core.editingService.isEditing()) return;
    const grouped = new Map<RowNode<any>, InputChange[]>();
    for (const change of input) {
      if (change.newValue === undefined || Object.is(change.oldValue, change.newValue)
        || !this.core.editingService.isEditable(change.node, change.column)) continue;
      const changes = grouped.get(change.node) ?? [];
      changes.push(change);
      grouped.set(change.node, changes);
    }
    const rows = [...grouped.values()].map((changes) => {
      const guard = this.guard(changes);
      const current = () => active() && guard();
      return { changes, current, validation: this.validate(changes, current) };
    });
    const finish = (validations: InputError[][]): void => {
      if (!active()) return;
      const changedRows = new Set<number>();
      this.core.undoService.beginBatch();
      try {
        rows.forEach(({ changes, current }, index) => {
          if (!current()) return;
          const errors = validations[index];
          const failure = errors.length ? null : this.commit(changes, active);
          if (!active()) return;
          if (failure) errors.push(failure);
          if (errors.length) {
            this.core.reportError(new Error(errors.map((error) => error.message).join("; ")), "validate", {
              rowId: changes[0].node.id, errors
            });
            return;
          }
          const scope = this.scope(changes);
          for (const change of changes) {
            if (!active() || !scope()) break;
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
    };
    const validations = rows.map((row) => row.validation);
    if (validations.some(isPromise)) void Promise.all(validations.map((result) => Promise.resolve(result))).then(finish);
    else finish(validations as InputError[][]);
  }
}
