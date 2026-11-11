import type { GridCore } from "../core/gridCore";
import type { RowNode } from "../types/row";
import type { Column } from "./column";

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
type SelectionChange = { node: RowNode<any>; selected: boolean; clearOthers?: boolean };

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

  isSelectable(node: RowNode<any>, policy?: Column | null): boolean {
    if (node.loading) return false;
    if (node.isGroup || node.isDetail) return true;
    const column = policy === undefined ? this.findSelectableColumn() : policy;
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
      this.core.reportError(error, "selectable", { rowId: node.id, colId: column.id });
      return false;
    }
  }

  private findSelectableColumn() {
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
    const policy = this.findSelectableColumn() ?? null;
    const changes = this.core.rowModel
      .getAllNodes()
      .filter((node) => requested.has(node.id) && !node.isDetail && !node.isGroup && this.isSelectable(node, policy))
      .map((node) => ({ node, selected: true }));
    this.applySelection(changes, true);
  }

  onModeChanged(): void {
    this.restoreSelection(this.core.gridOptions.rowSelection === "none" ? [] : this.getSelectedIds());
  }

  onRowsRebuilt(preserveIds: boolean): void {
    const model = this.core.rowModel;
    if (!preserveIds) {
      this.selectedIds.clear();
      this.anchorId = null;
    } else {
      for (const id of this.selectedIds) {
        if (!model.getNodeById(id)) this.selectedIds.delete(id);
      }
      if (this.anchorId != null && !model.getNodeById(this.anchorId)) this.anchorId = null;
    }
    // The projection assigns row indexes after rebuilding. Keep stable-ID
    // selection here and evaluate row eligibility on explicit selection.
    this.recomputeTriState(null);
    for (const node of model.getAllNodes()) node.selected = this.selectedIds.has(node.id);
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

  private selectAnchorRange(node: RowNode<any>, event: MouseEvent, multiple: boolean): boolean {
    if (!multiple || !event.shiftKey || this.anchorId == null) return false;
    const anchor = this.core.rowModel.getNodeById(this.anchorId);
    if (!anchor || anchor.rowIndex < 0 || node.rowIndex < 0) return false;
    const start = Math.min(anchor.rowIndex, node.rowIndex);
    const end = Math.max(anchor.rowIndex, node.rowIndex);
    const changes = [];
    for (let index = start; index <= end; index++) {
      const row = this.core.rowModel.getDisplayedRow(index);
      if (row && !row.isDetail && !row.isGroup) {
        changes.push({ node: row, selected: true });
      }
    }
    this.applySelection(changes);
    return true;
  }

  onRowClick(node: RowNode<any>, event: MouseEvent, fromCheckbox: boolean): void {
    const mode = this.core.gridOptions.rowSelection;
    if (mode === "none" || !this.isSelectable(node)) return;
    const multi = mode === "multiple";
    const toggle = multi && (fromCheckbox || event.ctrlKey || event.metaKey);
    if (!toggle && this.selectAnchorRange(node, event, multi)) return;
    this.setNodeSelected(node, !toggle || !node.selected, !toggle);
    this.anchorId = node.id;
  }

  selectAll(filteredOnly = true): void {
    const mode = this.core.gridOptions.rowSelection;
    if (mode === "none") return;
    const candidates = filteredOnly ? this.core.rowModel.getDisplayedRows() : this.core.rowModel.getAllNodes();
    this.applySelection(candidates.filter(node => !node.isDetail && !node.isGroup).map(node => ({ node, selected: true })));
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

  private applySelectionChanges(
    changes: SelectionChange[],
    policy: Column | null
  ): void {
    const model = this.core.rowModel;
    const single = this.core.gridOptions.rowSelection === "single";
    const cascadeTree = !single && model.isTree && this.core.gridOptions.autoCheckedChildren;
    const apply = (node: RowNode<any>, selected: boolean, validated = false): void => {
      if (!selected) this.selectedIds.delete(node.id);
      else if (validated || this.isSelectable(node, policy)) this.selectedIds.add(node.id);
      if (!cascadeTree) return;
      for (const id of model.getChildrenIds(node.id)) {
        const child = model.getNodeById(id);
        if (child) apply(child, selected);
      }
    };
    for (const { node, selected } of changes) {
      apply(node, selected, true);
      if (single && selected) break;
    }
  }

  private changedSelectionIds(before: ReadonlySet<string>): Set<string> {
    const changed = new Set(before);
    for (const id of this.selectedIds) {
      if (!changed.delete(id)) changed.add(id);
    }
    return changed;
  }

  private synchronizeNodeSelection(previousIndeterminate: ReadonlySet<string>): number[] {
    const refreshIndexes: number[] = [];
    for (const node of this.core.rowModel.getAllNodes()) {
      const selected = this.selectedIds.has(node.id);
      if ((node.selected !== selected || previousIndeterminate.has(node.id) || this.indeterminateIds.has(node.id)) && node.rowIndex >= 0) {
        refreshIndexes.push(node.rowIndex);
      }
      node.selected = selected;
    }
    return refreshIndexes;
  }

  applySelection(changes: SelectionChange[], clearAll = false): void {
    const mode = this.core.gridOptions.rowSelection;
    const policy = this.findSelectableColumn() ?? null;
    const eligible = changes.filter((change) => !change.selected || (mode !== "none" && this.isSelectable(change.node, policy)));
    // A rejected target must not replace an existing selection. An explicit
    // empty request still clears, and an old disabled selection can be removed.
    if (changes.length > 0 && eligible.length === 0) return;
    const before = new Set(this.selectedIds);
    if (clearAll || eligible.some(change => change.selected
      ? mode === "single" || change.clearOthers
      : change.clearOthers && this.isSelectable(change.node, policy))) this.selectedIds.clear();
    this.applySelectionChanges(eligible, policy);
    const prevIndeterminate = new Set(this.indeterminateIds);

    this.recomputeTriState(policy);
    const changedIds = this.changedSelectionIds(before);
    const refreshIndexes = this.synchronizeNodeSelection(prevIndeterminate);
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

  private recomputeTriState(policy: Column | null): void {
    this.indeterminateIds.clear();
    const model = this.core.rowModel;
    if (this.core.gridOptions.rowSelection !== "multiple" || !model.isTree || this.selectedIds.size === 0) return;

    const evaluate = (id: string): { all: boolean; some: boolean } => {
      const node = policy && model.getNodeById(id);
      const selectable = !node || this.isSelectable(node, policy);
      let all = true;
      let some = false;
      for (const childId of model.getChildrenIds(id)) {
        const state = evaluate(childId);
        all &&= state.all;
        some ||= state.some;
      }
      // With no eligible descendants, the row has its own selection state.
      if (all && !some) {
        if (!selectable) this.selectedIds.delete(id);
        const selected = this.selectedIds.has(id);
        return { all: selected || !selectable, some: selected };
      }
      if (selectable && all) this.selectedIds.add(id);
      else {
        this.selectedIds.delete(id);
        if (selectable && some) this.indeterminateIds.add(id);
      }
      return { all, some };
    };

    for (const root of model.getRootNodes()) evaluate(root.id);
  }
}
