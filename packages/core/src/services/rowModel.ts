import type { GridCore } from "../core/gridCore";
import type { RowNode } from "../types/row";
import type { FilterModel } from "../types/colDef";
import type { RowTransaction } from "../types/api";
import { doesNodePassFilters } from "./filterService";
import { sortNodes } from "./sortService";
import { createAggResolver } from "../lib/aggregate";
import { defaultComparator } from "../lib/compare";

type ColumnLike = import("./column").Column;
type RowModelContext = Pick<
  GridCore<any>,
  | "bodyRenderer"
  | "changeTracker"
  | "columnModel"
  | "emit"
  | "getApi"
  | "getCellValue"
  | "getLocaleText"
  | "headerRenderer"
  | "isDestroyed"
  | "nextId"
  | "options"
  | "relayout"
  | "reportError"
  | "selectionService"
  | "skeleton"
  | "undoService"
>;

function readChildren(data: unknown, key: string): unknown[] | undefined {
  if (data == null || typeof data !== "object") return undefined;
  const value = (data as Record<string, unknown>)[key];
  return Array.isArray(value) ? value : undefined;
}

export class RowModel<TData = any> {
  private all: RowNode<TData>[] = [];
  private roots: RowNode<TData>[] = [];
  private childIds = new Map<string, string[]>();
  private displayed: RowNode<TData>[] = [];
  private nodesById = new Map<string, RowNode<TData>>();
  private filterModel: FilterModel = {};
  private quickFilter: string | null = null;
  private expandedIds = new Set<string>();
  private groupExpandedIds = new Set<string>();
  private knownGroupIds: string[] = [];
  private spanInfo = new Map<string, Int32Array>();
  private mastersBuf: RowNode<TData>[] = [];
  private infiniteLastRow: number | null = null;
  private infiniteRequested = false;
  private infiniteLoading = false;
  private infiniteSeq = 0;
  private infiniteAbort: AbortController | null = null;
  private infiniteRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private infinitePendingResolve: (() => void) | null = null;
  private treeDepth = new WeakMap<RowNode<TData>, number>();
  private rowSequence = new WeakMap<RowNode<TData>, number>();

  constructor(private core: RowModelContext) {}

  resolveRowId(data: TData, index: number, fallback: string): string {
    const getRowId = this.core.options.getRowId;
    if (!getRowId) return fallback;
    try {
      const id = getRowId({ data, index, api: this.core.getApi() });
      if (typeof id === "string" && id.length > 0) return id;
      this.core.reportError(new Error("getRowId must return a non-empty string"), "getRowId", { index });
    } catch (error) {
      this.core.reportError(error, "getRowId", { index });
    }
    return fallback;
  }

  get isTree(): boolean {
    return this.core.options.treeData;
  }

  get isInfinite(): boolean {
    return this.core.options.datasource != null;
  }

  getDisplayTotalCount(): number {
    if (this.isInfinite) {
      const detailRows = Math.max(0, this.displayed.length - this.all.length);
      return (this.infiniteLastRow ?? this.all.length) + detailRows;
    }
    return this.displayed.length;
  }

  isLoadingInfinite(): boolean {
    return this.infiniteLoading;
  }

  startInfinite(): Promise<void> {
    if (!this.isInfinite) return Promise.resolve();
    this.cancelInfiniteRequest();
    this.infiniteLastRow = null;
    this.infiniteRequested = false;
    this.all = [];
    this.roots = [];
    this.nodesById.clear();
    this.expandedIds.clear();
    this.core.undoService.clear();
    this.refreshPipeline();
    this.core.bodyRenderer.onDataChanged();
    return this.loadBlock(0);
  }

  reloadInfinite(): Promise<void> {
    if (!this.isInfinite) return Promise.resolve();
    return this.startInfinite();
  }

  private setInfiniteLoading(v: boolean): void {
    this.infiniteLoading = v;
    this.core.skeleton.setInfiniteLoading(v, this.core.getLocaleText("loading"));
  }

  private loadBlock(start: number, end?: number): Promise<void> {
    if (!this.isInfinite || this.infiniteRequested) return Promise.resolve();
    if (this.infiniteLastRow != null && start >= this.infiniteLastRow) return Promise.resolve();
    const datasource = this.core.options.datasource!;
    const blockSize = this.core.options.blockSize;
    const stop = end ?? start + blockSize;
    if (stop <= start) return Promise.resolve();
    const seq = ++this.infiniteSeq;
    const controller = new AbortController();
    this.infiniteAbort = controller;
    this.infiniteRequested = true;
    this.setInfiniteLoading(true);

    return new Promise<void>((resolve) => {
      let settled = false;
      let attempt = 0;
      this.infinitePendingResolve = resolve;
      const done = (reason?: unknown) => {
        if (settled) return;
        settled = true;
        if (seq === this.infiniteSeq) {
          this.infiniteRequested = false;
          this.infiniteAbort = null;
          this.infinitePendingResolve = null;
          this.setInfiniteLoading(false);
          if (reason != null && (reason as { name?: string })?.name !== "AbortError") {
            this.core.reportError(reason, "datasource.getRows", { startRow: start, endRow: stop });
          }
        }
        resolve();
      };

      const runAttempt = () => {
        if (settled || seq !== this.infiniteSeq || controller.signal.aborted || this.core.isDestroyed()) {
          done();
          return;
        }
        attempt++;
        let attemptSettled = false;
        const failAttempt = (reason?: unknown) => {
          if (attemptSettled || settled) return;
          attemptSettled = true;
          if (seq !== this.infiniteSeq || controller.signal.aborted || this.core.isDestroyed()) {
            done();
            return;
          }
          if (attempt <= this.core.options.datasourceRetryCount) {
            const delay = Math.min(
              this.core.options.datasourceRetryDelay * 2 ** Math.max(0, attempt - 1),
              30_000
            );
            this.infiniteRetryTimer = setTimeout(() => {
              this.infiniteRetryTimer = null;
              runAttempt();
            }, delay);
            return;
          }
          done(reason ?? new Error("Datasource request failed"));
        };

        try {
          const request = datasource.getRows({
            startRow: start,
            endRow: stop,
            sortModel: this.core.columnModel.getSortModel(),
            filterModel: this.getFilterModel(),
            quickFilterText: this.quickFilter,
            signal: controller.signal,
            onSuccess: (rows, lastRow) => {
              if (attemptSettled || settled) return;
              attemptSettled = true;
              if (seq !== this.infiniteSeq || this.core.isDestroyed() || controller.signal.aborted) {
                done();
                return;
              }
              const received = rows ?? [];
              if (typeof lastRow === "number" && lastRow >= 0) {
                this.infiniteLastRow = lastRow;
              } else if (received.length < stop - start) {
                this.infiniteLastRow = start + received.length;
              }
              const wasEmpty = this.all.length === 0;
              this.appendInfiniteRows(received);
              done();
              this.refreshPipeline();
              this.core.bodyRenderer.onDataChanged();
              if (wasEmpty) this.core.relayout();
              this.core.headerRenderer.refreshSelectAllCheckbox();
            },
            fail: failAttempt
          });
          if (request && typeof (request as Promise<void>).catch === "function") {
            void (request as Promise<void>).catch(failAttempt);
          }
        } catch (error) {
          failAttempt(error);
        }
      };

      runAttempt();
    });
  }

  private cancelInfiniteRequest(): void {
    this.infiniteSeq++;
    if (this.infiniteRetryTimer != null) clearTimeout(this.infiniteRetryTimer);
    this.infiniteRetryTimer = null;
    this.infiniteAbort?.abort();
    this.infiniteAbort = null;
    this.infiniteRequested = false;
    this.setInfiniteLoading(false);
    this.infinitePendingResolve?.();
    this.infinitePendingResolve = null;
  }

  private appendInfiniteRows(rows: TData[]): void {
    for (const data of rows) {
      if (data == null) continue;
      const index = this.all.length;
      const id = this.resolveRowId(data, index, `inf-${this.core.nextId()}`);
      if (this.nodesById.has(id)) {
        this.core.reportError(new Error(`Duplicate row id: ${id}`), "datasource.getRows", { rowId: id });
        continue;
      }
      const node: RowNode<TData> = {
        id,
        data,
        rowIndex: -1,
        selected: this.core.selectionService.isSelected(id)
      };
      this.all.push(node);
      this.nodesById.set(id, node);
      this.roots.push(node);
    }
  }

  checkInfiniteScroll(lastVisibleIndex: number): void {
    if (!this.isInfinite || this.infiniteRequested) return;
    const loaded = this.all.length;
    if (this.infiniteLastRow != null && loaded >= this.infiniteLastRow) return;
    const buffer = this.core.options.infiniteBufferRows;
    if (lastVisibleIndex + buffer < loaded && lastVisibleIndex < loaded) return;
    const blockSize = this.core.options.blockSize;
    const stop = this.infiniteLastRow == null
      ? loaded + blockSize
      : Math.min(this.infiniteLastRow, loaded + blockSize);
    void this.loadBlock(loaded, stop);
  }

  onServerParamsChanged(): Promise<void> {
    return this.reloadInfinite();
  }

  onDatasourceChanged(): Promise<void> {
    this.cancelInfiniteRequest();
    if (this.isInfinite) return this.startInfinite();
    this.infiniteLastRow = null;
    this.setRowData(this.core.options.rowData);
    this.core.bodyRenderer.onDataChanged();
    return Promise.resolve();
  }

  destroy(): void {
    this.cancelInfiniteRequest();
  }

  setRowData(rows: TData[] | null | undefined): void {
    this.core.changeTracker.clear();
    const getRowId = this.core.options.getRowId;
    const childrenKey = this.core.options.childrenKey;
    const next: RowNode<TData>[] = [];
    const roots: RowNode<TData>[] = [];
    const byId = new Map<string, RowNode<TData>>();
    const childIds = new Map<string, string[]>();
    let autoSeq = 0;

    const buildNode = (data: TData, depth: number, parentId: string | null): RowNode<TData> | null => {
      const index = autoSeq++;
      const id = this.resolveRowId(data, index, `auto-${index}`);
      if (byId.has(id)) {
        this.core.reportError(new Error(`Duplicate row id: ${id}`), "rowData", { rowId: id, index });
        return null;
      }
      const node: RowNode<TData> = { id, data, rowIndex: -1, selected: false };
      this.treeDepth.set(node, depth);
      next.push(node);
      byId.set(id, node);
      if (parentId != null) {
        const list = childIds.get(parentId) ?? [];
        list.push(id);
        childIds.set(parentId, list);
      } else {
        roots.push(node);
      }
      const children = this.isTree ? readChildren(data, childrenKey) : undefined;
      if (this.isTree && Array.isArray(children)) {
        for (const child of children) {
          if (child != null) buildNode(child as TData, depth + 1, id);
        }
      }
      return node;
    };

    (rows ?? []).forEach((data) => {
      if (data != null) buildNode(data, 0, null);
    });

    this.all = next;
    this.roots = roots;
    this.childIds = childIds;
    this.nodesById = byId;
    this.core.undoService.clear();
    for (const id of [...this.expandedIds]) {
      if (!byId.has(id)) this.expandedIds.delete(id);
    }
    if (this.core.options.defaultExpandAll) {
      for (const node of next) {
        if (this.getChildrenCount(node.id) > 0) this.expandedIds.add(node.id);
      }
    }

    this.core.selectionService.onRowsRebuilt(getRowId != null);
    this.refreshPipeline();
  }

  getChildrenIds(id: string): string[] {
    return this.childIds.get(id) ?? [];
  }

  getChildrenCount(id: string): number {
    return this.childIds.get(id)?.length ?? 0;
  }

  hasChildren(id: string): boolean {
    return this.getChildrenCount(id) > 0;
  }

  applyTransaction(transaction: RowTransaction<TData>, refresh = true): void {
    const getRowId = this.core.options.getRowId;
    const touched: RowNode<TData>[] = [];
    const externallyReplacedIds: string[] = [];

    if (transaction.remove?.length) {
      const removeIds = new Set<string>();
      const removeRefs = new Set<TData>();
      const collect = (data: TData) => {
        if (getRowId) {
          const id = this.resolveRowId(data, -1, `__missing_remove_${this.core.nextId()}`);
          const stack = [id];
          while (stack.length > 0) {
            const cur = stack.pop()!;
            if (removeIds.has(cur)) continue;
            removeIds.add(cur);
            for (const childId of this.childIds.get(cur) ?? []) stack.push(childId);
          }
        } else {
          const stack: TData[] = [data];
          while (stack.length > 0) {
            const cur = stack.pop()!;
            removeRefs.add(cur);
            const kids = this.isTree ? readChildren(cur, this.core.options.childrenKey) : undefined;
            if (kids) {
              for (const kid of kids) stack.push(kid as TData);
            }
          }
        }
      };
      transaction.remove.forEach(collect);
      this.all = this.all.filter((node) => {
        const drop = removeIds.has(node.id) || (node.data != null && removeRefs.has(node.data));
        if (drop) {
          externallyReplacedIds.push(node.id);
          this.nodesById.delete(node.id);
          this.childIds.delete(node.id);
        }
        return !drop;
      });
      const remaining = new Set(this.all);
      this.roots = this.roots.filter((node) => remaining.has(node));
    }

    if (transaction.update?.length) {
      for (const data of transaction.update) {
        let node: RowNode<TData> | undefined;
        if (getRowId) {
          node = this.nodesById.get(this.resolveRowId(data, -1, `__missing_update_${this.core.nextId()}`));
        } else {
          node = this.all.find((n) => n.data === data);
        }
        if (node) {
          node.data = data;
          externallyReplacedIds.push(node.id);
          this.core.bodyRenderer.invalidateRowHeight(node);
          touched.push(node);
        }
      }
    }

    if (transaction.add?.length) {
      const startIndex = transaction.addIndex != null ? Math.max(0, Math.min(transaction.addIndex, this.roots.length)) : this.roots.length;
      const added: RowNode<TData>[] = [];
      transaction.add.forEach((data, i) => {
        const id = this.resolveRowId(data, startIndex + i, `add-${this.core.nextId()}`);
        if (this.nodesById.has(id)) {
          this.core.reportError(new Error(`Duplicate row id: ${id}`), "transaction.add", { rowId: id });
          return;
        }
        const node: RowNode<TData> = { id, data, rowIndex: -1, selected: false };
        this.nodesById.set(id, node);
        this.treeDepth.set(node, 0);
        const children = this.isTree ? readChildren(data, this.core.options.childrenKey) : undefined;
        if (children) {
          for (const child of children) {
            if (child != null) this.buildChildNodes(node, child as TData, 1);
          }
        }
        added.push(node);
      });
      this.roots.splice(startIndex, 0, ...added);
      this.reindexAll();
    }

    if (refresh) {
      this.refreshPipeline();
      for (const node of touched) {
        if (node.rowIndex >= 0) this.core.bodyRenderer.refreshRows([node.rowIndex]);
      }
    }
    this.core.changeTracker.clearRows(externallyReplacedIds);
  }

  applyTransactions(transactions: readonly RowTransaction<TData>[]): void {
    if (transactions.length === 0) return;
    for (const transaction of transactions) this.applyTransaction(transaction, false);
    this.refreshPipeline();
  }

  private buildChildNodes(parent: RowNode<TData>, data: TData, depth: number): void {
    const id = this.resolveRowId(data, -1, `add-${this.core.nextId()}`);
    if (this.nodesById.has(id)) {
      this.core.reportError(new Error(`Duplicate row id: ${id}`), "transaction.add", { rowId: id });
      return;
    }
    const child: RowNode<TData> = {
      id,
      data,
      rowIndex: -1,
      selected: false
    };
    this.nodesById.set(id, child);
    this.treeDepth.set(child, depth);
    const list = this.childIds.get(parent.id) ?? [];
    list.push(child.id);
    this.childIds.set(parent.id, list);
    const children = readChildren(data, this.core.options.childrenKey);
    if (!children) return;
    for (const nested of children) {
      if (nested != null) this.buildChildNodes(child, nested as TData, depth + 1);
    }
  }

  private reindexAll(): void {
    this.all = [];
    const walk = (node: RowNode<TData>) => {
      this.all.push(node);
      if (!this.nodesById.has(node.id)) this.nodesById.set(node.id, node);
      for (const childId of this.childIds.get(node.id) ?? []) {
        const child = this.nodesById.get(childId);
        if (child) walk(child);
      }
    };
    for (const root of this.roots) walk(root);
  }

  setFilterModel(filterModel: FilterModel | null): boolean {
    const before = JSON.stringify(this.filterModel);
    this.filterModel = filterModel ? { ...filterModel } : {};
    return JSON.stringify(this.filterModel) !== before;
  }

  getFilterModel(): FilterModel {
    return { ...this.filterModel };
  }

  setQuickFilter(text: string | null | undefined): boolean {
    const next = text != null && text.trim() !== "" ? text : null;
    if (next === this.quickFilter) return false;
    this.quickFilter = next;
    return true;
  }

  getQuickFilter(): string | null {
    return this.quickFilter;
  }

  isFilterPresent(): boolean {
    return Object.keys(this.filterModel).length > 0 || this.quickFilter != null;
  }

  refreshPipeline(): void {
    const columns = this.core.columnModel.getOrderedVisible();
    const getCellValue = (node: RowNode<any>, column: ColumnLike) => this.core.getCellValue(node, column);

    if (this.isInfinite) {
      this.all.forEach((node, index) => {
        node.rowIndex = index;
        this.rowSequence.set(node, index + 1);
      });
      this.displayed = this.all;
      this.pipelineRows = this.all;
      this.spanInfo.clear();
      this.core.emit("modelUpdated", { rowCount: this.all.length });
      return;
    }

    let rows: RowNode<TData>[];

    if (this.isTree) {
      rows = this.buildTreeDisplay(columns, getCellValue);
    } else {
      rows = this.all;
      const filteringLocally = this.isFilterPresent() && !this.core.options.manualFiltering;
      if (filteringLocally) {
        rows = rows.filter((node) => doesNodePassFilters(node, columns, this.filterModel, this.quickFilter, getCellValue));
      }
      const sortModel = this.core.columnModel.getSortModel();
      if (sortModel.length > 0 && !this.core.options.manualSorting) {
        try {
          rows = sortNodes(rows, sortModel, columns, getCellValue);
        } catch (error) {
          this.core.reportError(error, "comparator", { sortModel });
        }
      }

      const groupCols = this.core.columnModel.getRowGroupColumns();
      if (groupCols.length > 0) {
        rows = this.buildGrouped(rows, groupCols);
      } else if (this.core.options.masterDetail) {
        const withDetails: RowNode<TData>[] = [];
        for (const node of rows) {
          withDetails.push(node);
          if (this.expandedIds.has(node.id) && this.isRowExpandable(node)) {
            withDetails.push({
              id: `__detail__${node.id}`,
              data: node.data,
              rowIndex: -1,
              selected: false,
              isDetail: true,
              masterId: node.id
            });
          }
        }
        rows = withDetails;
      }
    }

    for (const node of this.all) node.rowIndex = -1;

    let seq = 0;
    rows.forEach((node, index) => {
      node.rowIndex = index;
      if (!node.isDetail && !node.isGroup) {
        seq++;
        this.rowSequence.set(node, seq);
      }
    });
    this.pipelineRows = rows;
    this.applyPagination();

    this.computeSpans(getCellValue);
    this.core.emit("modelUpdated", { rowCount: rows.length });
  }

  private pipelineRows: RowNode<TData>[] = [];
  private page = 1;
  private pageSize = 20;

  get paginationActive(): boolean {
    return this.core.options.paginationEnabled && !this.isInfinite;
  }

  private applyPagination(): void {
    if (!this.paginationActive) {
      this.displayed = this.pipelineRows;
      return;
    }
    const size = this.effectivePageSize();
    const pageCount = this.getPageCount();
    if (this.page > pageCount) this.page = pageCount;
    if (this.page < 1) this.page = 1;
    this.core.options.paginationPage = this.page;
    if (this.core.options.paginationMode === "server") {
      this.pipelineRows.forEach((node, index) => {
        node.rowIndex = index;
      });
      this.displayed = this.pipelineRows;
      return;
    }
    const start = (this.page - 1) * size;
    const slice = this.pipelineRows.slice(start, start + size);
    slice.forEach((node, index) => {
      node.rowIndex = index;
    });
    this.displayed = slice;
  }

  private effectivePageSize(): number {
    this.pageSize = this.core.options.paginationPageSize;
    return Math.max(1, this.pageSize);
  }

  getCurrentPage(): number {
    return this.paginationActive ? this.page : 1;
  }

  getTotalRowCount(): number {
    if (this.isInfinite) return this.getDisplayTotalCount();
    if (this.paginationActive && this.core.options.paginationMode === "server") {
      return this.core.options.paginationTotal;
    }
    return this.pipelineRows.length;
  }

  getPageCount(): number {
    if (!this.paginationActive) return 1;
    return Math.max(1, Math.ceil(this.getTotalRowCount() / this.effectivePageSize()));
  }

  getPipelineRows(): RowNode<TData>[] {
    return this.pipelineRows;
  }

  setPage(page: number, silent = false): void {
    if (!this.paginationActive) return;
    const pageCount = this.getPageCount();
    const next = Math.max(1, Math.min(Math.round(page) || 1, pageCount));
    if (next === this.page) return;
    this.page = next;
    this.core.options.paginationPage = next;
    this.applyPagination();
    this.core.bodyRenderer.onDataChanged();
    this.core.bodyRenderer.scrollToIndex(0, "top");
    if (!silent) this.emitPaginationChanged();
  }

  setPageSize(size: number): void {
    if (!this.paginationActive) return;
    const next = Math.max(1, Math.round(size) || this.effectivePageSize());
    const firstVisible = (this.page - 1) * this.effectivePageSize();
    this.core.options.paginationPageSize = next;
    this.pageSize = next;
    this.page = Math.floor(firstVisible / next) + 1;
    this.core.options.paginationPage = this.page;
    this.applyPagination();
    this.core.bodyRenderer.onDataChanged();
    this.emitPaginationChanged();
  }

  restorePagination(page: number, pageSize: number): void {
    this.pageSize = Math.max(1, Math.round(pageSize) || 1);
    this.core.options.paginationPageSize = this.pageSize;
    this.page = Math.max(1, Math.round(page) || 1);
    this.core.options.paginationPage = this.page;
  }

  setPaginationEnabled(enabled: boolean): void {
    if (this.core.options.paginationEnabled === enabled) return;
    this.core.options.paginationEnabled = enabled && !this.isInfinite;
    if (this.core.options.paginationEnabled) this.page = 1;
    this.applyPagination();
    this.core.bodyRenderer.onDataChanged();
    this.emitPaginationChanged();
  }

  onPaginationOptionsChanged(): void {
    if (!this.paginationActive) return;
    this.page = this.core.options.paginationMode === "server"
      ? this.core.options.paginationPage
      : 1;
    this.applyPagination();
    this.core.bodyRenderer.onDataChanged();
    this.emitPaginationChanged();
  }

  private emitPaginationChanged(): void {
    this.core.emit("paginationChanged", {
      page: this.getCurrentPage(),
      pageSize: this.effectivePageSize(),
      pageCount: this.getPageCount(),
      total: this.getTotalRowCount()
    });
  }

  private buildTreeDisplay(
    columns: ColumnLike[],
    getCellValue: (node: RowNode<any>, column: ColumnLike) => any
  ): RowNode<TData>[] {
    const sortModel = this.core.options.manualSorting ? [] : this.core.columnModel.getSortModel();
    const passCache = new Map<string, boolean>();
    const filterPresent = this.isFilterPresent() && !this.core.options.manualFiltering;

    const nodePasses = (node: RowNode<TData>): boolean => {
      const cached = passCache.get(node.id);
      if (cached !== undefined) return cached;
      let pass = true;
      if (filterPresent) {
        pass = doesNodePassFilters(node, columns, this.filterModel, this.quickFilter, getCellValue);
        for (const childId of this.childIds.get(node.id) ?? []) {
          const child = this.nodesById.get(childId);
          if (child && nodePasses(child)) pass = true;
        }
      }
      passCache.set(node.id, pass);
      return pass;
    };

    const out: RowNode<TData>[] = [];
    const walk = (nodes: RowNode<TData>[]) => {
      let ordered = nodes;
      if (sortModel.length > 0) {
        ordered = sortNodes(nodes, sortModel, columns, getCellValue);
      }
      for (const node of ordered) {
        if (!nodePasses(node)) continue;
        out.push(node);
        if (this.expandedIds.has(node.id)) {
          const childNodes = (this.childIds.get(node.id) ?? [])
            .map((id) => this.nodesById.get(id))
            .filter((n): n is RowNode<TData> => n != null);
          walk(childNodes);
        }
      }
    };
    walk(this.roots);
    return out;
  }

  private computeSpans(getCellValue: (node: RowNode<any>, column: ColumnLike) => any): void {
    this.spanInfo.clear();
    if (this.isTree) return;
    if (this.core.options.masterDetail) return;
    if (this.core.columnModel.getRowGroupColumns().length > 0) return;

    const spanColumns = this.core.columnModel.getOrderedVisible().filter(
      (c) => c.colDef.rowSpan != null || c.colDef.autoRowSpan === true
    );
    if (spanColumns.length === 0) return;

    const masters = this.mastersBuf;
    let m = 0;
    for (const node of this.displayed) {
      if (!node.isDetail && !node.isGroup) masters[m++] = node;
    }
    masters.length = m;
    const n = m;
    if (n === 0) return;

    for (const col of spanColumns) {
      const arr = new Int32Array(n);
      let i = 0;
      while (i < n) {
        const node = masters[i];
        const value = getCellValue(node, col);
        let span = 1;
        if (col.colDef.rowSpan) {
          try {
            const out = col.colDef.rowSpan({
              api: this.core.getApi(),
              colDef: col.colDef,
              column: col,
              node,
              data: node.data,
              value,
              rowIndex: node.rowIndex
            });
            span = Math.max(1, Math.min(Math.round(out) || 1, n - i));
          } catch (error) {
            this.core.reportError(error, "rowSpan", { colId: col.id, rowId: node.id });
          }
        } else if (col.colDef.autoRowSpan) {
          while (
            i + span < n &&
            value != null &&
            value !== "" &&
            defaultComparator(value, getCellValue(masters[i + span], col)) === 0
          ) {
            span++;
          }
        }
        arr[i] = span;
        for (let k = 1; k < span; k++) arr[i + k] = -1;
        i += span;
      }
      this.spanInfo.set(col.id, arr);
    }
  }

  getSpanInfo(colId: string): Int32Array | undefined {
    return this.spanInfo.get(colId);
  }

  getRowSeq(node: RowNode<TData>): number {
    return this.rowSequence.get(node) ?? 0;
  }

  getTreeDepth(node: RowNode<TData>): number {
    return this.treeDepth.get(node) ?? 0;
  }

  private buildGrouped(rows: RowNode<TData>[], groupCols: ColumnLike[]): RowNode<TData>[] {
    const aggResolve = createAggResolver(this.core.options.aggFuncs);
    const aggCols = this.core.columnModel.getAggColumns();
    this.knownGroupIds = [];

    const computeAgg = (leaves: RowNode<TData>[]): Record<string, any> => {
      const values: Record<string, any> = {};
      for (const col of aggCols) {
        const fn = aggResolve(col.colDef.aggFunc!);
        if (!fn) continue;
        try {
          values[col.id] = fn(leaves.map((leaf) => this.core.getCellValue(leaf, col)));
        } catch (error) {
          this.core.reportError(error, "aggFunc", { colId: col.id, aggFunc: col.colDef.aggFunc });
          values[col.id] = null;
        }
      }
      return values;
    };

    const build = (
      nodes: RowNode<TData>[],
      level: number,
      parentPath: string
    ): { display: RowNode<TData>[]; leaves: RowNode<TData>[] } => {
      if (level >= groupCols.length) {
        return { display: nodes, leaves: nodes };
      }
      const col = groupCols[level];
      const groups = new Map<string, RowNode<TData>[]>();
      const order: string[] = [];
      for (const node of nodes) {
        const raw = this.core.getCellValue(node, col);
        const key = raw == null ? "(空)" : String(raw);
        let bucket = groups.get(key);
        if (!bucket) {
          bucket = [];
          groups.set(key, bucket);
          order.push(key);
        }
        bucket.push(node);
      }
      order.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

      const display: RowNode<TData>[] = [];
      const leaves: RowNode<TData>[] = [];
      for (const key of order) {
        const children = groups.get(key)!;
        const groupId = `${parentPath}/g${level}:${key}`;
        this.knownGroupIds.push(groupId);
        const child = build(children, level + 1, groupId);
        const groupNode: RowNode<TData> = {
          id: groupId,
          data: null,
          rowIndex: -1,
          selected: false,
          isGroup: true,
          groupLevel: level,
          groupKey: key,
          leafNodes: child.leaves,
          aggValues: computeAgg(child.leaves)
        };
        display.push(groupNode);
        if (this.groupExpandedIds.has(groupId)) {
          display.push(...child.display);
        }
        leaves.push(...child.leaves);
      }
      return { display, leaves };
    };

    return build(rows, 0, "").display;
  }

  isRowExpandable(node: RowNode<TData>): boolean {
    if (this.isTree) return this.hasChildren(node.id);
    if (!this.core.options.masterDetail) return false;
    const check = this.core.options.isRowExpandable;
    if (check) {
      try {
        return check({ data: node.data, node, api: this.core.getApi() });
      } catch (error) {
        this.core.reportError(error, "isRowExpandable", { rowId: node.id });
        return false;
      }
    }
    return true;
  }

  isRowExpanded(id: string): boolean {
    return this.expandedIds.has(id);
  }

  getExpandedRowIds(): string[] {
    return [...this.expandedIds];
  }

  getExpandedGroupIds(): string[] {
    return [...this.groupExpandedIds];
  }

  restoreExpansion(rowIds: readonly string[], groupIds: readonly string[]): void {
    this.expandedIds = new Set(rowIds.filter((id) => this.nodesById.has(id)));
    this.groupExpandedIds = new Set(groupIds);
  }

  expandRow(id: string): boolean {
    return this.setDetailExpanded(id, true);
  }

  collapseRow(id: string): boolean {
    return this.setDetailExpanded(id, false);
  }

  toggleDetail(id: string): boolean {
    return this.setDetailExpanded(id, !this.expandedIds.has(id));
  }

  private setDetailExpanded(id: string, expanded: boolean): boolean {
    const node = this.nodesById.get(id);
    if (!node || !this.isRowExpandable(node)) return expanded;
    if (expanded === this.expandedIds.has(id)) return expanded;
    if (expanded) this.expandedIds.add(id);
    else this.expandedIds.delete(id);
    this.refreshPipeline();
    this.core.bodyRenderer.onDataChanged();
    this.core.emit("detailToggled", { rowId: id, rowNode: node, expanded });
    return expanded;
  }

  expandAllDetails(): void {
    let changed = false;
    for (const node of this.all) {
      if (!this.expandedIds.has(node.id) && this.isRowExpandable(node)) {
        this.expandedIds.add(node.id);
        changed = true;
      }
    }
    if (changed) {
      this.refreshPipeline();
      this.core.bodyRenderer.onDataChanged();
    }
  }

  collapseAllDetails(): void {
    if (this.expandedIds.size === 0) return;
    this.expandedIds.clear();
    this.refreshPipeline();
    this.core.bodyRenderer.onDataChanged();
  }

  toggleGroup(groupId: string): boolean {
    return this.setGroupExpanded(groupId, !this.groupExpandedIds.has(groupId));
  }

  isGroupExpanded(groupId: string): boolean {
    return this.groupExpandedIds.has(groupId);
  }

  getGroupNode(groupId: string): RowNode<TData> | undefined {
    return this.displayed.find((n) => n.isGroup && n.id === groupId);
  }

  expandAllGroups(): void {
    if (this.knownGroupIds.length === 0) return;
    let changed = false;
    for (const id of this.knownGroupIds) {
      if (!this.groupExpandedIds.has(id)) {
        this.groupExpandedIds.add(id);
        changed = true;
      }
    }
    if (changed) {
      this.refreshPipeline();
      this.core.bodyRenderer.onDataChanged();
    }
  }

  collapseAllGroups(): void {
    if (this.groupExpandedIds.size === 0) return;
    this.groupExpandedIds.clear();
    this.refreshPipeline();
    this.core.bodyRenderer.onDataChanged();
  }

  private setGroupExpanded(groupId: string, expanded: boolean): boolean {
    if (!this.knownGroupIds.includes(groupId)) return expanded;
    if (expanded === this.groupExpandedIds.has(groupId)) return expanded;
    if (expanded) this.groupExpandedIds.add(groupId);
    else this.groupExpandedIds.delete(groupId);
    this.refreshPipeline();
    this.core.bodyRenderer.onDataChanged();
    return expanded;
  }

  reorderRowsByDisplayed(fromIndex: number, toIndex: number): boolean {
    if (this.isTree) return false;
    const fromNode = this.getDisplayedRow(fromIndex);
    const toNode = this.getDisplayedRow(toIndex);
    if (!fromNode || !toNode || fromNode.isDetail || toNode.isDetail || fromNode.isGroup || toNode.isGroup) return false;

    const fromAllIdx = this.all.indexOf(fromNode);
    let toAllIdx = this.all.indexOf(toNode);
    if (fromAllIdx < 0 || toAllIdx < 0) return false;
    if (toAllIdx > fromAllIdx) {
      let idx = toAllIdx;
      while (idx + 1 < this.all.length && this.all[idx + 1].isDetail) idx++;
      toAllIdx = idx;
    }
    if (fromAllIdx === toAllIdx) return false;

    this.all.splice(fromAllIdx, 1);
    const insertAt = this.all.indexOf(toNode);
    this.all.splice(toAllIdx > fromAllIdx ? insertAt + 1 : insertAt, 0, fromNode);
    this.refreshPipeline();
    this.core.bodyRenderer.onDataChanged();
    return true;
  }

  getAllNodes(): RowNode<TData>[] {
    return this.all;
  }

  getRootNodes(): RowNode<TData>[] {
    return this.roots;
  }

  getDisplayedRows(): RowNode<TData>[] {
    return this.displayed;
  }

  getDisplayedRowCount(): number {
    return this.displayed.length;
  }

  getDisplayedRow(index: number): RowNode<TData> | undefined {
    return this.displayed[index];
  }

  getNodeById(id: string): RowNode<TData> | undefined {
    return this.nodesById.get(id);
  }

  forEachNode(callback: (node: RowNode<TData>, index: number) => void): void {
    this.all.forEach(callback);
  }

  forEachNodeAfterFilterAndSort(callback: (node: RowNode<TData>, index: number) => void): void {
    let index = 0;
    for (const node of this.pipelineRows) {
      if (node.isDetail || node.isGroup) continue;
      callback(node, index++);
    }
  }
}
