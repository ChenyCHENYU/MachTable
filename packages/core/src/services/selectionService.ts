import type { GridCore } from "../core/gridCore";
import type { RowNode } from "../types/row";

type SelectionContext = Pick<
  GridCore<any>,
  | "bodyRenderer"
  | "columnModel"
  | "emit"
  | "api"
  | "readCellValue"
  | "headerRenderer"
  | "gridOptions"
  | "reportError"
  | "rowModel"
>;

/** @internal Consumers receive selection records and facade methods only. */
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
    if (node.loading) return false;
    const column = this.findSelectableColumn(node);
    const check = column?.colDef.selectable;
    if (!column || !check) return true;
    try {
      return check({
        api: this.core.api,
        colDef: column.colDef,
        column,
        node,
        data: node.data,
        value: this.core.readCellValue(node, column),
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

  getSelectedRows(nodes = this.getSelectedNodes()): any[] {
    return nodes.filter((n) => n.data != null).map((n) => n.data);
  }

  getSelectedIds(): string[] {
    return [...this.selectedIds];
  }

  restoreSelection(ids: readonly string[]): void {
    const requested = new Set(ids);
    const changes = this.core.rowModel
      .getAllNodes()
      .filter((node) => requested.has(node.id) && !node.isDetail && !node.isGroup)
      .map((node) => ({ node, selected: true }));
    this.applySelection(changes, true);
  }

  onRowsRebuilt(preserveIds: boolean): void {
    const nodes = this.core.rowModel.getAllNodes();
    if (!preserveIds) {
      this.selectedIds.clear();
      this.anchorId = null;
    } else {
      const existing = new Set(nodes.map((n) => n.id));
      for (const id of [...this.selectedIds]) {
        if (!existing.has(id)) this.selectedIds.delete(id);
      }
      if (this.anchorId != null && !existing.has(this.anchorId)) this.anchorId = null;
    }
    this.recomputeTriState();
    for (const node of nodes) node.selected = this.selectedIds.has(node.id);
  }

  getGroupSelectionState(groupNode: RowNode<any>): { all: boolean; some: boolean } {
    const { selectable, selected } = this.countSelection(groupNode.leafNodes ?? [], false);
    return { all: selected > 0 && selected === selectable, some: selected > 0 };
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

  private selectFromCheckbox(node: RowNode<any>, mode: "single" | "multiple"): void {
    const single = mode === "single";
    this.setNodeSelected(node, single || !node.selected, single);
    this.anchorId = node.id;
  }

  private toggleFromModifier(node: RowNode<any>, event: MouseEvent, multiple: boolean): boolean {
    if (!multiple || (!event.ctrlKey && !event.metaKey)) return false;
    this.setNodeSelected(node, !node.selected);
    this.anchorId = node.id;
    return true;
  }

  private selectAnchorRange(node: RowNode<any>, event: MouseEvent, multiple: boolean): boolean {
    if (!multiple || !event.shiftKey || this.anchorId == null) return false;
    const anchor = this.core.rowModel.getNodeById(this.anchorId);
    if (!anchor || anchor.rowIndex < 0 || node.rowIndex < 0) return false;
    const start = Math.min(anchor.rowIndex, node.rowIndex);
    const end = Math.max(anchor.rowIndex, node.rowIndex);
    const changes = [];
    for (let index = start; index <= end; index++) {
      const row = this.core.rowModel.getDisplayedRow(index);
      if (row && !row.isDetail && !row.isGroup && this.isSelectable(row)) {
        changes.push({ node: row, selected: true });
      }
    }
    this.applySelection(changes);
    return true;
  }

  onRowClick(node: RowNode<any>, event: MouseEvent, fromCheckbox: boolean): void {
    const mode = this.core.gridOptions.rowSelection;
    if (mode === "none" || !this.isSelectable(node)) return;
    if (fromCheckbox) {
      this.selectFromCheckbox(node, mode);
      return;
    }
    const multi = mode === "multiple";
    if (this.toggleFromModifier(node, event, multi)) return;
    if (this.selectAnchorRange(node, event, multi)) return;
    this.setNodeSelected(node, true, true);
    this.anchorId = node.id;
  }

  selectAll(filteredOnly = true): void {
    const mode = this.core.gridOptions.rowSelection;
    if (mode === "none") return;
    const candidates = filteredOnly ? this.core.rowModel.getDisplayedRows() : this.core.rowModel.getAllNodes();
    const selectable = candidates.filter((n) => !n.isDetail && !n.isGroup && this.isSelectable(n));
    if (selectable.length === 0) return;
    if (mode === "single") {
      this.setNodeSelected(selectable[0], true, true);
      return;
    }
    this.applySelection(selectable.map((node) => ({ node, selected: true })));
  }

  deselectAll(): void {
    this.applySelection([], true);
  }

  getSelectAllState(): { all: boolean; some: boolean } {
    const model = this.core.rowModel;
    const { selectable, selected } = this.countSelection(model.getDisplayedRows(), true);
    const all = selected > 0 && selected === selectable &&
      (!model.isInfinite || selectable >= model.getDisplayTotalCount());
    return { all, some: selected > 0 && !all };
  }

  private countSelection(rows: readonly RowNode<any>[], displayed: boolean) {
    let selectable = 0;
    let selected = 0;
    for (const row of rows) {
      if ((displayed && (row.isDetail || row.isGroup)) || !this.isSelectable(row)) continue;
      selectable++;
      if (this.selectedIds.has(row.id)) selected++;
    }
    return { selectable, selected };
  }

  applySelectionPublic(
    changes: { node: RowNode<any>; selected: boolean; clearOthers?: boolean }[],
    clearOthers = false
  ): void {
    this.applySelection(changes, clearOthers);
  }

  private replaceSelection(
    changes: { node: RowNode<any>; selected: boolean; clearOthers?: boolean }[],
    clearAll: boolean,
    cascadeTree: boolean
  ): void {
    if (!clearAll && !changes.some((change) => change.clearOthers)) return;
    this.selectedIds = clearAll
      ? new Set<string>()
      : new Set(changes.filter((change) => change.selected).flatMap(
        (change) => cascadeTree ? this.subtreeIds(change.node) : [change.node.id]
      ));
  }

  private applySelectionChanges(
    changes: { node: RowNode<any>; selected: boolean; clearOthers?: boolean }[],
    cascadeTree: boolean
  ): void {
    for (const change of changes) {
      if (!this.isSelectable(change.node)) continue;
      const targets = cascadeTree ? this.subtreeIds(change.node) : [change.node.id];
      for (const id of targets) {
        if (change.selected) this.selectedIds.add(id);
        else this.selectedIds.delete(id);
      }
    }
  }

  private changedSelectionIds(before: ReadonlySet<string>): Set<string> {
    const changed = new Set(before);
    for (const id of this.selectedIds) {
      if (!changed.delete(id)) changed.add(id);
    }
    return changed;
  }

  private synchronizeNodeSelection(
    changedIds: ReadonlySet<string>,
    previousIndeterminate: ReadonlySet<string>
  ): number[] {
    const refreshIndexes: number[] = [];
    const touched = new Set<string>([...changedIds, ...previousIndeterminate, ...this.indeterminateIds]);
    for (const node of this.core.rowModel.getAllNodes()) {
      const selected = this.selectedIds.has(node.id);
      if ((touched.has(node.id) || node.selected !== selected) && node.rowIndex >= 0) {
        refreshIndexes.push(node.rowIndex);
      }
      node.selected = selected;
    }
    return refreshIndexes;
  }

  private applySelection(
    changes: { node: RowNode<any>; selected: boolean; clearOthers?: boolean }[],
    clearAll = false
  ): void {
    const before = new Set(this.selectedIds);
    const cascadeTree = this.core.rowModel.isTree && this.core.gridOptions.autoCheckedChildren;
    this.replaceSelection(changes, clearAll, cascadeTree);
    this.applySelectionChanges(changes, cascadeTree);
    const changedIds = this.changedSelectionIds(before);
    const prevIndeterminate = new Set(this.indeterminateIds);

    this.recomputeTriState();
    const refreshIndexes = this.synchronizeNodeSelection(changedIds, prevIndeterminate);
    if (changedIds.size > 0) {
      this.core.bodyRenderer.refreshRows(refreshIndexes);
      this.core.headerRenderer.refreshSelectAllCheckbox();
      const selectedNodes = this.getSelectedNodes();
      this.core.emit("selectionChanged", {
        selectedNodes,
        selectedRows: this.getSelectedRows(selectedNodes)
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
        all &&= state.all;
        some ||= state.some;
      }
      if (some && !all) this.indeterminateIds.add(id);
      if (all) this.selectedIds.add(id);
      else this.selectedIds.delete(id);
      return { all, some };
    };

    for (const root of this.core.rowModel.getRootNodes()) {
      evaluate(root.id);
    }
  }
}
