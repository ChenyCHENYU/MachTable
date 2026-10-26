const UNSAFE_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);
// Column paths are read repeatedly by rendering and projections. Cache only
// parsed paths, never row values; the bound also covers schema-driven inputs.
const paths = new Map<string, readonly string[] | null>();

function pathParts(path: string): readonly string[] | null {
  if (typeof path !== "string" || path.length === 0) return null;
  const cached = paths.get(path);
  if (cached !== undefined) return cached;
  const parts = path.split(".");
  const safe = parts.every(part => part.length > 0 && !UNSAFE_PATH_SEGMENTS.has(part)) ? parts : null;
  if (path.length <= 1024) {
    if (paths.size >= 256) paths.delete(paths.keys().next().value!);
    paths.set(path, safe);
  }
  return safe;
}

export function isSafePath(path: string): boolean {
  return pathParts(path) !== null;
}

export function getByPath(obj: any, path: string): any {
  if (obj == null) return undefined;
  const parts = pathParts(path);
  if (!parts) return undefined;
  let cur = obj;
  for (const part of parts) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

export function setByPath(obj: any, path: string, value: any): boolean {
  if (obj == null) return false;
  const parts = pathParts(path);
  if (!parts) return false;
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
