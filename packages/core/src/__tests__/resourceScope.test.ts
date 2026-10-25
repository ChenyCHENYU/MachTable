import { describe, expect, it, vi } from "vitest";
import { ResourceScope } from "../lib/resourceScope";

describe("resource ownership", () => {
  it("releases children in reverse order and allows early release exactly once", () => {
    const order: number[] = [];
    const scope = new ResourceScope(vi.fn());
    scope.add(() => order.push(1));
    const early = scope.add(() => order.push(2));
    scope.own({ destroy: () => order.push(3) });
    early();
    early();
    scope.dispose();
    scope.dispose();
    expect(order).toEqual([2, 3, 1]);
  });

  it("continues after a cleanup and its error observer both fail", () => {
    const cleaned = vi.fn();
    const error = new Error("cleanup");
    const report = vi.fn(() => { throw new Error("observer"); });
    const scope = new ResourceScope(report);
    scope.add(cleaned);
    scope.add(() => { throw error; });
    expect(() => scope.dispose()).not.toThrow();
    expect(report).toHaveBeenCalledWith(error);
    expect(cleaned).toHaveBeenCalledTimes(1);
  });

  it("does not leave resources registered after their owner is disposed", () => {
    const scope = new ResourceScope(vi.fn());
    scope.dispose();
    const cleanup = vi.fn();
    scope.add(cleanup)();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
