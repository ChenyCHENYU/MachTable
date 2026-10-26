import type { GridCore } from "../core/gridCore";
import type { RowDragIntent } from "../types/events";
import type { RowNode } from "../types/row";
import { clamp } from "../lib/dom";
import { DEFAULT_LOCALE, formatTwo } from "../lib/locale";
import { getGridRowDragFactory } from "../lib/adapterLifecycle";
import type { RowDragDriver, RowDragDriverFactory, RowDragGuard } from "../lib/rowDragDriver";
import { RowDragSurface, type SurfaceDrop } from "./rowDragSurface";
import { singleRowDragIntent } from "./rowDragIntent";

type Context = Pick<GridCore<any>, "emit" | "api" | "reportError" | "gridOptions" | "rowModel" | "skeleton" | "columnModel" | "editingService">;
interface Scope { node: RowNode; from: number; guard: RowDragGuard }
interface Drop extends SurfaceDrop { node: RowNode; intent?: RowDragIntent }

/** Core owns its compact single-row behavior; optional ordering supplies an internal driver. */
/** @internal The row drag facade exposes intents and events, not controller instances. */
export class RowDragController extends RowDragSurface {
  private scope: Scope | null = null;
  private driver: RowDragDriver | undefined;
  private factory: RowDragDriverFactory | undefined;
  constructor(private core: Context, getRowTop: (index: number) => number, findRowAt: (offset: number) => number, scrollBy: (delta: number) => boolean) {
    super({ get root() { return core.skeleton.root; }, get body() { return core.skeleton.bodyEl; }, get viewport() { return core.skeleton.bodyViewports.center; },
      get containers() { return Object.values(core.skeleton.rowContainers); }, getRowTop, findRowAt, scrollBy });
  }
  private isLoadedRow(node: RowNode): boolean { return !node.loading && !node.treeLoading && !node.isGroup; }
  dragDecision(node: RowNode): boolean | string {
    if (this.core.editingService.isEditing() || node.isDetail || !this.isLoadedRow(node) || node.data == null) return false;
    if (this.core.columnModel.getRowGroupColumns().length || (this.core.gridOptions.applyRowDrag && !this.core.rowModel.canReorderRows())) return false;
    const allowed = this.attempt("canDrag", () => this.core.gridOptions.rowDragPolicy?.canDrag?.({ node, api: this.core.api }) ?? true, false);
    if (allowed !== true) return allowed;
    return !this.core.rowModel.isTree || Boolean(getGridRowDragFactory(this.core.api));
  }
  canDrag(node: RowNode): boolean { return this.dragDecision(node) === true; }
  isSource(node: RowNode): boolean { return this.getDriver()?.isSource(node) ?? this.draggingSource(node.id); }
  start(event: PointerEvent, node: RowNode): void {
    this.destroy();
    if (!this.canDrag(node) || event.isPrimary === false) return;
    const driver = this.getDriver();
    if (driver) { driver.start(event, node); return; }
    const guard = this.attempt("getRevision", () => this.captureGuard(node), null);
    if (!guard) return;
    this.scope = { node, from: node.rowIndex, guard };
    this.begin(event);
  }
  moveWithKeyboard(event: KeyboardEvent, node: RowNode): void {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault(); event.stopPropagation();
    if (!this.canDrag(node)) return;
    const driver = this.getDriver();
    if (driver) { driver.moveWithKeyboard(event, node); return; }
    const direction = event.key === "ArrowUp" ? -1 : 1;
    let index = node.rowIndex + direction;
    while (this.core.rowModel.getDisplayedRow(index)?.isDetail) index += direction;
    const target = this.core.rowModel.getDisplayedRow(index);
    const guard = this.attempt("getRevision", () => this.captureGuard(node), null);
    if (!target || !guard) return;
    this.scope = { node, from: node.rowIndex, guard };
    try { if (this.commitDrop(this.destination(target, direction > 0))) this.focusHandle(node.id); }
    finally { this.release(); }
  }
  private attempt<T>(source: string, call: () => T, fallback: T): T {
    try { return call(); } catch (error) { this.core.reportError(error, `rowDragPolicy.${source}`); return fallback; }
  }
  private captureGuard(node: RowNode): RowDragGuard {
    const model = this.core.rowModel, columns = this.core.columnModel.getColumns(), policy = this.core.gridOptions.rowDragPolicy;
    const version = model.getDataRevision(), view = model.getDisplayRevision(), managed = this.core.gridOptions.applyRowDrag;
    const revision = policy?.getRevision?.();
    return { revision, current: () => this.attempt("getRevision", () => policy?.getRevision?.() === revision && version === model.getDataRevision() && view === model.getDisplayRevision() &&
      model.getNodeById(node.id) === node && columns === this.core.columnModel.getColumns() && policy === this.core.gridOptions.rowDragPolicy && managed === this.core.gridOptions.applyRowDrag, false) };
  }
  private getDriver(): RowDragDriver | undefined {
    const factory = getGridRowDragFactory(this.core.api);
    if (factory !== this.factory) {
      this.driver?.destroy(); this.factory = factory;
      this.driver = factory ? this.attempt("driver", () => factory({ ...this.host, api: this.core.api, capture: node => this.captureGuard(node),
        emit: (node, from, boundary, targetIndex, intent) => { this.core.emit("rowDragEnd", { rowNode: node, fromIndex: from, toIndex: boundary, targetIndex, applied: false, intent }); },
        report: (error, source) => this.core.reportError(error, `rowDragPolicy.${source}`) }), undefined) : undefined;
    }
    return this.driver;
  }
  protected current(): boolean { return this.scope?.guard.current() ?? false; }
  protected release(): void { this.scope = null; }
  protected sourceContains(id: string): boolean { return this.scope?.node.id === id; }
  protected outsideText(): string { return this.core.gridOptions.locale.rowDragOutside ?? DEFAULT_LOCALE.rowDragOutside; }
  protected describe(y: number): Drop | null {
    const index = clamp(this.host.findRowAt(y), 0, this.core.rowModel.getDisplayedRowCount() - 1);
    let node = this.core.rowModel.getDisplayedRow(index);
    if (node?.isDetail) node = this.core.rowModel.getNodeById(node.masterId!);
    if (!node) return null;
    const top = this.host.getRowTop(node.rowIndex), bottom = this.host.getRowTop(node.rowIndex + 1);
    return this.destination(node, y >= (top + bottom) / 2);
  }
  private destination(node: RowNode, after: boolean): Drop {
    const scope = this.scope!;
    let boundary = node.rowIndex + Number(after);
    while (this.core.rowModel.getDisplayedRow(boundary)?.isDetail) boundary++;
    const policy = this.core.gridOptions.rowDragPolicy;
    const intent = !this.core.gridOptions.applyRowDrag || policy?.canDrop ? singleRowDragIntent(scope.node, index => this.core.rowModel.getDisplayedRow(index), node, after ? "after" : "before", scope.guard.revision) : undefined;
    const allowed = policy?.canDrop && intent ? this.attempt("canDrop", () => policy.canDrop!({ node: scope.node, api: this.core.api, targetNode: node, intent }), false) : true;
    const valid = allowed === true && this.isLoadedRow(node);
    const text = typeof allowed === "string" ? allowed : formatTwo(this.core.gridOptions.locale.rowDragPosition ?? DEFAULT_LOCALE.rowDragPosition, scope.from + 1, this.finalIndex(scope.from, boundary) + 1);
    return { node, intent, boundary, valid, text, position: after ? "after" : "before" };
  }
  protected commitDrop(drop: SurfaceDrop): boolean {
    const scope = this.scope;
    if (!scope || !this.current() || !this.canDrag(scope.node) || !this.current()) return false;
    const target = this.destination((drop as Drop).node, drop.boundary > (drop as Drop).node.rowIndex);
    if (!target.valid || !this.current()) return false;
    let index = target.boundary > scope.from ? target.boundary - 1 : target.boundary;
    while (this.core.rowModel.getDisplayedRow(index)?.isDetail) index--;
    if (scope.from === index) return false;
    const applied = this.core.gridOptions.applyRowDrag && this.core.rowModel.reorderRowsByDisplayed(scope.from, index);
    if (this.core.gridOptions.applyRowDrag && !applied) return false;
    this.core.emit("rowDragEnd", { rowNode: scope.node, fromIndex: scope.from, toIndex: target.boundary, targetIndex: applied ? scope.node.rowIndex : this.finalIndex(scope.from, target.boundary), applied, intent: target.intent });
    return true;
  }
  private finalIndex(from: number, boundary: number): number {
    let end = from + 1;
    while (this.core.rowModel.getDisplayedRow(end)?.isDetail) end++;
    return boundary > from ? boundary - (end - from) : boundary;
  }
  override destroy(): void { this.driver?.destroy(); super.destroy(); }
}
