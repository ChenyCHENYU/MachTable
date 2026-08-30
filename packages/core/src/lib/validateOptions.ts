import { GRID_OPTION_KEYS } from "../core/gridOptionMetadata";
import { EVENT_TYPES } from "../types/events";
import type { GridOptions } from "../types/options";

export type GridValidationCode =
  | "UNKNOWN_OPTION"
  | "INVALID_OPTION_VALUE"
  | "OPTION_CONFLICT"
  | "MISSING_STABLE_ROW_ID";

export interface GridValidationIssue {
  code: GridValidationCode;
  message: string;
  option?: string;
  suggestion?: string;
}

const EVENT_OPTION_KEYS = EVENT_TYPES.map((type) => `on${type.charAt(0).toUpperCase()}${type.slice(1)}`);
const KNOWN_OPTIONS = new Set<string>([...GRID_OPTION_KEYS, ...EVENT_OPTION_KEYS]);

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row++) {
    const current = [row];
    for (let column = 1; column <= b.length; column++) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[b.length];
}

function closestOption(input: string): string | undefined {
  let closest: string | undefined;
  let distance = Number.POSITIVE_INFINITY;
  for (const candidate of KNOWN_OPTIONS) {
    const next = editDistance(input.toLowerCase(), candidate.toLowerCase());
    if (next < distance) {
      distance = next;
      closest = candidate;
    }
  }
  const threshold = Math.max(2, Math.floor(input.length * 0.3));
  return distance <= threshold ? closest : undefined;
}

function validateIdentityAndLayout(source: Record<string, unknown>): GridValidationIssue[] {
  const issues: GridValidationIssue[] = [];
  if (source.rowKey != null && typeof source.rowKey !== "string" && typeof source.rowKey !== "function") {
    issues.push({
      code: "INVALID_OPTION_VALUE",
      option: "rowKey",
      message: "rowKey 必须是字段路径或返回稳定业务主键的函数"
    });
  }
  if (source.domLayout === "autoHeight" && source.datasource != null) {
    issues.push({
      code: "OPTION_CONFLICT",
      option: "domLayout",
      message: "autoHeight 会渲染全部已加载行，不适用于 datasource 无限滚动模式"
    });
  }
  if (source.enableColumnResize != null && typeof source.enableColumnResize !== "boolean") {
    issues.push({
      code: "INVALID_OPTION_VALUE",
      option: "enableColumnResize",
      message: "enableColumnResize 必须是 boolean；未配置时默认关闭"
    });
  }
  return issues;
}

function hasStableRowId(source: Record<string, unknown>): boolean {
  return typeof source.getRowId === "function" || source.rowKey != null;
}

/** Runtime validation for JavaScript, JSON/schema driven and dynamic options. */
export function validateGridOptions(options: Partial<GridOptions<any>> | Record<string, unknown>): GridValidationIssue[] {
  const source = options as Record<string, unknown>;
  const issues: GridValidationIssue[] = [];
  for (const option of Object.keys(source)) {
    if (KNOWN_OPTIONS.has(option)) continue;
    const suggestion = closestOption(option);
    issues.push({
      code: "UNKNOWN_OPTION",
      option,
      ...(suggestion ? { suggestion } : {}),
      message: suggestion
        ? `未知 GridOption "${option}"，是否想使用 "${suggestion}"？`
        : `未知 GridOption "${option}"，该值不会生效`
    });
  }

  const pagination = source.pagination;
  if (pagination != null && typeof pagination !== "boolean" && typeof pagination !== "object") {
    issues.push({ code: "INVALID_OPTION_VALUE", option: "pagination", message: "pagination 必须是 boolean 或配置对象" });
  }
  if (source.datasource != null && pagination !== undefined && pagination !== false) {
    issues.push({
      code: "OPTION_CONFLICT",
      option: "pagination",
      message: "datasource 顺序无限模式与 pagination 不能同时启用；普通服务端分页请使用 pagination.mode='server'"
    });
  }
  if (pagination && typeof pagination === "object") {
    const config = pagination as Record<string, unknown>;
    if (config.mode === "server" && !hasStableRowId(source)) {
      issues.push({
        code: "MISSING_STABLE_ROW_ID",
        option: "getRowId",
        message: "服务端分页建议提供稳定 getRowId，否则跨页选择与增量更新无法可靠保持"
      });
    }
    if (config.mode === "server" && config.total !== undefined && (
      typeof config.total !== "number" || !Number.isFinite(config.total) || config.total < 0
    )) {
      issues.push({
        code: "INVALID_OPTION_VALUE",
        option: "pagination.total",
        message: "服务端分页 total 必须是非负有限数"
      });
    }
  }
  if (source.treeData === true && source.masterDetail === true) {
    issues.push({
      code: "OPTION_CONFLICT",
      option: "masterDetail",
      message: "treeData 与 masterDetail 不能同时启用，主从明细将被忽略"
    });
  }
  issues.push(...validateIdentityAndLayout(source));
  return issues;
}
