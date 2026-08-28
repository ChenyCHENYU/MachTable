export const DEFAULT_LOCALE = {
  matchContains: "包含",
  matchNotContains: "不包含",
  matchEquals: "等于",
  matchNotEquals: "不等于",
  matchStartsWith: "开头是",
  matchEndsWith: "结尾是",
  matchBlank: "为空",
  matchNotBlank: "不为空",
  matchLessThan: "小于",
  matchLessThanOrEqual: "小于等于",
  matchGreaterThan: "大于",
  matchGreaterThanOrEqual: "大于等于",
  matchInRange: "在范围内",
  apply: "应用",
  reset: "重置",
  search: "搜索...",
  emptySetLabel: "(空)",
  selectedCount: "已选 {n} 项",
  sortAsc: "升序",
  sortDesc: "降序",
  clearSort: "取消排序",
  pinLeft: "固定左侧",
  pinRight: "固定右侧",
  clearPin: "取消固定",
  autoSize: "自适应列宽",
  hideColumn: "隐藏此列",
  columnVisibility: "列显示",
  resetAll: "重置全部",
  autoSizeAll: "全部自适应",
  columnSettings: "列设置",
  totalLabel: "合计",
  totalRowsLabel: "共 {n} 行",
  menuCopy: "复制",
  menuPaste: "粘贴",
  menuClearContents: "清除内容",
  loading: "加载中...",
  statusSelected: "已选 {n} 行",
  statusSum: "和 {n}",
  statusAvg: "均 {n}",
  statusCount: "计 {n}",
  emptyRows: "暂无数据",
  emptyRowsHint: "没有可显示的行",
  paginationTotal: "共 {n} 条",
  paginationPage: "第 {a} / {b} 页",
  perPage: "{n} 条/页",
  pageFirst: "首页",
  pagePrev: "上一页",
  pageNext: "下一页",
  pageLast: "末页"
} as const;

export type RgLocaleKey = keyof typeof DEFAULT_LOCALE;
export type RgLocale = Partial<Record<RgLocaleKey, string>>;

export const LOCALE_EN: RgLocale = {
  matchContains: "Contains",
  matchNotContains: "Not Contains",
  matchEquals: "Equals",
  matchNotEquals: "Not Equals",
  matchStartsWith: "Starts With",
  matchEndsWith: "Ends With",
  matchBlank: "Blank",
  matchNotBlank: "Not Blank",
  matchLessThan: "Less Than",
  matchLessThanOrEqual: "≤",
  matchGreaterThan: "Greater Than",
  matchGreaterThanOrEqual: "≥",
  matchInRange: "In Range",
  apply: "Apply",
  reset: "Reset",
  search: "Search...",
  emptySetLabel: "(blank)",
  selectedCount: "{n} selected",
  sortAsc: "Ascending",
  sortDesc: "Descending",
  clearSort: "Clear Sort",
  pinLeft: "Pin Left",
  pinRight: "Pin Right",
  clearPin: "Unpin",
  autoSize: "Auto Fit",
  hideColumn: "Hide Column",
  columnVisibility: "Columns",
  resetAll: "Reset All",
  autoSizeAll: "Fit All",
  columnSettings: "Column Settings",
  totalLabel: "Total",
  totalRowsLabel: "{n} rows",
  menuCopy: "Copy",
  menuPaste: "Paste",
  menuClearContents: "Clear Contents",
  loading: "Loading...",
  statusSelected: "{n} selected",
  statusSum: "Sum {n}",
  statusAvg: "Avg {n}",
  statusCount: "Cnt {n}",
  emptyRows: "No Data",
  emptyRowsHint: "No rows to display",
  paginationTotal: "{n} items",
  paginationPage: "Page {a} / {b}",
  perPage: "{n} / page",
  pageFirst: "First",
  pagePrev: "Previous",
  pageNext: "Next",
  pageLast: "Last"
};

const MATCH_LOCALE_KEYS: Record<string, RgLocaleKey> = {
  contains: "matchContains",
  notContains: "matchNotContains",
  equals: "matchEquals",
  notEquals: "matchNotEquals",
  startsWith: "matchStartsWith",
  endsWith: "matchEndsWith",
  blank: "matchBlank",
  notBlank: "matchNotBlank",
  lessThan: "matchLessThan",
  lessThanOrEqual: "matchLessThanOrEqual",
  greaterThan: "matchGreaterThan",
  greaterThanOrEqual: "matchGreaterThanOrEqual",
  inRange: "matchInRange"
};

export function matchLocaleKey(match: string): RgLocaleKey {
  return MATCH_LOCALE_KEYS[match] ?? ("matchEquals" as RgLocaleKey);
}

export function formatText(template: string, n: number | string): string {
  return template.replace("{n}", String(n));
}

export function formatTwo(template: string, a: number | string, b: number | string): string {
  return template.replace("{a}", String(a)).replace("{b}", String(b));
}
