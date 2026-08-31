type VersionTuple = readonly [number, number, number];

function parseVersion(value: string): VersionTuple | null {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/.exec(value.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

function compare(left: VersionTuple, right: VersionTuple): number {
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

function upperForCaret(version: VersionTuple): VersionTuple {
  if (version[0] > 0) return [version[0] + 1, 0, 0];
  if (version[1] > 0) return [0, version[1] + 1, 0];
  return [0, 0, version[2] + 1];
}

function testToken(version: VersionTuple, token: string): boolean {
  if (token === "*" || token.toLowerCase() === "latest") return true;
  const operator = /^(\^|~|>=|<=|>|<|=)?\s*(.+)$/.exec(token);
  if (!operator) return false;
  const expected = parseVersion(operator[2]);
  if (!expected) return false;
  const order = compare(version, expected);
  switch (operator[1] ?? "=") {
    case ">=": return order >= 0;
    case "<=": return order <= 0;
    case ">": return order > 0;
    case "<": return order < 0;
    case "^": return order >= 0 && compare(version, upperForCaret(expected)) < 0;
    case "~": return order >= 0 && compare(version, [expected[0], expected[1] + 1, 0]) < 0;
    default: return order === 0;
  }
}

/** Small dependency-free range evaluator for feature manifests. Space means AND and `||` means OR. */
export function satisfiesVersionRange(version: string | undefined, range: string | undefined): boolean {
  if (!range?.trim()) return true;
  const parsed = version ? parseVersion(version) : null;
  if (!parsed) return false;
  return range.split("||").some((branch) => {
    const tokens = branch.trim().split(/\s+/).filter(Boolean);
    return tokens.length > 0 && tokens.every((token) => testToken(parsed, token));
  });
}
