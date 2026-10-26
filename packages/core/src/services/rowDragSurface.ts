import { clamp, el } from "../lib/dom";

export interface RowDragSurfaceHost {
  root: HTMLElement;
  body: HTMLElement;
  viewport: HTMLElement;
  containers: readonly HTMLElement[];
  getRowTop(index: number): number;
  findRowAt(offset: number): number;
  scrollBy?(delta: number): boolean;
}
export interface SurfaceDrop { boundary: number; valid: boolean; text: string; style?: string; position?: string }
interface SurfaceState {
  startY: number; clientX: number; clientY: number; pointerId: number;
  indicators: HTMLElement[]; preview: HTMLElement; drop: SurfaceDrop | null; active: boolean;
}

/** Shared native gesture ownership; default and optional ordering supply only their drop behavior. */
/** @internal Each bundle owns its complete drag driver and surface hierarchy. */
export abstract class RowDragSurface {
  private drag: SurfaceState | null = null;
  private moveRaf = 0;
  private focusRaf = 0;
  constructor(protected readonly host: RowDragSurfaceHost) {}
  protected abstract current(): boolean;
  protected abstract describe(y: number): SurfaceDrop | null;
  protected abstract commitDrop(drop: SurfaceDrop): boolean;
  protected abstract sourceContains(id: string): boolean;
  protected abstract outsideText(): string;
  protected abstract release(): void;

  protected begin(event: PointerEvent): void {
    const indicators = this.host.containers.map(container => {
      const indicator = el("div", "mach-row-drop-indicator"); indicator.hidden = true; container.append(indicator); return indicator;
    });
    const preview = el("div", "mach-row-drag-preview");
    preview.setAttribute("role", "status"); preview.hidden = true; this.host.root.append(preview);
    this.drag = { startY: event.clientY, clientX: event.clientX, clientY: event.clientY, pointerId: event.pointerId, indicators, preview, drop: null, active: false };
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onCancel);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("blur", this.onCancel);
  }

  protected draggingSource(id: string): boolean { return this.drag?.active === true && this.sourceContains(id); }
  protected focusHandle(id: string, canFocus = () => true): void {
    this.focusRaf = requestAnimationFrame(() => {
      this.focusRaf = 0;
      if (!canFocus()) return;
      [...this.host.root.querySelectorAll<HTMLElement>(".mach-row-drag-handle")].find(handle => handle.closest<HTMLElement>(".mach-row")?.dataset.id === id)?.focus();
    });
  }
  private onMove = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.clientX = event.clientX; drag.clientY = event.clientY;
    if (!drag.active) {
      if (Math.abs(event.clientY - drag.startY) < 5) return;
      drag.active = true;
      this.host.root.classList.add("mach-root--row-dragging");
      this.host.root.querySelectorAll<HTMLElement>(".mach-row").forEach(row => row.classList.toggle("mach-row--drag-source", this.sourceContains(row.dataset.id ?? "")));
    }
    this.scheduleFrame();
  };
  private scheduleFrame(): void { if (!this.moveRaf) this.moveRaf = requestAnimationFrame(this.onFrame); }
  private onFrame = (): void => {
    this.moveRaf = 0;
    if (!this.drag?.active) return;
    if (!this.current()) { this.destroy(); return; }
    this.updateFeedback();
    if (this.scrollAtEdge()) this.scheduleFrame();
  };
  private isInside(x: number, y: number, margin = 0): boolean {
    const rect = this.host.body.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top - margin && y <= rect.bottom + margin;
  }
  private scrollAtEdge(): boolean {
    const drag = this.drag;
    if (!drag || !this.isInside(drag.clientX, drag.clientY, 28)) return false;
    const viewport = this.host.viewport, rect = viewport.getBoundingClientRect();
    const edge = Math.min(36, rect.height / 3);
    if (edge <= 0) return false;
    const delta = drag.clientY < rect.top + edge ? -Math.ceil(14 * clamp((rect.top + edge - drag.clientY) / edge, 0, 1))
      : Math.ceil(14 * clamp((drag.clientY - rect.bottom + edge) / edge, 0, 1));
    if (this.host.scrollBy) return this.host.scrollBy(delta);
    const previous = viewport.scrollTop;
    viewport.scrollTop = clamp(previous + delta, 0, Math.max(0, viewport.scrollHeight - viewport.clientHeight));
    return viewport.scrollTop !== previous;
  }
  private updateFeedback(): void {
    const drag = this.drag;
    if (!drag?.active) return;
    const y = drag.clientY - this.host.viewport.getBoundingClientRect().top + this.host.viewport.scrollTop;
    const drop = this.describe(y);
    drag.drop = drop;
    const inside = this.isInside(drag.clientX, drag.clientY);
    for (const indicator of drag.indicators) {
      indicator.hidden = !inside || !drop?.valid;
      if (!drop) continue;
      indicator.dataset.dropPosition = drop.position ?? "";
      indicator.style.cssText = drop.style ?? "";
      const height = parseFloat(indicator.parentElement!.style.height);
      const top = Math.min(this.host.getRowTop(drop.boundary), Number.isFinite(height) ? Math.max(0, height - 2) : Infinity);
      indicator.style.transform = `translate3d(0, ${top}px, 0)`;
    }
    const root = this.host.root.getBoundingClientRect();
    drag.preview.hidden = false;
    drag.preview.textContent = inside ? drop?.text ?? this.outsideText() : this.outsideText();
    drag.preview.style.transform = `translate3d(${clamp(drag.clientX - root.left + 16, 8, Math.max(8, root.width - 224))}px, ${clamp(drag.clientY - root.top + 16, 8, Math.max(8, root.height - 48))}px, 0)`;
  }
  private onUp = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.clientX = event.clientX; drag.clientY = event.clientY;
    if (drag.active && this.current()) this.updateFeedback();
    this.takeState();
    try { if (drag.active && drag.drop?.valid && this.isInside(event.clientX, event.clientY) && this.current()) this.commitDrop(drag.drop); }
    finally { this.release(); }
  };
  private onKeyDown = (event: KeyboardEvent): void => { if (event.key === "Escape") { event.preventDefault(); this.destroy(); } };
  private onCancel = (event: Event): void => {
    if (event.type === "pointercancel" && (event as PointerEvent).pointerId !== this.drag?.pointerId) return;
    this.destroy();
  };
  private takeState(): void {
    const drag = this.drag; this.drag = null;
    window.removeEventListener("pointermove", this.onMove); window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onCancel); window.removeEventListener("keydown", this.onKeyDown); window.removeEventListener("blur", this.onCancel);
    cancelAnimationFrame(this.moveRaf); this.moveRaf = 0;
    this.host.root?.classList.remove("mach-root--row-dragging");
    this.host.root?.querySelectorAll(".mach-row--drag-source").forEach(row => row.classList.remove("mach-row--drag-source"));
    drag?.indicators.forEach(indicator => indicator.remove()); drag?.preview.remove();
  }
  destroy(): void { this.takeState(); this.release(); cancelAnimationFrame(this.focusRaf); this.focusRaf = 0; }
}
