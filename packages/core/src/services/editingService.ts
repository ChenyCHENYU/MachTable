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
    if (this.editing) this.stop(false);
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
    const editing = this.editing;
    if (!editing) return;
    this.editing = null;

    let newValue: any;
    let changed = false;
    if (!cancel) {
      try {
        newValue = editing.editor.getValue();
      } catch (error) {
        this.core.reportError(error, "cellEditor.getValue", { colId: editing.column.id, rowId: editing.node.id });
        cancel = true;
      }
      let cancelAfterEnd = cancel;
      if (!cancelAfterEnd) {
        try {
          cancelAfterEnd = editing.editor.isCancelAfterEnd?.(newValue) ?? false;
        } catch (error) {
          this.core.reportError(error, "cellEditor.isCancelAfterEnd", { colId: editing.column.id, rowId: editing.node.id });
          cancelAfterEnd = true;
        }
      }
      if (!cancelAfterEnd) {
        const validationError = this.validateValue(editing, newValue);
        if (typeof validationError === "string") {
          this.editing = editing;
          this.showError(editing, validationError);
          return;
        }
        changed = this.applyValue(editing, newValue);
      }
    }

    editing.editor.el.removeEventListener("keydown", this.onEditorKeyDown);
    editing.editor.el.removeEventListener("focusout", this.onEditorBlur);
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
  }

  private validateValue(editing: EditingState, newValue: any): string | true | null | undefined {
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
      this.stop(false);
      if (next) {
        this.core.bodyRenderer.scrollToIndex(next.rowIndex, "nearest");
        this.core.bodyRenderer.setFocusedCell(next.rowIndex, next.column.id);
        this.start(next.rowIndex, next.column);
      }
    }
  };

  private onEditorBlur = (): void => {
    window.setTimeout(() => {
      if (this.editing) this.stop(false);
    }, 0);
  };

  destroy(): void {
    if (this.editing) this.stop(true);
  }
}
