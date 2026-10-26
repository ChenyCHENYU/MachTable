function dataProperties(input: object): Array<[string, PropertyDescriptor]> {
  return Object.entries(Object.getOwnPropertyDescriptors(input)).filter(([key, descriptor]) => {
    if (key === "length" && Array.isArray(input) || !descriptor.enumerable) return false;
    if (descriptor.get || descriptor.set || ["__proto__", "prototype", "constructor"].includes(key)) throw new TypeError("Unsafe import property");
    return true;
  });
}

/** Isolate only the bounded incoming data, never clone the existing grid or invoke input accessors. */
export function snapshotImportValue<T>(value: T): T {
  const seen = new Set<object>();
  let count = 0;
  const copy = (input: any, depth: number): any => {
    if (++count > 200_000 || depth > 32) throw new RangeError("Import snapshot exceeds its value/depth limit");
    if (input == null || ["string", "number", "boolean", "bigint", "undefined"].includes(typeof input)) return input;
    if (input instanceof Date) return new Date(input.getTime());
    if (typeof input !== "object" || seen.has(input)) throw new TypeError("Import values must be acyclic data");
    const prototype = Object.getPrototypeOf(input);
    if (!Array.isArray(input) && prototype !== Object.prototype && prototype !== null) throw new TypeError("Import records must contain plain data");
    seen.add(input);
    const output: any = Array.isArray(input) ? [] : {};
    for (const [key, descriptor] of dataProperties(input)) output[key] = copy(descriptor.value, depth + 1);
    seen.delete(input);
    return output;
  };
  return copy(value, 0);
}
