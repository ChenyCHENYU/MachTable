const UNSAFE_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

export function isSafePath(path: string): boolean {
  if (typeof path !== "string" || path.length === 0) return false;
  const parts = path.split(".");
  return parts.every((part) => part.length > 0 && !UNSAFE_PATH_SEGMENTS.has(part));
}

export function getByPath(obj: any, path: string): any {
  if (obj == null) return undefined;
  if (!isSafePath(path)) return undefined;
  const dot = path.indexOf(".");
  if (dot < 0) return obj[path];
  let cur = obj;
  let start = 0;
  while (start < path.length) {
    if (cur == null) return undefined;
    const idx = path.indexOf(".", start);
    if (idx < 0) {
      cur = cur[path.slice(start)];
      break;
    }
    cur = cur[path.slice(start, idx)];
    start = idx + 1;
  }
  return cur;
}

export function setByPath(obj: any, path: string, value: any): boolean {
  if (obj == null || !isSafePath(path)) return false;
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if ((typeof cur !== "object" && typeof cur !== "function") || cur === null) return false;
    if (cur[parts[i]] == null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  if ((typeof cur !== "object" && typeof cur !== "function") || cur === null) return false;
  cur[parts[parts.length - 1]] = value;
  return true;
}
