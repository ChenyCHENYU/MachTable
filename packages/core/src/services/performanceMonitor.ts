import type { GridPerformanceSnapshot } from "../types/api";

interface RenderSample {
  duration: number;
  rows: number;
  columns: number;
}

const MAX_SAMPLES = 120;
const LONG_FRAME_MS = 16.7;

function now(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

export class PerformanceMonitor {
  private samples: RenderSample[] = [];

  start(): number { return now(); }

  recordRender(startedAt: number, rows: number, columns: number): void {
    this.samples.push({ duration: Math.max(0, now() - startedAt), rows, columns });
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  }

  snapshot(): GridPerformanceSnapshot {
    const durations = this.samples.map((sample) => sample.duration);
    const last = this.samples[this.samples.length - 1];
    const sorted = [...durations].sort((left, right) => left - right);
    const percentileIndex = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
    return {
      sampleCount: durations.length,
      lastRenderMs: last?.duration ?? 0,
      averageRenderMs: durations.length > 0
        ? durations.reduce((total, duration) => total + duration, 0) / durations.length
        : 0,
      maxRenderMs: sorted[sorted.length - 1] ?? 0,
      p95RenderMs: sorted[percentileIndex] ?? 0,
      longRenderCount: durations.filter((duration) => duration > LONG_FRAME_MS).length,
      renderedRows: last?.rows ?? 0,
      renderedColumns: last?.columns ?? 0,
      renderedCells: (last?.rows ?? 0) * (last?.columns ?? 0)
    };
  }

  reset(): void { this.samples = []; }
}
