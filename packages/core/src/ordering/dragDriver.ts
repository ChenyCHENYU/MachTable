import { clamp } from "../lib/dom";
import type { RowDragDriver, RowDragDriverHost, RowDragGuard } from "../lib/rowDragDriver";
import { RowDragSurface, type SurfaceDrop } from "../services/rowDragSurface";
import type { RowNode } from "../types/row";
import type { RowDragIntent } from "../types/events";
import type { OrderDragSession } from "./dragSession";

interface Scope { node: RowNode; from: number; guard: RowDragGuard; session: OrderDragSession<any>; sourceDecision: boolean | string; failed: boolean }
interface Drop extends SurfaceDrop { node: RowNode; fraction: number; intent?: RowDragIntent; toIndex?: number; targetIndex?: number }

/** Optional multi-row/tree behavior shares the native gesture surface with ordinary Core drags. */
export class OrderingDragDriver extends RowDragSurface implements RowDragDriver {
  private scope: Scope | null = null;
  private keyboardMove = false;
  constructor(private bridge: RowDragDriverHost, private prepare: (node: RowNode) => OrderDragSession<any>, private requestFocus: (intent: RowDragIntent, restore: (canFocus: () => boolean) => void) => void) { super(bridge); }
  private attempt<T>(source: string, call: () => T, fallback: T): T {
    try { return call(); } catch (error) { if (this.scope) this.scope.failed = true; this.bridge.report(error, source); return fallback; }
  }
  private createScope(node: RowNode): Scope | null {
    return this.attempt("prepare", () => {
      const guard = this.bridge.capture(node);
      const session = this.prepare(node);
      this.scope = { node, from: node.rowIndex, guard, session, sourceDecision: true, failed: false };
      this.scope.sourceDecision = session.validate();
      return this.scope;
    }, null);
  }
  start(event: PointerEvent, node: RowNode): void {
    this.destroy();
    if (this.createScope(node) && this.current()) this.begin(event);
  }
  moveWithKeyboard(event: KeyboardEvent, node: RowNode): void {
    this.destroy();
    const scope = this.createScope(node);
    if (!scope || !this.current()) return;
    this.keyboardMove = true;
    try {
      const direction = event.key === "ArrowUp" ? -1 : 1;
      const target = this.attempt("keyboardTarget", () => scope.session.keyboardTarget(direction), undefined);
      if (target) this.commitDrop(this.destination(target, direction < 0 ? 0 : 1));
    } finally { this.keyboardMove = false; this.release(); }
  }
  isSource(node: RowNode): boolean { return this.draggingSource(node.id); }
  protected current(): boolean {
    return Boolean(this.scope && !this.scope.failed && this.scope.guard.current() && this.bridge.api.rows.getById(this.scope.node.id) === this.scope.node);
  }
  protected sourceContains(id: string): boolean { return this.attempt("isSource", () => this.scope?.session.isSource(id) ?? false, false); }
  protected release(): void { this.scope = null; }
  protected outsideText(): string { return this.bridge.api.getOption("locale")?.rowDragOutside ?? "移回表格内放置 · Esc 取消"; }
  protected describe(y: number): Drop | null {
    const api = this.bridge.api;
    const index = clamp(this.host.findRowAt(y), 0, api.rows.getCount() - 1);
    let node = api.rows.getAt(index);
    if (node?.isDetail) node = api.rows.getById(node.masterId!);
    if (!node) return null;
    const top = this.host.getRowTop(node.rowIndex), height = this.host.getRowTop(node.rowIndex + 1) - top;
    return this.destination(node, (y - top) / Math.max(1, height));
  }
  private destination(node: RowNode, fraction: number): Drop {
    const scope = this.scope!;
    const position = fraction < .5 ? "before" : "after";
    const height = this.host.getRowTop(node.rowIndex + 1) - this.host.getRowTop(node.rowIndex);
    const result = this.attempt("resolve", () => scope.session.resolve({ targetNode: node, position, fraction, height }), false);
    const rejection = typeof scope.sourceDecision === "string" ? scope.sourceDecision : typeof result === "string" ? result : "此位置不可放置";
    const drop: Drop = { node, fraction, boundary: node.rowIndex, valid: false, text: rejection };
    if (!result || typeof result === "string" || scope.sourceDecision !== true || node.loading || node.treeLoading || node.isGroup) return drop;
    drop.intent = result.intent; drop.position = result.intent.position;
    drop.toIndex = result.toIndex; drop.targetIndex = result.targetIndex;
    drop.boundary = result.indicatorIndex ?? node.rowIndex + Number(result.intent.position === "after");
    drop.style = result.indicatorStyle; drop.text = result.text ?? rejection;
    const allowed = this.attempt("canDrop", () => this.bridge.api.getOption("rowDragPolicy")?.canDrop?.({ node: scope.node, api: this.bridge.api, targetNode: node, intent: result.intent }) ?? true, false);
    drop.valid = allowed === true;
    if (typeof allowed === "string") drop.text = allowed;
    return drop;
  }
  protected commitDrop(input: SurfaceDrop): boolean {
    const scope = this.scope;
    if (!scope || !this.current() || this.attempt("validate", () => scope.session.validate(), false) !== true || !this.current()) return false;
    const drop = this.destination((input as Drop).node, (input as Drop).fraction);
    if (!drop.valid || !drop.intent || !this.current()) return false;
    if (this.keyboardMove) this.requestFocus(drop.intent, canFocus => this.focusHandle(scope.node.id, canFocus));
    this.bridge.emit(scope.node, scope.from, drop.toIndex!, drop.targetIndex!, drop.intent);
    return true;
  }
}
