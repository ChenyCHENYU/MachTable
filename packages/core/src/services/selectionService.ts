import type { GridCore } from "../core/gridCore";
import type { RowNode } from "../types/row";

type SelectionContext = Pick<
  GridCore<any>,
  | "bodyRenderer"
  | "columnModel"
  | "emit"
  | "getApi"
  | "getCellValue"
  | "headerRenderer"
  | "options"
  | "reportError"
  | "rowModel"
>;

export class SelectionService {
  private selectedIds = new Set<string>();
  private anchorId: string | null = null;
  private indeterminateIds = new Set<string>();

  constructor(private core: SelectionContext) {}

  isSelected(id: string): boolean {
    return this.selectedIds.has(id);
  }

  isIndeterminate(id: string): boolean {
    return this.indeterminateIds.has(id);
  }

  isSelectable(node: RowNode<any>): boolean {
    const column = this.findSelectableColumn(node);
    const check = column?.colDef.selectable;
    if (!column || !check) return true;
    try {
      return check({
        api: this.core.getApi(),
        colDef: column.colDef,
        column,
        node,
        data: node.data,
        value: this.core.getCellValue(node, column),
        rowIndex: node.rowIndex
      });
    } catch (error) {
      this.core.reportError(error, "selectable", { rowId: node.id, colId: column?.id });
      return false;
    }
  }

  private findSelectableColumn(node: RowNode<any>) {
    if (node.isGroup || node.isDetail) return undefined;
    return this.core.columnModel
      .getOrderedVisible()
      .find((column) => column.hasCheckbox && column.colDef.selectable != null);
  }

  getSelectedNodes(): RowNode<any>[] {
    return this.core.rowModel.getAllNodes().filter((n) => this.selectedIds.has(n.id));
  }

  getSelectedRows(): any[] {
    return this.getSelectedNodes().filter((n) => n.data != null).map((n) => n.data);
  }

  getSelectedIds(): string[] {
    return [...this.selectedIds];
  }

  onRowsRebuilt(preserveIds: boolean): void {
    if (!preserveIds) {
      this.selectedIds.clear();
      this.anchorId = null;
    } else {
      const existing = new Set(this.core.rowModel.getAllNodes().map((n) => n.id));
      for (const id of [...this.selectedIds]) {
        if (!existing.has(id)) this.selectedIds.delete(id);
      }
      if (this.anchorId != null && !existing.has(this.anchorId)) this.anchorId = null;
    }
    for (const node of this.core.rowModel.getAllNodes()) {
      node.selected = this.selectedIds.has(node.id);
    }
    this.recomputeTriState();
  }

  getGroupSelectionState(groupNode: RowNode<any>): { all: boolean; some: boolean } {
    const leaves = groupNode.leafNodes ?? [];
    if (leaves.length === 0) return { all: false, some: false };
    let selectableCount = 0;
    let count = 0;
    for (const leaf of leaves) {
      if (!this.isSelectable(leaf)) continue;
      selectableCount++;
      if (this.selectedIds.has(leaf.id)) count++;
    }
    if (selectableCount === 0) return { all: false, some: false };
    return { all: count === selectableCount, some: count > 0 };
  }

  setGroupSelected(groupNode: RowNode<any>, selected: boolean): void {
    const leaves = (groupNode.leafNodes ?? []).filter((n) => this.isSelectable(n));
    if (leaves.length === 0) return;
    this.applySelection(leaves.map((node) => ({ node, selected })));
  }

  setNodeSelected(node: RowNode<any>, selected: boolean, clearOthers = false): void {
    this.applySelection([{ node, selected, clearOthers }]);
  }

  selectNodeById(nodeId: string, selected = true, clearOthers = true): void {
    const node = this.core.rowModel.getNodeById(nodeId);
    if (node) this.setNodeSelected(node, selected, clearOthers);
  }

  onRowClick(node: RowNode<any>, event: MouseEvent, fromCheckbox: boolean): void {
    const mode = this.core.options.rowSelection;
    if (mode === "none") return;
    if (!this.isSelectable(node)) return;

    if (fromCheckbox) {
      const single = mode === "single";
      this.applySelection([{ node, selected: single ? true : !node.selected, clearOthers: single }]);
      this.anchorId = node.id;
      return;
    }

    const multi = mode === "multiple";
    if (multi && (event.ctrlKey || event.metaKey)) {
      this.applySelection([{ node, selected: !node.selected }]);
      this.anchorId = node.id;
      return;
    }

    if (multi && event.shiftKey && this.anchorId != null) {
      const anchor = this.core.rowModel.getNodeById(this.anchorId);
      if (anchor && anchor.rowIndex >= 0 && node.rowIndex >= 0) {
        const start = Math.min(anchor.rowIndex, node.rowIndex);
        const end = Math.max(anchor.rowIndex, node.rowIndex);
        const changes = [];
        for (let i = start; i <= end; i++) {
          const row = this.core.rowModel.getDisplayedRow(i);
          if (row && !row.isDetail && !row.isGroup && this.isSelectable(row)) {
            changes.push({ node: row, selected: true });
          }
        }
        this.applySelection(changes);
        return;
      }
    }

    this.applySelection([{ node, selected: true, clearOthers: true }]);
    this.anchorId = node.id;
  }

  selectAll(filteredOnly = true): void {
    const mode = this.core.options.rowSelection;
    if (mode === "none") return;
    const candidates = filteredOnly ? this.core.rowModel.getDisplayedRows() : this.core.rowModel.getAllNodes();
    const selectable = candidates.filter((n) => !n.isDetail && !n.isGroup && this.isSelectable(n));
    if (selectable.length === 0) return;
    if (mode === "single") {
      this.applySelection([{ node: selectable[0], selected: true, clearOthers: true }]);
      return;
    }
    this.applySelection(selectable.map((node) => ({ node, selected: true })));
  }

  deselectAll(): void {
    this.applySelection([], true);
  }

  isSelectAllActive(): boolean {
    const rows = this.core.rowModel.getDisplayedRows().filter((n) => !n.isDetail && !n.isGroup);
    const selectable = rows.filter((n) => this.isSelectable(n));
    if (selectable.length === 0) return false;
    if (this.core.rowModel.isInfinite) {
      const total = this.core.rowModel.getDisplayTotalCount();
      if (selectable.length < total) return false;
    }
    return selectable.every((n) => this.selectedIds.has(n.id));
  }

  isSelectAllIndeterminate(): boolean {
    const rows = this.core.rowModel.getDisplayedRows().filter((n) => !n.isDetail && !n.isGroup);
    const selectable = rows.filter((n) => this.isSelectable(n));
    const count = selectable.reduce((acc, n) => acc + (this.selectedIds.has(n.id) ? 1 : 0), 0);
    if (count === 0) return false;
    if (this.core.rowModel.isInfinite) {
      const total = this.core.rowModel.getDisplayTotalCount();
      if (selectable.length < total) return true;
    }
    return count > 0 && count < selectable.length;
  }

  applySelectionPublic(
    changes: { node: RowNode<any>; selected: boolean; clearOthers?: boolean }[],
    clearOthers = false
  ): void {
    this.applySelection(changes, clearOthers);
  }

  private applySelection(
    changes: { node: RowNode<any>; selected: boolean; clearOthers?: boolean }[],
    clearAll = false
  ): void {
    const before = new Set(this.selectedIds);
    const clearOthers = clearAll || changes.some((c) => c.clearOthers);
    const isTree = this.core.rowModel.isTree && this.core.options.autoCheckedChildren;

    if (clearOthers) {
      const keep = clearAll
        ? new Set<string>()
        : new Set(changes.filter((c) => c.selected).flatMap((c) => (isTree ? this.subtreeIds(c.node) : [c.node.id])));
      this.selectedIds = keep;
    }

    for (const c of changes) {
      if (!this.isSelectable(c.node)) continue;
      const targets = isTree ? this.subtreeIds(c.node) : [c.node.id];
      for (const id of targets) {
        if (c.selected) this.selectedIds.add(id);
        else this.selectedIds.delete(id);
      }
    }

    const changedIds = new Set<string>();
    for (const id of new Set([...before, ...this.selectedIds])) {
      if (before.has(id) !== this.selectedIds.has(id)) changedIds.add(id);
    }

    const prevSelected = new Map<string, boolean>();
    for (const node of this.core.rowModel.getAllNodes()) {
      prevSelected.set(node.id, node.selected);
    }
    const prevIndeterminate = new Set(this.indeterminateIds);

    this.recomputeTriState();

    const refreshIndexes: number[] = [];
    const touched = new Set<string>([...changedIds, ...prevIndeterminate, ...this.indeterminateIds]);
    for (const node of this.core.rowModel.getAllNodes()) {
      const isSel = this.selectedIds.has(node.id);
      node.selected = isSel;
      if (touched.has(node.id) || prevSelected.get(node.id) !== isSel) {
        if (node.rowIndex >= 0) refreshIndexes.push(node.rowIndex);
      }
    }

    if (changedIds.size > 0) {
      this.core.bodyRenderer.refreshRows(refreshIndexes);
      this.core.headerRenderer.refreshSelectAllCheckbox();
      this.core.emit("selectionChanged", {
        selectedNodes: this.getSelectedNodes(),
        selectedRows: this.getSelectedRows()
      });
    }
  }

  private subtreeIds(node: RowNode<any>): string[] {
    const out: string[] = [node.id];
    const walk = (id: string) => {
      for (const childId of this.core.rowModel.getChildrenIds(id)) {
        out.push(childId);
        walk(childId);
      }
    };
    walk(node.id);
    return out;
  }

  private recomputeTriState(): void {
    this.indeterminateIds.clear();
    if (!this.core.rowModel.isTree) return;

    const evaluate = (id: string): { all: boolean; some: boolean } => {
      const childIds = this.core.rowModel.getChildrenIds(id);
      if (childIds.length === 0) {
        return { all: this.selectedIds.has(id), some: this.selectedIds.has(id) };
      }
      let all = true;
      let some = false;
      for (const childId of childIds) {
        const state = evaluate(childId);
        if (state.all) some = true;
        else if (state.some) {
          some = true;
          all = false;
        } else {
          all = false;
        }
      }
      if (some && !all) this.indeterminateIds.add(id);
      if (all) this.selectedIds.add(id);
      else this.selectedIds.delete(id);
      return { all, some };
    };

    for (const root of this.core.rowModel.getRootNodes()) {
      evaluate(root.id);
    }
    for (const node of this.core.rowModel.getAllNodes()) {
      node.selected = this.selectedIds.has(node.id);
    }
  }
}
