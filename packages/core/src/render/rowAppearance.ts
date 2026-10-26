import type { GridCore } from "../core/gridCore";
import type { RowStyleRule } from "../types/options";
import type { RowNode } from "../types/row";

type AppearanceContext = Pick<GridCore<any>, "gridOptions" | "api" | "reportError">;
const TONES = new Set(["warning", "danger", "success", "info"]);

export function resolveRowAppearance(
  core: AppearanceContext, node: RowNode<any>, rowPinned: "top" | "bottom" | null = null
): RowStyleRule | undefined {
  if (node.data == null || node.isGroup || node.isDetail || node.loading) return;
  for (const rule of core.gridOptions.rowStyleRules) {
    try {
      if (rule.when({ data: node.data, node, api: core.api, rowPinned }) === true) return rule;
    } catch (error) {
      core.reportError(error, "rowStyleRules", { rowId: node.id });
    }
  }
}

/** Always clear previous values: the same DOM row may now represent another record. */
export function applyRowAppearance(row: HTMLElement, rule: RowStyleRule | undefined): void {
  row.style.removeProperty("--mach-row-rule-bg");
  row.style.removeProperty("--mach-row-rule-fg");
  if (rule?.tone && TONES.has(rule.tone)) row.dataset.rowTone = rule.tone;
  else delete row.dataset.rowTone;
  if (rule?.backgroundColor) row.style.setProperty("--mach-row-rule-bg", rule.backgroundColor);
  if (rule?.color) row.style.setProperty("--mach-row-rule-fg", rule.color);
  row.classList.toggle("mach-row--styled", !!rule);
}
