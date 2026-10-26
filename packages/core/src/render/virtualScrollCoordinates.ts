import { clamp } from "../lib/dom";

// Below the native scroll-height limit of all supported desktop engines.
export const MAX_SCROLL_HEIGHT = 16_000_000;

/** @internal O(1) axis mapping: scale the scrollbar range, never the rendered row heights. */
export class VirtualScrollCoordinates {
  height = 0;
  private logicalMax = 0;
  private physicalMax = 0;
  private physical = NaN;
  private logical = 0;

  configure(totalHeight: number, viewportHeight: number, bounded = true): void {
    this.height = bounded ? Math.min(totalHeight, MAX_SCROLL_HEIGHT) : totalHeight;
    this.logicalMax = Math.max(0, totalHeight - viewportHeight);
    this.physicalMax = Math.max(0, this.height - viewportHeight);
    this.physical = NaN;
  }

  get compressed(): boolean { return this.logicalMax > this.physicalMax; }

  toPhysical(logical: number): number {
    if (!this.logicalMax) return 0;
    return clamp(logical, 0, this.logicalMax) * this.physicalMax / this.logicalMax;
  }

  read(physical: number): number {
    if (physical !== this.physical) {
      this.physical = physical;
      this.logical = this.physicalMax > 0
        ? clamp(physical, 0, this.physicalMax) * this.logicalMax / this.physicalMax
        : 0;
    }
    return this.logical;
  }

  /** Preserve exact API/wheel targets when a browser quantizes physical pixels. */
  anchor(logical: number, physical: number): void {
    this.logical = clamp(logical, 0, this.logicalMax);
    this.physical = physical;
  }
}
