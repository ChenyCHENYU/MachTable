const collator = typeof Intl !== "undefined"
  ? new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })
  : null;

export function defaultComparator(valueA: any, valueB: any): number {
  const aEmpty = valueA == null || valueA === "";
  const bEmpty = valueB == null || valueB === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  if (typeof valueA === "number" && typeof valueB === "number") {
    if (isNaN(valueA) && isNaN(valueB)) return 0;
    if (isNaN(valueA)) return 1;
    if (isNaN(valueB)) return -1;
    return valueA - valueB;
  }
  if (valueA instanceof Date && valueB instanceof Date) {
    return valueA.getTime() - valueB.getTime();
  }
  if (typeof valueA === "boolean" && typeof valueB === "boolean") {
    return valueA === valueB ? 0 : valueA ? 1 : -1;
  }
  const a = String(valueA);
  const b = String(valueB);
  return collator ? collator.compare(a, b) : a.localeCompare(b);
}
