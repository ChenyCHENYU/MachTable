import type { GridPerformanceSnapshot } from "../types/api";

interface RenderSample {
  duration: number;
  rows: number;
  columns: number;
}

type PerformanceMemory = Performance & {
  memory?: { usedJSHeapSize?: number };
};

const MAX_SAMPLES = 120;
const LONG_FRAME_MS = 16.7;

function now(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

export class PerformanceMonitor {
  private samples: RenderSample[] = [];
  private layoutSamples: number[] = [];
  private modelSamples: number[] = [];
  private longTaskCount = 0;
  private longTaskTotalMs = 0;
  private longTaskObserver: PerformanceObserver | null = null;

  constructor() {
    if (typeof PerformanceObserver === "undefined") return;
    try {
      this.longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.longTaskCount++;
          this.longTaskTotalMs += entry.duration;
        }
      });
      this.longTaskObserver.observe({ entryTypes: ["longtask"] });
    } catch {
      // Long Tasks API is intentionally optional (Safari, SSR and test DOMs).
      this.longTaskObserver = null;
    }
  }

  start(): number { return now(); }

  recordRender(startedAt: number, rows: number, columns: number): void {
    this.samples.push({ duration: Math.max(0, now() - startedAt), rows, columns });
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  }

  recordLayout(startedAt: number): void {
    this.pushDuration(this.layoutSamples, startedAt);
  }

  recordModel(startedAt: number): void {
    this.pushDuration(this.modelSamples, startedAt);
  }

  snapshot(): GridPerformanceSnapshot {
    const durations = this.samples.map((sample) => sample.duration);
    const last = this.samples[this.samples.length - 1];
    const sorted = [...durations].sort((left, right) => left - right);
    return {
      sampleCount: durations.length,
      lastRenderMs: last?.duration ?? 0,
      averageRenderMs: this.average(durations),
      maxRenderMs: sorted[sorted.length - 1] ?? 0,
      p95RenderMs: this.percentile(sorted, true),
      longRenderCount: durations.filter((duration) => duration > LONG_FRAME_MS).length,
      renderedRows: last?.rows ?? 0,
      renderedColumns: last?.columns ?? 0,
      renderedCells: (last?.rows ?? 0) * (last?.columns ?? 0),
      layoutSampleCount: this.layoutSamples.length,
      p95LayoutMs: this.percentile(this.layoutSamples),
      modelSampleCount: this.modelSamples.length,
      p95ModelMs: this.percentile(this.modelSamples),
      longTaskCount: this.longTaskCount,
      longTaskTotalMs: this.longTaskTotalMs,
      usedHeapBytes: this.usedHeapBytes()
    };
  }

  reset(): void {
    this.samples = [];
    this.layoutSamples = [];
    this.modelSamples = [];
    this.longTaskCount = 0;
    this.longTaskTotalMs = 0;
  }

  destroy(): void {
    this.longTaskObserver?.disconnect();
    this.longTaskObserver = null;
  }

  private pushDuration(target: number[], startedAt: number): void {
    target.push(Math.max(0, now() - startedAt));
    if (target.length > MAX_SAMPLES) target.shift();
  }

  private average(values: readonly number[]): number {
    return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
  }

  private usedHeapBytes(): number | null {
    const heap = typeof performance === "undefined"
      ? undefined
      : (performance as PerformanceMemory).memory?.usedJSHeapSize;
    return typeof heap === "number" && Number.isFinite(heap) ? heap : null;
  }

  private percentile(values: readonly number[], sortedAlready = false): number {
    if (values.length === 0) return 0;
    const sorted = sortedAlready ? values : [...values].sort((left, right) => left - right);
    return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
  }
}
