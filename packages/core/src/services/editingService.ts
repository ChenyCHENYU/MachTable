import type { GridCore } from "../core/gridCore";
import type { Column } from "./column";
import type { RowNode } from "../types/row";
import type { ICellEditor } from "../types/params";
import { createEditor } from "./editors";
import { cleanupCellContent } from "../render/cellContent";

type EditingContext = Pick<
  GridCore<any>,
  | "bodyRenderer"
  | "emit"
  | "getApi"
  | "getCellValue"
  | "keyboardService"
  | "reportError"
  | "resolveCellEditor"
  | "rowModel"
  | "setCellValue"
>;

interface EditingState {
  node: RowNode<any>;
  column: Column;
  editor: ICellEditor;
  rowIndex: number;
  oldValue: any;
}

export class EditingService {
  private editing: EditingState | null = null;
  private stopPromise: Promise<boolean> | null = null;
  private stopToken = 0;

  constructor(private core: EditingContext) {}

  isEditing(rowIndex?: number, colId?: string): boolean {
    if (!this.editing) return false;
    if (rowIndex == null && colId == null) return true;
    return this.editing.rowIndex === rowIndex && this.editing.column.id === colId;
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
    if (this.editing) return false;
    const node = this.core.rowModel.getDisplayedRow(rowIndex);
    if (!node || node.data == null) return false;
    if (!this.isEditable(node, column)) return false;
    const cell = this.core.bodyRenderer.getCellElement(rowIndex, column.id);
    if (!cell) return false;

    const value = this.core.getCellValue(node, column);
    const def = column.colDef;
    let editor: ICellEditor;
    const ce = def.cellEditor;
    try {
      if (typeof ce === "function") {
        editor = ce({
          api: this.core.getApi(),
          colDef: def,
          column,
          node,
          data: node.data,
          value,
          rowIndex,
          keyPress
        });
      } else if (typeof ce === "string" && !["text", "number", "date", "select"].includes(ce)) {
        const factory = this.core.resolveCellEditor(ce);
        if (factory) {
          editor = factory({
            api: this.core.getApi(),
            colDef: def,
            column,
            node,
            data: node.data,
            value,
            rowIndex,
            keyPress
          });
        } else {
          editor = createEditor(column, value, keyPress);
        }
      } else {
        editor = createEditor(column, value, keyPress);
      }
    } catch (error) {
      this.core.reportError(error, "cellEditor", { colId: column.id, rowId: node.id });
      return false;
    }

    if (!editor || !(editor.el instanceof HTMLElement)) {
      this.core.reportError(new Error("cellEditor must return an editor with an HTMLElement el"), "cellEditor", {
        colId: column.id,
        rowId: node.id
      });
      return false;
    }

    try {
      if (editor.isCancelBeforeStart?.()) {
        editor.destroy?.();
        return false;
      }
    } catch (error) {
      this.core.reportError(error, "cellEditor.isCancelBeforeStart", { colId: column.id, rowId: node.id });
      try { editor.destroy?.(); } catch { void 0; }
      return false;
    }

    cleanupCellContent(this.core, cell);

    cell.textContent = "";
    cell.classList.add("mach-cell--editing");
    cell.appendChild(editor.el);
    this.editing = { node, column, editor, rowIndex, oldValue: value };

    editor.el.addEventListener("keydown", this.onEditorKeyDown);
    editor.el.addEventListener("focusout", this.onEditorBlur);
    try {
      editor.focus?.();
    } catch (error) {
      this.core.reportError(error, "cellEditor.focus", { colId: column.id, rowId: node.id });
    }

    this.core.emit("cellEditingStarted", { rowIndex, colId: column.id, rowNode: node });
    return true;
  }

  stop(cancel = false): void {
    void this.stopAsync(cancel);
  }

  stopAsync(cancel = false): Promise<boolean> {
    const editing = this.editing;
    if (!editing) return Promise.resolve(false);
    if (cancel) {
      this.stopToken++;
      this.stopPromise = null;
      return Promise.resolve(this.finishStop(editing, true, editing.oldValue));
    }
    if (this.stopPromise) return this.stopPromise;

    let newValue: any;
    try {
      newValue = editing.editor.getValue();
    } catch (error) {
      this.core.reportError(error, "cellEditor.getValue", { colId: editing.column.id, rowId: editing.node.id });
      return Promise.resolve(this.finishStop(editing, true, editing.oldValue));
    }
    try {
      if (editing.editor.isCancelAfterEnd?.(newValue)) {
        return Promise.resolve(this.finishStop(editing, true, editing.oldValue));
      }
    } catch (error) {
      this.core.reportError(error, "cellEditor.isCancelAfterEnd", { colId: editing.column.id, rowId: editing.node.id });
      return Promise.resolve(this.finishStop(editing, true, editing.oldValue));
    }

    const validation = this.validateValue(editing, newValue);
    if (validation && typeof (validation as Promise<unknown>).then === "function") {
      const token = ++this.stopToken;
      editing.editor.el.classList.add("mach-editor-validating");
      editing.editor.el.setAttribute("aria-busy", "true");
      editing.editor.el.inert = true;
      const task = Promise.resolve(validation)
        .then((result) => {
          if (token !== this.stopToken || this.editing !== editing) return false;
          if (typeof result === "string") {
            this.showError(editing, result);
            return false;
          }
          return this.finishStop(editing, false, newValue);
        })
        .catch((error) => {
          if (token !== this.stopToken || this.editing !== editing) return false;
          this.core.reportError(error, "validate", { colId: editing.column.id, rowId: editing.node.id });
          this.showError(editing, "Validation failed");
          return false;
        })
        .finally(() => {
          if (this.stopPromise === task) this.stopPromise = null;
        });
      this.stopPromise = task;
      return task;
    }
    if (typeof validation === "string") {
      this.showError(editing, validation);
      return Promise.resolve(false);
    }
    return Promise.resolve(this.finishStop(editing, false, newValue));
  }

  private finishStop(editing: EditingState, cancel: boolean, newValue: any): boolean {
    if (this.editing !== editing) return false;
    this.editing = null;
    const changed = !cancel && this.applyValue(editing, newValue);

    editing.editor.el.removeEventListener("keydown", this.onEditorKeyDown);
    editing.editor.el.removeEventListener("focusout", this.onEditorBlur);
    editing.editor.el.classList.remove("mach-editor-validating");
    editing.editor.el.removeAttribute("aria-busy");
    editing.editor.el.inert = false;
    try {
      editing.editor.destroy?.();
    } catch (error) {
      this.core.reportError(error, "cellEditor.destroy", { colId: editing.column.id, rowId: editing.node.id });
    }

    const cell = this.core.bodyRenderer.getCellElement(editing.rowIndex, editing.column.id);
    if (cell) {
      cell.classList.remove("mach-cell--editing");
      cell.classList.remove("mach-cell--error");
    }

    this.core.emit("cellEditingStopped", {
      rowIndex: editing.rowIndex,
      colId: editing.column.id,
      rowNode: editing.node,
      oldValue: editing.oldValue,
      newValue: changed ? newValue : editing.oldValue
    });

    if (editing.node.rowIndex >= 0) {
      this.core.bodyRenderer.refreshRows([editing.node.rowIndex]);
    }
    return true;
  }

  private validateValue(
    editing: EditingState,
    newValue: any
  ): string | true | null | undefined | Promise<string | true | null | undefined> {
    const validate = editing.column.colDef.validate;
    if (!validate) return true;
    try {
      return validate(newValue, {
        oldValue: editing.oldValue,
        newValue,
        data: editing.node.data!,
        node: editing.node,
        colDef: editing.column.colDef,
        column: editing.column,
        api: this.core.getApi()
      });
    } catch (error) {
      this.core.reportError(error, "validate", { colId: editing.column.id, rowId: editing.node.id });
      return "Validation failed";
    }
  }

  private showError(editing: EditingState, message: string): void {
    const editorEl = editing.editor.el as HTMLElement;
    editorEl.classList.add("mach-editor-invalid");
    editorEl.setAttribute("title", message);
    editorEl.setAttribute("aria-invalid", "true");
    editorEl.classList.remove("mach-editor-validating");
    editorEl.removeAttribute("aria-busy");
    editorEl.inert = false;
    const input = editorEl.querySelector("input, select") ?? editorEl;
    (input as HTMLElement).focus?.();
    const clear = () => {
      editorEl.classList.remove("mach-editor-invalid");
      editorEl.removeAttribute("title");
      editorEl.removeAttribute("aria-invalid");
    };
    editorEl.addEventListener("input", clear, { once: true });
  }

  private applyValue(editing: EditingState, newValue: any): boolean {
    if (newValue === undefined) return false;
    return this.core.setCellValue(editing.node, editing.column, newValue, editing.oldValue);
  }

  private onEditorKeyDown = (e: KeyboardEvent): void => {
    if (!this.editing) return;
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      this.stop(false);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.stop(true);
    } else if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      const current = this.editing;
      const next = this.core.keyboardService.nextEditable(current.rowIndex, current.column.id, e.shiftKey ? -1 : 1);
      void this.stopAsync(false).then((stopped) => {
        if (stopped && next) {
          this.core.bodyRenderer.scrollToIndex(next.rowIndex, "nearest");
          this.core.bodyRenderer.setFocusedCell(next.rowIndex, next.column.id);
          this.start(next.rowIndex, next.column);
        }
      });
    }
  };

  private onEditorBlur = (): void => {
    window.setTimeout(() => {
      if (this.editing) void this.stopAsync(false);
    }, 0);
  };

  destroy(): void {
    if (this.editing) void this.stopAsync(true);
  }
}
