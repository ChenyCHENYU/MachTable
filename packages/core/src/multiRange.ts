import type { GridApi } from "./types/api";
import type { GridCellRange } from "./types/events";
import type { GridFeature, GridFeatureContext } from "./types/options";
import { readGridCell, writeGridInput } from "./lib/adapterLifecycle";
import { toTsv } from "./lib/clipboard";

export interface MultiRangeSelection extends GridFeature {
  getRanges(): GridCellRange[];
  setRanges(ranges: readonly GridCellRange[]): void;
  clear(): void;
  getText(): string;
  clearValues(): void;
}

interface RangeSnapshot {
  range: GridCellRange;
  rows: string[];
  columns: string[];
}

const MAX_RANGES = 32;
const MAX_CELLS = 100_000;

function boundedRanges(ranges: RangeSnapshot[]): RangeSnapshot[] {
  const unique = [...new Map(ranges.map(entry => [JSON.stringify(entry.range), entry])).values()];
  if (unique.length > MAX_RANGES) throw new RangeError("At most 32 ranges are supported.");
  if (unique.reduce((count, range) => count + range.rows.length * range.columns.length, 0) > MAX_CELLS) {
    throw new RangeError("A multi-range operation may affect at most 100000 cells.");
  }
  return unique;
}

function visibleColumns(api: GridApi): string[] {
  const items = api.columns.getWorkbenchItems().filter(column => column.visible);
  return ["left", null, "right"].flatMap(pinned => items.filter(column => column.pinned === pinned).map(column => column.colId));
}

/** Ctrl/Cmd adds rectangles; Core keeps owning the active rectangle and fill handle. */
export function createMultiRangeSelection(): MultiRangeSelection {
  return new MultiRangeController();
}

class MultiRangeController implements MultiRangeSelection {
  readonly key = "multi-range";
  private context: GridFeatureContext | null = null;
  private saved: RangeSnapshot[] = [];
  private raf = 0;
  private paintCleanup: (() => void) | null = null;

  setup(context: GridFeatureContext): void {
    if (this.context) throw new Error("Create a separate multi-range feature for each grid.");
    if (!context.api.getOption("enableRangeSelection")) throw new Error("Multi-range selection requires enableRangeSelection: true.");
    this.context = context;
    let observer: MutationObserver | null = null;
    // Register ownership before acquiring browser resources, including when
    // observe() fails during feature setup.
    context.onCleanup(() => {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      try { observer?.disconnect(); } finally {
        this.clearPaint();
        this.saved = [];
        if (this.context === context) this.context = null;
      }
    });
    const { root } = context;
    const listen = (type: string, handler: (event: Event) => void) => {
      context.addManagedDomListener(root, type, event => {
        try { handler(event); } catch (error) {
          event.preventDefault();
          event.stopImmediatePropagation();
          context.reportError(error, "multi-range");
        }
      }, true);
    };
    listen("mousedown", event => this.onPointer(event as MouseEvent));
    listen("keydown", event => this.onKey(event as KeyboardEvent));
    listen("copy", event => this.onCopy(event as ClipboardEvent));
    listen("cut", event => this.onCopy(event as ClipboardEvent, true));
    context.addEventListener("rangeSelectionChanged", () => this.schedulePaint());
    // View geometry changes reuse row elements without a model update.
    observer = new MutationObserver(() => this.schedulePaint());
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-id", "data-col-id"] });
    context.addEventListener("modelUpdated", () => this.clear());
  }

  private snapshot(range: GridCellRange): RangeSnapshot | null {
    const api = this.context?.api;
    if (!api) return null;
    const columns = visibleColumns(api);
    const first = columns.indexOf(range.colId1), last = columns.indexOf(range.colId2);
    const start = Math.max(0, Math.min(range.row1, range.row2));
    const end = Math.min(api.rows.getCount() - 1, Math.max(range.row1, range.row2));
    if (first < 0 || last < 0 || !Number.isInteger(start) || !Number.isInteger(end) || end < start) return null;
    const selected = columns.slice(Math.min(first, last), Math.max(first, last) + 1);
    if ((end - start + 1) * selected.length > MAX_CELLS) throw new RangeError("A range may contain at most 100000 cells.");
    const rows: string[] = [];
    for (let row = start; row <= end; row++) {
      const node = api.rows.getAt(row);
      if (node?.data && !node.isGroup && !node.isDetail && !node.loading) rows.push(node.id);
    }
    return { range: { row1: start, row2: end, colId1: columns[Math.min(first, last)], colId2: columns[Math.max(first, last)] }, rows, columns: selected };
  }

  private snapshots(): RangeSnapshot[] {
    const active = this.context?.api.selection.getRange();
    const snapshot = active ? this.snapshot(active) : null;
    const all = snapshot ? [...this.saved, snapshot] : [...this.saved];
    return boundedRanges(all);
  }

  getRanges(): GridCellRange[] {
    return this.snapshots().map(entry => ({ ...entry.range }));
  }

  setRanges(ranges: readonly GridCellRange[]): void {
    if (!this.context) throw new Error("Install the multi-range feature before setting ranges.");
    if (ranges.length > MAX_RANGES) throw new RangeError("At most 32 ranges are supported.");
    const next = boundedRanges(ranges.map(range => this.snapshot(range)).filter((range): range is RangeSnapshot => range !== null));
    this.context.api.selection.clearRange();
    this.saved = next;
    this.schedulePaint();
  }

  clear(): void {
    this.saved = [];
    this.context?.api.selection.clearRange();
    this.clearPaint();
    this.schedulePaint();
  }

  getText(): string {
    const api = this.context?.api;
    if (!api) return "";
    return this.snapshots().map(range => toTsv(range.rows.map(rowId =>
      range.columns.map(colId => readGridCell(api, rowId, colId))))).join("\n\n");
  }

  clearValues(): void {
    const api = this.context?.api;
    if (!api) return;
    const cells = new Map<string, { rowId: string; colId: string; value: null }>();
    for (const range of this.snapshots()) for (const rowId of range.rows) for (const colId of range.columns) {
      cells.set(JSON.stringify([rowId, colId]), { rowId, colId, value: null });
    }
    writeGridInput(api, [...cells.values()]);
  }

  private onPointer(event: MouseEvent): void {
    const cell = (event.target as Element).closest<HTMLElement>(".mach-cell");
    if (!cell || event.button !== 0) return;
    if (event.ctrlKey || event.metaKey) {
      const active = this.context?.api.selection.getRange();
      const snapshot = active ? this.snapshot(active) : null;
      const next = boundedRanges(snapshot ? [...this.saved, snapshot] : this.saved);
      if (next.length >= MAX_RANGES) throw new RangeError("At most 32 ranges are supported.");
      this.saved = next;
    } else if (!event.shiftKey) this.saved = [];
    this.schedulePaint();
  }

  private onKey(event: KeyboardEvent): void {
    if ((event.target as Element).closest("input,textarea,select,[contenteditable=true]")) return;
    if (event.key === "Escape") { this.clear(); return; }
    if ((event.key !== "Delete" && event.key !== "Backspace") || this.saved.length === 0 || this.snapshots().length < 2) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.clearValues();
  }

  private onCopy(event: ClipboardEvent, cut = false): void {
    if ((event.target as Element).closest("input,textarea,select,[contenteditable=true]") || this.saved.length === 0 || this.snapshots().length < 2) return;
    if (this.context?.api.getOption("suppressClipboard")) return;
    if (!event.clipboardData) return;
    event.clipboardData.setData("text/plain", this.getText());
    event.preventDefault();
    event.stopImmediatePropagation();
    if (cut) this.clearValues();
  }

  private schedulePaint(): void {
    if (!this.context || this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.paint(); });
  }

  private clearPaint(): void {
    this.paintCleanup?.();
    this.paintCleanup = null;
  }

  private paint(): void {
    this.clearPaint();
    if (!this.context) return;
    const ranges = this.saved.map(range => ({ rows: new Set(range.rows), columns: new Set(range.columns) }));
    const painted: HTMLElement[] = [];
    for (const cell of this.context.root.querySelectorAll<HTMLElement>(".mach-cell")) {
      const row = cell.closest<HTMLElement>(".mach-row");
      if (!ranges.some(range => range.rows.has(row?.dataset.id ?? "") && range.columns.has(cell.dataset.colId ?? ""))) continue;
      cell.classList.add("mach-cell--multi-range");
      painted.push(cell);
    }
    this.paintCleanup = () => painted.forEach(cell => cell.classList.remove("mach-cell--multi-range"));
  }
}
