import { describe, expect, it } from "vitest";
import { VirtualScrollCoordinates, MAX_SCROLL_HEIGHT } from "../render/virtualScrollCoordinates";

describe("bounded logical scroll coordinates", () => {
  it("preserves the direct path for ordinary tables and short content", () => {
    const axis = new VirtualScrollCoordinates();
    axis.configure(12_000, 320);
    expect(axis.height).toBe(12_000);
    expect(axis.toPhysical(640)).toBe(640);
    expect(axis.read(640)).toBe(640);
    axis.configure(120, 320);
    expect(axis.toPhysical(999)).toBe(0);
    expect(axis.read(999)).toBe(0);
  });

  it("maps both endpoints and intermediate positions without per-row allocation", () => {
    const axis = new VirtualScrollCoordinates();
    axis.configure(10_000_000 * 32, 320);
    expect(axis.height).toBe(MAX_SCROLL_HEIGHT);
    for (const fraction of [0, 0.001, 0.25, 0.5, 0.999, 1]) {
      const logical = (320_000_000 - 320) * fraction;
      expect(axis.read(axis.toPhysical(logical))).toBeCloseTo(logical, 5);
    }
    expect(axis.toPhysical(Infinity)).toBe(MAX_SCROLL_HEIGHT - 320);
    expect(axis.toPhysical(-1)).toBe(0);
  });

  it("retains exact imperative positions after the browser rounds physical scrollTop", () => {
    const axis = new VirtualScrollCoordinates();
    axis.configure(320_000_000, 320);
    const target = 123_457 * 32;
    const physical = Math.round(axis.toPhysical(target));
    axis.anchor(target, physical);
    expect(axis.read(physical)).toBe(target);
    // A native thumb jump is absolute, rather than accumulating an old API rounding error.
    expect(axis.read(MAX_SCROLL_HEIGHT - 320)).toBe(320_000_000 - 320);
    expect(axis.read(0)).toBe(0);
  });
});
