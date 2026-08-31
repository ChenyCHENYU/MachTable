import type { ColDef, ColDefGroup, ColDefOrGroup } from "../types/colDef";
import { isColDefGroup } from "../types/colDef";
import { isSafePath } from "./path";

interface ColumnValidationContext {
  issues: string[];
  seenIds: Map<string, number>;
  leafIndex: number;
}

function hasColumnValue(def: ColDef<any>): boolean {
  return Boolean(def.field || def.valueGetter || def.checkboxSelection || def.autoRowSpan || def.rowSpan);
}

function validateColumnWidths(def: ColDef<any>, id: string, issues: string[]): void {
  if (def.width != null && def.minWidth != null && def.width < def.minWidth) {
    issues.push(`列 "${id}" 的 width(${def.width}) 小于 minWidth(${def.minWidth})，将按 minWidth 渲染`);
  }
  if (def.width != null && def.maxWidth != null && def.width > def.maxWidth) {
    issues.push(`列 "${id}" 的 width(${def.width}) 大于 maxWidth(${def.maxWidth})，将按 maxWidth 渲染`);
  }
}

function validateLeafDefinition(def: ColDef<any>, context: ColumnValidationContext): void {
  const id = def.colId ?? def.field ?? `col_${context.leafIndex}`;
  context.seenIds.set(id, (context.seenIds.get(id) ?? 0) + 1);
  if (def.field && !isSafePath(def.field)) {
    context.issues.push(`列 "${id}" 的 field 路径不安全或无效，已禁止读取和写入`);
  }
  if (!hasColumnValue(def)) {
    context.issues.push(`列 "${id}" 既无 field 也无 valueGetter，将始终显示空值（纯工具列请忽略此提示）`);
  }
  validateColumnWidths(def, id, context.issues);
}

function walkDefinitions(list: ColDefOrGroup<any>[], context: ColumnValidationContext): void {
  for (const def of list) {
    if (isColDefGroup(def)) {
      if (!Array.isArray(def.children) || def.children.length === 0) {
        context.issues.push(`列分组 "${def.headerName ?? def.groupId ?? "?"}" 的 children 为空`);
      } else {
        walkDefinitions(def.children, context);
      }
      continue;
    }
    context.leafIndex++;
    validateLeafDefinition(def, context);
  }
}

export function validateColumnDefs(defs: (ColDef<any> | ColDefGroup<any>)[] | null | undefined): string[] {
  if (!defs || defs.length === 0) return [];
  const context: ColumnValidationContext = { issues: [], seenIds: new Map(), leafIndex: 0 };
  walkDefinitions(defs, context);
  for (const [id, count] of context.seenIds) {
    if (count > 1) context.issues.push(`存在 ${count} 个重复的 colId/field "${id}"，已自动加后缀区分，建议显式命名 colId`);
  }
  return context.issues;
}
