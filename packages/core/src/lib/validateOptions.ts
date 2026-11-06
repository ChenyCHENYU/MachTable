import { GRID_OPTION_KEYS, GRID_OPTION_KINDS } from "../core/gridOptionMetadata";
import { EVENT_OPTION_KEYS, matchesGridOptionValue } from "../core/gridOptionRuntime";
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

const KNOWN_OPTIONS = new Set<string>([...GRID_OPTION_KEYS, ...EVENT_OPTION_KEYS]);
const SPECIALISED_OPTIONS = new Set(["enableColumnResize", "pagination", "rowKey"]);
type ReportIssue = (code: GridValidationCode, option: string, message: string) => void;

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const distances = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row++) {
    let diagonal = distances[0];
    distances[0] = row;
    for (let column = 1; column <= b.length; column++) {
      const above = distances[column];
      distances[column] = Math.min(
        distances[column - 1] + 1,
        above + 1,
        diagonal + (a[row - 1] === b[column - 1] ? 0 : 1)
      );
      diagonal = above;
    }
  }
  return distances[b.length];
}

function closestOption(input: string): string | undefined {
  let closest: string | undefined;
  let distance = Math.max(2, Math.floor(input.length * 0.3)) + 1;
  const normalized = input.toLowerCase();
  for (const candidate of KNOWN_OPTIONS) {
    if (Math.abs(normalized.length - candidate.length) >= distance) continue;
    const next = editDistance(normalized, candidate.toLowerCase());
    if (next < distance) {
      distance = next;
      closest = candidate;
    }
  }
  return closest;
}

function validateIdentityAndLayout(source: Record<string, unknown>, report: ReportIssue): void {
  if (source.rowKey != null && typeof source.rowKey !== "string" && typeof source.rowKey !== "function") {
    report("INVALID_OPTION_VALUE", "rowKey", "rowKey 必须是字段路径或返回稳定业务主键的函数");
  }
  if (source.domLayout === "autoHeight" && source.datasource != null) {
    report("OPTION_CONFLICT", "domLayout", "autoHeight 会渲染全部已加载行，不适用于 datasource 无限滚动模式");
  }
  validateBlockDatasource(source, report);
  if (source.enableColumnResize != null && typeof source.enableColumnResize !== "boolean") {
    report("INVALID_OPTION_VALUE", "enableColumnResize", "enableColumnResize 必须是 boolean；未配置时默认关闭");
  }
}

function validateBlockDatasource(source: Record<string, unknown>, report: ReportIssue): void {
  if (source.datasourceMode !== "block") return;
  if (source.datasource == null) {
    report("OPTION_CONFLICT", "datasourceMode", "datasourceMode='block' requires a datasource");
  }
  if (typeof source.getRowHeight === "function") {
    report("OPTION_CONFLICT", "getRowHeight", "Random-access block rows require fixed rowHeight so unloaded offsets remain deterministic");
  }
  if (source.masterDetail === true) {
    report("OPTION_CONFLICT", "masterDetail", "masterDetail is not supported by the sparse random-access block row model");
  }
  if (source.treeData === true) {
    report("OPTION_CONFLICT", "treeData", "treeData requires the local/tree row model and cannot use random-access blocks");
  }
  if (source.rowKey == null) {
    report("MISSING_STABLE_ROW_ID", "rowKey", "Random-access blocks require rowKey to preserve selection and identity after eviction");
  }
}

function validateMetadataValues(source: Record<string, unknown>, report: ReportIssue): void {
  for (const key of GRID_OPTION_KEYS) {
    if (SPECIALISED_OPTIONS.has(key) || !Object.prototype.hasOwnProperty.call(source, key)) continue;
    if (!matchesGridOptionValue(key, source[key])) {
      const message = key === "maxBodyHeight" ? "maxBodyHeight 必须是至少 1px 的有限数" : `${key} 值类型无效，期望 ${GRID_OPTION_KINDS[key]}`;
      report("INVALID_OPTION_VALUE", key, message);
    }
  }
}

function validateKnownOptions(source: Record<string, unknown>): GridValidationIssue[] {
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
  return issues;
}

function validateServerPagination(
  source: Record<string, unknown>,
  config: Record<string, unknown>,
  report: ReportIssue
): void {
  if (config.mode !== "server") return;
  if (source.rowKey == null) {
    report("MISSING_STABLE_ROW_ID", "rowKey", "服务端分页建议提供稳定 rowKey，否则跨页选择与增量更新无法可靠保持");
  }
  const total = config.total;
  if (total !== undefined && (typeof total !== "number" || !Number.isFinite(total) || total < 0)) {
    report("INVALID_OPTION_VALUE", "pagination.total", "服务端分页 total 必须是非负有限数");
  }
}

function validatePagination(source: Record<string, unknown>, report: ReportIssue): void {
  const pagination = source.pagination;
  if (pagination != null && typeof pagination !== "boolean" && typeof pagination !== "object") {
    report("INVALID_OPTION_VALUE", "pagination", "pagination 必须是 boolean 或配置对象");
  }
  if (source.datasource != null && pagination !== undefined && pagination !== false) {
    report("OPTION_CONFLICT", "pagination", "datasource 顺序无限模式与 pagination 不能同时启用；普通服务端分页请使用 pagination.mode='server'");
  }
  if (pagination && typeof pagination === "object") {
    validateServerPagination(source, pagination as Record<string, unknown>, report);
  }
}

/** Runtime validation for JavaScript, JSON/schema driven and dynamic options. */
export function validateGridOptions(options: Partial<GridOptions<any>> | Record<string, unknown>): GridValidationIssue[] {
  const source = options as Record<string, unknown>;
  const issues = validateKnownOptions(source);
  const report: ReportIssue = (code, option, message) => { issues.push({ code, option, message }); };
  validatePagination(source, report);
  if (source.treeData === true && source.masterDetail === true) {
    report("OPTION_CONFLICT", "masterDetail", "treeData 与 masterDetail 不能同时启用，主从明细将被忽略");
  }
  validateMetadataValues(source, report);
  validateIdentityAndLayout(source, report);
  return issues;
}
