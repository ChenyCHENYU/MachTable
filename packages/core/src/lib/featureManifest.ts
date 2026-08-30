import type { GridFeature } from "../types/options";

export type GridFeatureIssueCode =
  | "DUPLICATE_FEATURE"
  | "FEATURE_CONFLICT"
  | "FEATURE_CYCLE"
  | "FEATURE_DEPENDENCY_SETUP_FAILED"
  | "INVALID_FEATURE_KEY"
  | "MISSING_FEATURE_DEPENDENCY";

export interface GridFeatureIssue {
  code: GridFeatureIssueCode;
  feature?: string;
  dependency?: string;
  message: string;
}

export interface ResolvedGridFeatures<TData = any> {
  features: GridFeature<TData>[];
  issues: GridFeatureIssue[];
}

function normalizedKeys(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

/**
 * Validates and dependency-orders per-grid features before any setup side effect runs.
 * Invalid features are isolated instead of leaving a partially initialised extension graph.
 */
export function resolveGridFeatures<TData>(input: readonly GridFeature<TData>[]): ResolvedGridFeatures<TData> {
  const issues: GridFeatureIssue[] = [];
  const byKey = new Map<string, GridFeature<TData>>();
  for (const feature of input) {
    const key = typeof feature?.key === "string" ? feature.key.trim() : "";
    if (!key) {
      issues.push({ code: "INVALID_FEATURE_KEY", message: "GridFeature.key must be a non-empty string" });
      continue;
    }
    if (byKey.has(key)) {
      issues.push({ code: "DUPLICATE_FEATURE", feature: key, message: `Duplicate GridFeature key: ${key}` });
      continue;
    }
    byKey.set(key, feature);
  }

  const invalid = new Set<string>();
  for (const [key, feature] of byKey) {
    for (const dependency of normalizedKeys(feature.requires)) {
      if (byKey.has(dependency)) continue;
      invalid.add(key);
      issues.push({
        code: "MISSING_FEATURE_DEPENDENCY",
        feature: key,
        dependency,
        message: `GridFeature "${key}" requires missing feature "${dependency}"`
      });
    }
    for (const conflict of normalizedKeys(feature.conflicts)) {
      if (!byKey.has(conflict)) continue;
      invalid.add(key);
      issues.push({
        code: "FEATURE_CONFLICT",
        feature: key,
        dependency: conflict,
        message: `GridFeature "${key}" conflicts with "${conflict}"`
      });
      break;
    }
  }

  const ordered: GridFeature<TData>[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string): boolean => {
    if (visited.has(key)) return !invalid.has(key);
    if (visiting.has(key)) {
      invalid.add(key);
      issues.push({ code: "FEATURE_CYCLE", feature: key, message: `GridFeature dependency cycle includes "${key}"` });
      return false;
    }
    const feature = byKey.get(key);
    if (!feature || invalid.has(key)) return false;
    visiting.add(key);
    let valid = true;
    for (const dependency of normalizedKeys(feature.requires)) {
      if (!visit(dependency)) valid = false;
    }
    visiting.delete(key);
    visited.add(key);
    if (!valid) {
      invalid.add(key);
      return false;
    }
    ordered.push(feature);
    return true;
  };

  for (const key of byKey.keys()) visit(key);
  return { features: ordered.filter((feature) => !invalid.has(feature.key.trim())), issues };
}
