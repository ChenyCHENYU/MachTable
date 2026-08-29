import type { GridCore } from "../core/gridCore";
import type { Column } from "./column";
import type { RowNode } from "../types/row";
import type { ICellEditor } from "../types/params";
import { createEditor } from "./editors";
import { cleanupCellContent } from "../render/cellContent";

type EditingContext = Pick<
  GridCore<any>,
  | "bodyRenderer"
  | "columnModel"
  | "emit"
  | "getApi"
  | "getCellValue"
  | "keyboardService"
  | "notifyCellValueChanged"
  | "options"
  | "reportError"
  | "resolveCellEditor"
  | "rowModel"
  | "setCellValue"
  | "statusBarService"
  | "summaryRenderer"
  | "undoService"
  | "writeValue"
>;

interface MountedEditor {
  editor: ICellEditor;
  cell: HTMLElement;
  shell: HTMLElement;
  keydown: (event: KeyboardEvent) => void;
  input?: (event: Event) => void;
}

interface CellEditingState extends MountedEditor {
  node: RowNode<any>;
  column: Column;
  rowIndex: number;
  oldValue: any;
  confirmButton: HTMLButtonElement;
  cancelButton: HTMLButtonElement;
}

interface RowDraft {
  column: Column;
  oldValue: any;
  value: any;
  mounted: MountedEditor | null;
  error?: string;
}

interface RowEditingState {
  node: RowNode<any>;
  rowIndex: number;
  drafts: Map<string, RowDraft>;
  validating: boolean;
}

const CHECK_PATH = '<path d="M3 8.5 6.4 12 13.5 4"/>';
const CLOSE_PATH = '<path d="m4 4 8 8m0-8-8 8"/>';

function createEditButton(kind: "confirm" | "cancel", label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `mach-edit-control mach-edit-control--${kind}`;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${kind === "confirm" ? CHECK_PATH : CLOSE_PATH}</svg>`;
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  return button;
}

export class EditingService {
  private cellEditing: CellEditingState | null = null;
  private rowEditing: RowEditingState | null = null;
  private stopPromise: Promise<boolean> | null = null;
  private stopToken = 0;

  constructor(private core: EditingContext) {}

  isEditing(rowIndex?: number, colId?: string): boolean {
    if (this.cellEditing) {
      if (rowIndex == null && colId == null) return true;
      return this.cellEditing.rowIndex === rowIndex && this.cellEditing.column.id === colId;
    }
    if (!this.rowEditing) return false;
    if (rowIndex == null && colId == null) return true;
    if (this.currentRowIndex(this.rowEditing) !== rowIndex) return false;
    return colId == null || this.rowEditing.drafts.has(colId);
  }

  isCellEditing(): boolean {
    return this.cellEditing != null;
  }

  isRowEditing(rowIndex?: number): boolean {
    if (!this.rowEditing) return false;
    return rowIndex == null || this.currentRowIndex(this.rowEditing) === rowIndex;
  }

  isEditable(node: RowNode<any>, column: Column): boolean {
    if (node.isDetail || node.isGroup || node.data == null) return false;
    const editable = column.colDef.editable;
    if (!editable) return false;
    if (typeof editable === "function") {
      try {
        return editable({
          api: this.core.getApi(),
          colDef: column.colDef,
          column,
          node,
          data: node.data,
          value: this.core.getCellValue(node, column),
          rowIndex: node.rowIndex
        });
      } catch (error) {
        this.core.reportError(error, "editable", { colId: column.id, rowId: node.id });
        return false;
      }
    }
    return true;
  }

  start(rowIndex: number, column: Column, keyPress?: string | null): boolean {
    if (this.core.options.editType === "fullRow") return this.startRow(rowIndex, column.id);
    if (this.cellEditing || this.rowEditing) return false;
    const node = this.core.rowModel.getDisplayedRow(rowIndex);
    if (!node || node.data == null || !this.isEditable(node, column)) return false;
    const cell = this.core.bodyRenderer.getCellElement(rowIndex, column.id);
    if (!cell) return false;

    const oldValue = this.core.getCellValue(node, column);
    const editor = this.createCellEditor(node, column, rowIndex, oldValue, keyPress);
    if (!editor) return false;

    cleanupCellContent(this.core, cell);
    const shell = document.createElement("div");
    shell.className = "mach-cell-editor-shell";
    const controls = document.createElement("div");
    controls.className = "mach-cell-editor-controls";
    const confirmButton = createEditButton("confirm", "Confirm edit");
    const cancelButton = createEditButton("cancel", "Cancel edit");
    controls.append(confirmButton, cancelButton);
    shell.append(editor.el, controls);
    cell.replaceChildren(shell);
    cell.classList.add("mach-cell--editing");
    cell.removeAttribute("title");

    const keydown = this.onCellEditorKeyDown;
    editor.el.addEventListener("keydown", keydown);
    editor.el.addEventListener("focusout", this.onCellEditorBlur);
    confirmButton.addEventListener("click", (event) => {
      event.stopPropagation();
      void this.stopAsync(false);
    });
    cancelButton.addEventListener("click", (event) => {
      event.stopPropagation();
      void this.stopAsync(true);
    });

    this.cellEditing = {
      node,
      column,
      editor,
      rowIndex,
      oldValue,
      cell,
      shell,
      keydown,
      confirmButton,
      cancelButton
    };
    this.focusEditor(editor, column, node);
    this.core.emit("cellEditingStarted", { rowIndex, colId: column.id, rowNode: node });
    return true;
  }

  startRow(rowIndex: number, preferredColId?: string): boolean {
    if (this.cellEditing || this.rowEditing) return false;
    const node = this.core.rowModel.getDisplayedRow(rowIndex);
    if (!node || node.data == null || node.isDetail || node.isGroup) return false;

    const drafts = new Map<string, RowDraft>();
    for (const column of this.core.columnModel.getOrderedVisible()) {
      if (!this.isEditable(node, column)) continue;
      const oldValue = this.core.getCellValue(node, column);
      drafts.set(column.id, { column, oldValue, value: oldValue, mounted: null });
    }
    if (drafts.size === 0) return false;

    const row: RowEditingState = { node, rowIndex, drafts, validating: false };
    this.rowEditing = row;
    this.core.bodyRenderer.refreshRows([rowIndex]);
    if (drafts.size === 0) {
      this.rowEditing = null;
      this.core.bodyRenderer.refreshRows([rowIndex]);
      return false;
    }
    const first = drafts.values().next().value as RowDraft | undefined;
    const target = (preferredColId ? drafts.get(preferredColId) : undefined) ?? first;
    if (target?.mounted) this.focusEditor(target.mounted.editor, target.column, node);
    this.core.emit("rowEditingStarted", { rowIndex, rowNode: node, data: node.data });
    return true;
  }

  /** Called by BodyRenderer so row editors survive horizontal/vertical virtualization. */
  renderEditor(rowIndex: number, node: RowNode<any>, column: Column, cell: HTMLElement): boolean {
    if (this.cellEditing) return this.cellEditing.node === node && this.cellEditing.column.id === column.id;
    const row = this.rowEditing;
    if (!row || row.node !== node) return false;
    const draft = row.drafts.get(column.id);
    if (!draft) return false;
    if (draft.mounted?.cell !== cell) {
      if (draft.mounted) this.unmountRowDraft(draft);
      if (!this.mountRowDraft(rowIndex, row, draft, cell)) {
        row.drafts.delete(column.id);
        return false;
      }
    }
    return true;
  }

  /** Captures a staged value before a pooled/virtual cell is reused. */
  releaseCell(rowIndex: number, colId: string, cell: HTMLElement): void {
    const row = this.rowEditing;
    if (row && this.currentRowIndex(row) === rowIndex) {
      const draft = row.drafts.get(colId);
      if (draft?.mounted?.cell === cell) this.unmountRowDraft(draft);
      return;
    }
    if (this.cellEditing?.cell === cell) {
      const editing = this.cellEditing;
      void this.stopAsync(false);
      // A pooled cell cannot safely retain an editor while async validation is pending.
      // Synchronous commits have already completed; pending editors are cancelled cleanly.
      if (this.cellEditing === editing) void this.stopAsync(true);
    }
  }

  stop(cancel = false): void {
    void this.stopAsync(cancel);
  }

  stopAsync(cancel = false): Promise<boolean> {
    if (this.rowEditing) return this.stopRowAsync(cancel);
    const editing = this.cellEditing;
    if (!editing) return Promise.resolve(false);
    if (cancel) {
      this.stopToken++;
      this.stopPromise = null;
      return Promise.resolve(this.finishCellStop(editing, true, editing.oldValue));
    }
    if (this.stopPromise) return this.stopPromise;

    let newValue: any;
    try {
      newValue = editing.editor.getValue();
    } catch (error) {
      this.core.reportError(error, "cellEditor.getValue", { colId: editing.column.id, rowId: editing.node.id });
      return Promise.resolve(this.finishCellStop(editing, true, editing.oldValue));
    }
    try {
      if (editing.editor.isCancelAfterEnd?.(newValue)) {
        return Promise.resolve(this.finishCellStop(editing, true, editing.oldValue));
      }
    } catch (error) {
      this.core.reportError(error, "cellEditor.isCancelAfterEnd", { colId: editing.column.id, rowId: editing.node.id });
      return Promise.resolve(this.finishCellStop(editing, true, editing.oldValue));
    }

    const validation = this.validateValue(editing.node, editing.column, editing.oldValue, newValue);
    if (validation && typeof (validation as Promise<unknown>).then === "function") {
      const token = ++this.stopToken;
      this.setCellBusy(editing, true);
      const task = Promise.resolve(validation)
        .then((result) => {
          if (token !== this.stopToken || this.cellEditing !== editing) return false;
          if (typeof result === "string") {
            this.showError(editing.editor, result);
            return false;
          }
          return this.finishCellStop(editing, false, newValue);
        })
        .catch((error) => {
          if (token !== this.stopToken || this.cellEditing !== editing) return false;
          this.core.reportError(error, "validate", { colId: editing.column.id, rowId: editing.node.id });
          this.showError(editing.editor, "Validation failed");
          return false;
        })
        .finally(() => {
          if (this.stopPromise === task) this.stopPromise = null;
        });
      this.stopPromise = task;
      return task;
    }
    if (typeof validation === "string") {
      this.showError(editing.editor, validation);
      return Promise.resolve(false);
    }
    return Promise.resolve(this.finishCellStop(editing, false, newValue));
  }

  stopRowAsync(cancel = false): Promise<boolean> {
    const row = this.rowEditing;
    if (!row) return Promise.resolve(false);
    if (cancel) {
      this.stopToken++;
      this.stopPromise = null;
      return Promise.resolve(this.finishRowStop(row, true));
    }
    if (this.stopPromise) return this.stopPromise;

    for (const draft of row.drafts.values()) this.captureRowDraft(draft);
    const changed = [...row.drafts.values()].filter((draft) => !Object.is(draft.oldValue, draft.value));
    if (changed.length === 0) return Promise.resolve(this.finishRowStop(row, false));

    const token = ++this.stopToken;
    for (const draft of changed) draft.error = undefined;
    row.validating = true;
    this.setRowBusy(row, true);
    const task = Promise.all(
      changed.map(async (draft) => {
        try {
          const result = await this.validateValue(row.node, draft.column, draft.oldValue, draft.value);
          return { draft, message: typeof result === "string" ? result : null };
        } catch (error) {
          this.core.reportError(error, "validate", { colId: draft.column.id, rowId: row.node.id });
          return { draft, message: "Validation failed" };
        }
      })
    )
      .then(async (results) => {
        if (token !== this.stopToken || this.rowEditing !== row) return false;
        const invalid = results.filter((result) => result.message != null);
        if (invalid.length > 0) {
          this.showRowErrors(row, invalid.map((result) => ({ draft: result.draft, message: result.message! })));
          return false;
        }
        const rowErrors = await this.validateRowDraft(row, changed);
        if (token !== this.stopToken || this.rowEditing !== row) return false;
        if (rowErrors.length > 0) {
          this.showRowErrors(row, rowErrors);
          return false;
        }
        return this.finishRowStop(row, false);
      })
      .finally(() => {
        if (this.stopPromise === task) this.stopPromise = null;
      });
    this.stopPromise = task;
    return task;
  }

  private finishCellStop(editing: CellEditingState, cancel: boolean, newValue: any): boolean {
    if (this.cellEditing !== editing) return false;
    this.cellEditing = null;
    const changed = !cancel && this.applyValue(editing.node, editing.column, editing.oldValue, newValue);
    this.destroyMountedEditor(editing, true);

    this.core.emit("cellEditingStopped", {
      rowIndex: editing.rowIndex,
      colId: editing.column.id,
      rowNode: editing.node,
      oldValue: editing.oldValue,
      newValue: changed ? newValue : editing.oldValue
    });
    if (editing.node.rowIndex >= 0) this.core.bodyRenderer.refreshRows([editing.node.rowIndex]);
    this.core.summaryRenderer.refresh();
    this.core.statusBarService.refresh();
    return true;
  }

  private finishRowStop(row: RowEditingState, cancelled: boolean): boolean {
    if (this.rowEditing !== row) return false;
    const changes = cancelled ? [] : this.commitRowDrafts(row);
    if (changes == null) return false;
    for (const draft of row.drafts.values()) {
      if (!cancelled) this.captureRowDraft(draft);
      if (draft.mounted) this.destroyMountedEditor(draft.mounted, true);
      draft.mounted = null;
    }
    this.rowEditing = null;

    const rowIndex = this.currentRowIndex(row);
    this.core.emit("rowEditingStopped", {
      rowIndex,
      rowNode: row.node,
      data: row.node.data!,
      cancelled,
      changes
    });
    if (rowIndex >= 0) this.core.bodyRenderer.refreshRows([rowIndex]);
    this.core.summaryRenderer.refresh();
    this.core.statusBarService.refresh();
    return true;
  }

  private commitRowDrafts(
    row: RowEditingState
  ): Array<{ colId: string; oldValue: unknown; newValue: unknown }> | null {
    const changed = [...row.drafts.values()].filter((draft) => !Object.is(draft.oldValue, draft.value));
    if (changed.length === 0) return [];
    const applied: RowDraft[] = [];
    this.core.undoService.beginBatch();
    for (const draft of changed) {
      if (!this.core.writeValue(row.node, draft.column, draft.value, draft.oldValue)) {
        let rollbackFailed = false;
        for (const previous of [...applied].reverse()) {
          if (!this.core.writeValue(row.node, previous.column, previous.oldValue, previous.value)) rollbackFailed = true;
        }
        this.core.undoService.cancelBatch();
        if (rollbackFailed) {
          this.core.reportError(new Error("A valueSetter rejected full-row rollback"), "rowEditRollback", {
            rowId: row.node.id,
            colId: draft.column.id
          });
        }
        this.showRowErrors(row, [{ draft, message: "Value was rejected by the column setter" }]);
        return null;
      }
      applied.push(draft);
    }
    for (const draft of applied) {
      this.core.notifyCellValueChanged(row.node, draft.column, draft.oldValue, draft.value);
    }
    this.core.undoService.endBatch();
    return applied.map((draft) => ({
      colId: draft.column.id,
      oldValue: draft.oldValue,
      newValue: draft.value
    }));
  }

  private mountRowDraft(rowIndex: number, row: RowEditingState, draft: RowDraft, cell: HTMLElement): boolean {
    const editor = this.createCellEditor(row.node, draft.column, rowIndex, draft.value, null);
    if (!editor) return false;
    cleanupCellContent(this.core, cell);
    const shell = document.createElement("div");
    shell.className = "mach-row-editor-shell";
    shell.appendChild(editor.el);
    cell.replaceChildren(shell);
    cell.classList.add("mach-cell--editing", "mach-cell--row-editing");
    cell.removeAttribute("title");

    const keydown = (event: KeyboardEvent) => this.onRowEditorKeyDown(event, row, draft);
    const input = () => {
      try {
        draft.value = editor.getValue();
        draft.error = undefined;
      } catch {
        // getValue is retried at commit and reported with column context there.
      }
    };
    editor.el.addEventListener("keydown", keydown);
    editor.el.addEventListener("input", input);
    draft.mounted = { editor, cell, shell, keydown, input };
    if (draft.error) this.showError(editor, draft.error);
    if (row.validating) {
      editor.el.classList.add("mach-editor-validating");
      editor.el.setAttribute("aria-busy", "true");
      editor.el.inert = true;
    }
    return true;
  }

  private unmountRowDraft(draft: RowDraft): void {
    if (!draft.mounted) return;
    this.captureRowDraft(draft);
    this.destroyMountedEditor(draft.mounted, true);
    draft.mounted = null;
  }

  private captureRowDraft(draft: RowDraft): void {
    if (!draft.mounted) return;
    try {
      const next = draft.mounted.editor.getValue();
      if (next !== undefined) draft.value = next;
    } catch (error) {
      this.core.reportError(error, "cellEditor.getValue", {
        colId: draft.column.id,
        rowId: this.rowEditing?.node.id
      });
    }
  }

  private createCellEditor(
    node: RowNode<any>,
    column: Column,
    rowIndex: number,
    value: any,
    keyPress?: string | null
  ): ICellEditor | null {
    const def = column.colDef;
    let editor: ICellEditor;
    try {
      const params = {
        api: this.core.getApi(),
        colDef: def,
        column,
        node,
        data: node.data,
        value,
        rowIndex,
        keyPress
      };
      if (typeof def.cellEditor === "function") {
        editor = def.cellEditor(params);
      } else if (typeof def.cellEditor === "string" && !["text", "number", "date", "select"].includes(def.cellEditor)) {
        editor = this.core.resolveCellEditor(def.cellEditor)?.(params) ?? createEditor(column, value, keyPress);
      } else {
        editor = createEditor(column, value, keyPress);
      }
    } catch (error) {
      this.core.reportError(error, "cellEditor", { colId: column.id, rowId: node.id });
      return null;
    }
    if (!editor || !(editor.el instanceof HTMLElement)) {
      this.core.reportError(new Error("cellEditor must return an editor with an HTMLElement el"), "cellEditor", {
        colId: column.id,
        rowId: node.id
      });
      return null;
    }
    try {
      if (editor.isCancelBeforeStart?.()) {
        editor.destroy?.();
        return null;
      }
    } catch (error) {
      this.core.reportError(error, "cellEditor.isCancelBeforeStart", { colId: column.id, rowId: node.id });
      try { editor.destroy?.(); } catch { void 0; }
      return null;
    }
    return editor;
  }

  private validateValue(
    node: RowNode<any>,
    column: Column,
    oldValue: any,
    newValue: any
  ): string | true | null | undefined | Promise<string | true | null | undefined> {
    const validate = column.colDef.validate;
    if (!validate) return true;
    try {
      return validate(newValue, {
        oldValue,
        newValue,
        data: node.data!,
        node,
        colDef: column.colDef,
        column,
        api: this.core.getApi()
      });
    } catch (error) {
      this.core.reportError(error, "validate", { colId: column.id, rowId: node.id });
      return "Validation failed";
    }
  }

  private async validateRowDraft(
    row: RowEditingState,
    changed: RowDraft[]
  ): Promise<Array<{ draft: RowDraft; message: string }>> {
    const validator = this.core.options.rowEditValidator;
    if (!validator) return [];
    const values: Record<string, unknown> = Object.create(null);
    for (const [colId, draft] of row.drafts) values[colId] = draft.value;
    const changes = changed.map((draft) => ({
      colId: draft.column.id,
      oldValue: draft.oldValue,
      newValue: draft.value
    }));
    let result: import("../types/options").RowEditValidationResult;
    try {
      result = await validator({ data: row.node.data!, node: row.node, values, changes, api: this.core.getApi() });
    } catch (error) {
      this.core.reportError(error, "rowEditValidator", { rowId: row.node.id });
      return [{ draft: changed[0], message: "Row validation failed" }];
    }
    if (typeof result === "string") return [{ draft: changed[0], message: result }];
    if (!result || result === true || typeof result !== "object") return [];
    const errors: Array<{ draft: RowDraft; message: string }> = [];
    for (const [colId, message] of Object.entries(result)) {
      const draft = row.drafts.get(colId);
      if (draft && typeof message === "string" && message) errors.push({ draft, message });
    }
    if (errors.length === 0) {
      const firstMessage = Object.values(result).find((message) => typeof message === "string" && message);
      if (typeof firstMessage === "string") errors.push({ draft: changed[0], message: firstMessage });
    }
    return errors;
  }

  private showRowErrors(row: RowEditingState, errors: Array<{ draft: RowDraft; message: string }>): void {
    row.validating = false;
    this.setRowBusy(row, false);
    for (const { draft, message } of errors) {
      draft.error = message;
      if (draft.mounted) this.showError(draft.mounted.editor, message);
    }
    errors[0].draft.mounted?.editor.focus?.();
  }

  private showError(editor: ICellEditor, message: string): void {
    const editorEl = editor.el as HTMLElement;
    editorEl.classList.add("mach-editor-invalid");
    editorEl.setAttribute("title", message);
    editorEl.setAttribute("aria-invalid", "true");
    editorEl.classList.remove("mach-editor-validating");
    editorEl.removeAttribute("aria-busy");
    editorEl.inert = false;
    const input = editorEl.querySelector("input, select, textarea") ?? editorEl;
    (input as HTMLElement).focus?.();
    const clear = () => {
      editorEl.classList.remove("mach-editor-invalid");
      editorEl.removeAttribute("title");
      editorEl.removeAttribute("aria-invalid");
    };
    editorEl.addEventListener("input", clear, { once: true });
  }

  private setCellBusy(editing: CellEditingState, busy: boolean): void {
    editing.editor.el.classList.toggle("mach-editor-validating", busy);
    if (busy) editing.editor.el.setAttribute("aria-busy", "true");
    else editing.editor.el.removeAttribute("aria-busy");
    editing.editor.el.inert = busy;
    editing.confirmButton.disabled = busy;
    editing.cancelButton.disabled = false;
    editing.shell.classList.toggle("mach-editor-shell--busy", busy);
  }

  private setRowBusy(row: RowEditingState, busy: boolean): void {
    for (const draft of row.drafts.values()) {
      const editorEl = draft.mounted?.editor.el;
      if (!editorEl) continue;
      editorEl.classList.toggle("mach-editor-validating", busy);
      if (busy) editorEl.setAttribute("aria-busy", "true");
      else editorEl.removeAttribute("aria-busy");
      editorEl.inert = busy;
    }
  }

  private applyValue(node: RowNode<any>, column: Column, oldValue: any, newValue: any): boolean {
    if (newValue === undefined) return false;
    return this.core.setCellValue(node, column, newValue, oldValue);
  }

  private focusEditor(editor: ICellEditor, column: Column, node: RowNode<any>): void {
    try {
      editor.focus?.();
    } catch (error) {
      this.core.reportError(error, "cellEditor.focus", { colId: column.id, rowId: node.id });
    }
  }

  private destroyMountedEditor(mounted: MountedEditor, removeCellState: boolean): void {
    mounted.editor.el.removeEventListener("keydown", mounted.keydown);
    if (mounted.input) mounted.editor.el.removeEventListener("input", mounted.input);
    mounted.editor.el.removeEventListener("focusout", this.onCellEditorBlur);
    mounted.editor.el.classList.remove("mach-editor-validating");
    mounted.editor.el.removeAttribute("aria-busy");
    mounted.editor.el.inert = false;
    try {
      mounted.editor.destroy?.();
    } catch (error) {
      this.core.reportError(error, "cellEditor.destroy", { colId: mounted.cell.dataset.colId });
    }
    if (removeCellState) mounted.cell.classList.remove("mach-cell--editing", "mach-cell--row-editing", "mach-cell--error");
  }

  private currentRowIndex(row: RowEditingState): number {
    return row.node.rowIndex >= 0 ? row.node.rowIndex : row.rowIndex;
  }

  private onCellEditorKeyDown = (event: KeyboardEvent): void => {
    if (!this.cellEditing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      void this.stopAsync(false);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      void this.stopAsync(true);
    } else if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      const current = this.cellEditing;
      const next = this.core.keyboardService.nextEditable(current.rowIndex, current.column.id, event.shiftKey ? -1 : 1);
      void this.stopAsync(false).then((stopped) => {
        if (stopped && next) {
          this.core.bodyRenderer.scrollToIndex(next.rowIndex, "nearest");
          this.core.bodyRenderer.setFocusedCell(next.rowIndex, next.column.id);
          this.start(next.rowIndex, next.column);
        }
      });
    }
  };

  private onRowEditorKeyDown(event: KeyboardEvent, row: RowEditingState, draft: RowDraft): void {
    if (this.rowEditing !== row) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      void this.stopRowAsync(true);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      void this.stopRowAsync(false);
      return;
    }
    if (event.key !== "Tab") return;
    event.preventDefault();
    event.stopPropagation();
    this.captureRowDraft(draft);
    const drafts = [...row.drafts.values()];
    const currentIndex = drafts.indexOf(draft);
    const direction = event.shiftKey ? -1 : 1;
    for (let offset = 1; offset <= drafts.length; offset++) {
      const next = drafts[(currentIndex + direction * offset + drafts.length) % drafts.length];
      if (!next.mounted) continue;
      this.focusEditor(next.mounted.editor, next.column, row.node);
      break;
    }
  }

  private onCellEditorBlur = (): void => {
    window.setTimeout(() => {
      if (this.cellEditing) void this.stopAsync(false);
    }, 0);
  };

  destroy(): void {
    if (this.cellEditing || this.rowEditing) void this.stopAsync(true);
  }
}
