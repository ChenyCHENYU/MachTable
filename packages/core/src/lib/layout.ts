export interface WidthInput {
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  flex?: number;
}

export const DEFAULT_COLUMN_WIDTH = 150;
export const DEFAULT_MIN_WIDTH = 80;

function positiveFinite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function widthBounds(input: WidthInput): { min: number; max: number } {
  const min = positiveFinite(input.minWidth, DEFAULT_MIN_WIDTH);
  return { min, max: Math.max(min, positiveFinite(input.maxWidth, Number.MAX_SAFE_INTEGER)) };
}

export function clampWidth(w: number, input: WidthInput): number {
  const { min, max } = widthBounds(input);
  const width = positiveFinite(w, positiveFinite(input.width, DEFAULT_COLUMN_WIDTH));
  return Math.max(min, Math.min(max, width));
}

export function computeColumnWidths(cols: WidthInput[], availableWidth: number): number[] {
  const widths = cols.map((c) => clampWidth(c.width ?? DEFAULT_COLUMN_WIDTH, c));

  const flexCols: number[] = [];
  let flexTotal = 0;
  cols.forEach((c, i) => {
    const f = c.flex ?? 0;
    if (f > 0) {
      flexCols.push(i);
      flexTotal += f;
    }
  });

  let total = 0;
  for (const w of widths) total += w;

  if (flexTotal > 0 && availableWidth > total) {
    let extra = availableWidth - total;
    for (let pass = 0; pass < 4 && extra > 0.5 && flexCols.length > 0; pass++) {
      const remainingFlex: number[] = [];
      let remainingTotal = 0;
      for (const i of flexCols) {
        const f = cols[i].flex ?? 0;
        remainingFlex.push(i);
        remainingTotal += f;
      }
      const consumed: number[] = [];
      for (let k = 0; k < remainingFlex.length; k++) {
        const i = remainingFlex[k];
        const f = cols[i].flex ?? 0;
        const share = (extra * f) / remainingTotal;
        const before = widths[i];
        widths[i] = clampWidth(before + share, cols[i]);
        consumed.push(widths[i] - before);
      }
      let used = 0;
      for (const c of consumed) used += c;
      extra -= used;
      const stillFlexible = remainingFlex.filter((_index, k) => consumed[k] > 0.001);
      if (stillFlexible.length === remainingFlex.length) break;
      flexCols.length = 0;
      for (const i of stillFlexible) flexCols.push(i);
    }
  }

  return widths;
}

/** Fits columns into a viewport while honoring every min/max bound. */
export function fitColumnWidths(cols: WidthInput[], availableWidth: number): number[] {
  const widths = cols.map((column) => clampWidth(column.width ?? DEFAULT_COLUMN_WIDTH, column));
  if (!Number.isFinite(availableWidth) || availableWidth <= 0 || cols.length === 0) return widths;

  const active = new Set(cols.map((_column, index) => index));
  let remainingWidth = availableWidth;
  for (let pass = 0; pass < cols.length + 1 && active.size > 0; pass++) {
    let weightTotal = 0;
    for (const index of active) weightTotal += Math.max(1, widths[index]);
    if (weightTotal <= 0) break;

    let constrained = false;
    for (const index of [...active]) {
      const target = remainingWidth * (Math.max(1, widths[index]) / weightTotal);
      const fitted = clampWidth(target, cols[index]);
      const { min, max } = widthBounds(cols[index]);
      if (target < min || target > max) {
        widths[index] = fitted;
        remainingWidth -= fitted;
        active.delete(index);
        constrained = true;
      }
    }
    if (!constrained) {
      for (const index of active) {
        widths[index] = clampWidth(
          remainingWidth * (Math.max(1, widths[index]) / weightTotal),
          cols[index]
        );
      }
      break;
    }
    remainingWidth = Math.max(0, remainingWidth);
  }

  const drift = availableWidth - widths.reduce((sum, width) => sum + width, 0);
  if (Math.abs(drift) > 0.01) {
    for (let index = widths.length - 1; index >= 0; index--) {
      const candidate = clampWidth(widths[index] + drift, cols[index]);
      if (Math.abs(candidate - widths[index]) > 0.01) {
        widths[index] = candidate;
        break;
      }
    }
  }
  return widths;
}
