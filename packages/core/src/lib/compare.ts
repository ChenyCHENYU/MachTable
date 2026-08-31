const collator = typeof Intl !== "undefined"
  ? new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })
  : null;

function emptyComparison(valueA: any, valueB: any): number | null {
  const aEmpty = valueA == null || valueA === "";
  const bEmpty = valueB == null || valueB === "";
  if (!aEmpty && !bEmpty) return null;
  if (aEmpty && bEmpty) return 0;
  return aEmpty ? 1 : -1;
}

function compareNumbers(valueA: number, valueB: number): number {
  const aNaN = Number.isNaN(valueA);
  const bNaN = Number.isNaN(valueB);
  if (aNaN || bNaN) return aNaN === bNaN ? 0 : aNaN ? 1 : -1;
  return valueA - valueB;
}

function compareBooleans(valueA: boolean, valueB: boolean): number {
  if (valueA === valueB) return 0;
  return valueA ? 1 : -1;
}

export function defaultComparator(valueA: any, valueB: any): number {
  const empty = emptyComparison(valueA, valueB);
  if (empty !== null) return empty;

  if (typeof valueA === "number" && typeof valueB === "number") {
    return compareNumbers(valueA, valueB);
  }
  if (valueA instanceof Date && valueB instanceof Date) {
    return valueA.getTime() - valueB.getTime();
  }
  if (typeof valueA === "boolean" && typeof valueB === "boolean") {
    return compareBooleans(valueA, valueB);
  }
  const a = String(valueA);
  const b = String(valueB);
  return collator ? collator.compare(a, b) : a.localeCompare(b);
}
