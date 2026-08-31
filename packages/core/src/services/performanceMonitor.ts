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

interface LongTaskSnapshot { count: number; totalMs: number }

/** One browser observer is shared by every mounted grid to avoid N observers for N tables. */
class LongTaskHub {
  private observer: PerformanceObserver | null = null;
  private subscribers = 0;
  private count = 0;
  private totalMs = 0;

  acquire(): () => void {
    this.subscribers++;
    this.ensureObserver();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.subscribers = Math.max(0, this.subscribers - 1);
      if (this.subscribers === 0) {
        this.observer?.disconnect();
        this.observer = null;
      }
    };
  }

  snapshot(): LongTaskSnapshot { return { count: this.count, totalMs: this.totalMs }; }

  private ensureObserver(): void {
    if (this.observer || typeof PerformanceObserver === "undefined") return;
    try {
      this.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.count++;
          this.totalMs += entry.duration;
        }
      });
      this.observer.observe({ entryTypes: ["longtask"] });
    } catch {
      this.observer = null;
    }
  }
}

const longTaskHub = new LongTaskHub();

function now(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

export class PerformanceMonitor {
  private samples: RenderSample[] = [];
  private layoutSamples: number[] = [];
  private modelSamples: number[] = [];
  private longTaskBaseline: LongTaskSnapshot;
  private releaseLongTaskHub: (() => void) | null;

  constructor() {
    this.releaseLongTaskHub = longTaskHub.acquire();
    this.longTaskBaseline = longTaskHub.snapshot();
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
    const longTasks = longTaskHub.snapshot();
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
      longTaskCount: Math.max(0, longTasks.count - this.longTaskBaseline.count),
      longTaskTotalMs: Math.max(0, longTasks.totalMs - this.longTaskBaseline.totalMs),
      usedHeapBytes: this.usedHeapBytes()
    };
  }

  reset(): void {
    this.samples = [];
    this.layoutSamples = [];
    this.modelSamples = [];
    this.longTaskBaseline = longTaskHub.snapshot();
  }

  destroy(): void {
    this.releaseLongTaskHub?.();
    this.releaseLongTaskHub = null;
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
