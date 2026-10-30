import { normalizePositive } from "./optionValues";
export interface WidthInput {
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  flex?: number;
}

export const DEFAULT_COLUMN_WIDTH = 150;
export const DEFAULT_MIN_WIDTH = 80;

export function clampWidth(w: number, input: WidthInput): number {
  const min = normalizePositive(input.minWidth) ?? DEFAULT_MIN_WIDTH;
  const max = normalizePositive(input.maxWidth) ?? Number.MAX_SAFE_INTEGER;
  const width = normalizePositive(w) ?? normalizePositive(input.width) ?? DEFAULT_COLUMN_WIDTH;
  return Math.max(min, Math.min(max, width));
}

/** 同一个有界余量分配器处理 flex 与 fit，达到边界的列退出后再分配剩余空间。 */
function distributeWidths(cols: WidthInput[], widths: number[], available: number, weights: number[]): void {
  let active = weights.map((_weight, index) => index).filter(index => weights[index] > 0);
  let extra = available - widths.reduce((sum, width) => sum + width, 0);
  while (Math.abs(extra) > 0.001 && active.length) {
    const weight = active.reduce((sum, index) => sum + weights[index], 0);
    let used = 0;
    active = active.filter(index => {
      const before = widths[index];
      widths[index] = clampWidth(before + extra * weights[index] / weight, cols[index]);
      used += widths[index] - before;
      return widths[index] !== before;
    });
    if (Math.abs(used) < 0.0001) break;
    extra -= used;
  }
}

export function computeColumnWidths(cols: WidthInput[], availableWidth: number): number[] {
  const widths = cols.map(column => clampWidth(column.width ?? DEFAULT_COLUMN_WIDTH, column));
  if (availableWidth > widths.reduce((sum, width) => sum + width, 0)) {
    distributeWidths(cols, widths, availableWidth, cols.map(column => column.flex ?? 0));
  }
  return widths;
}

/** 按首选宽度比例铺满；不可满足的预算停在 min/max，不破坏任何边界。 */
export function fitColumnWidths(cols: WidthInput[], availableWidth: number): number[] {
  const widths = cols.map(column => clampWidth(column.width ?? DEFAULT_COLUMN_WIDTH, column));
  if (Number.isFinite(availableWidth) && availableWidth > 0) {
    distributeWidths(cols, widths, availableWidth, [...widths]);
  }
  return widths;
}
