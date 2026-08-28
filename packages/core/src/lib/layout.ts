export interface WidthInput {
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  flex?: number;
}

export const DEFAULT_COLUMN_WIDTH = 150;
export const DEFAULT_MIN_WIDTH = 80;

export function clampWidth(w: number, input: WidthInput): number {
  const min = input.minWidth ?? DEFAULT_MIN_WIDTH;
  const max = input.maxWidth ?? Number.MAX_SAFE_INTEGER;
  return Math.max(min, Math.min(max, w));
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
