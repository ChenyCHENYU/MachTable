import type { ColDef, ColDefGroup, ColDefOrGroup } from "../types/colDef";
import { isColDefGroup } from "../types/colDef";
import { isSafePath } from "./path";

export function validateColumnDefs(defs: (ColDef<any> | ColDefGroup<any>)[] | null | undefined): string[] {
  if (!defs || defs.length === 0) return [];
  const issues: string[] = [];
  const seenIds = new Map<string, number>();
  let leafIndex = 0;

  const walk = (list: ColDefOrGroup<any>[], depth: number): void => {
    for (const def of list) {
      if (isColDefGroup(def)) {
        if (!Array.isArray(def.children) || def.children.length === 0) {
          issues.push(`列分组 "${def.headerName ?? def.groupId ?? "?"}" 的 children 为空`);
          continue;
        }
        walk(def.children, depth + 1);
        continue;
      }
      leafIndex++;
      const id = def.colId ?? def.field ?? `col_${leafIndex}`;
      seenIds.set(id, (seenIds.get(id) ?? 0) + 1);

      if (def.field && !isSafePath(def.field)) {
        issues.push(`列 "${id}" 的 field 路径不安全或无效，已禁止读取和写入`);
      }

      if (!def.field && !def.valueGetter && !def.checkboxSelection && !def.autoRowSpan && !def.rowSpan) {
        issues.push(`列 "${id}" 既无 field 也无 valueGetter，将始终显示空值（纯工具列请忽略此提示）`);
      }
      if (def.width != null && def.minWidth != null && def.width < def.minWidth) {
        issues.push(`列 "${id}" 的 width(${def.width}) 小于 minWidth(${def.minWidth})，将按 minWidth 渲染`);
      }
      if (def.width != null && def.maxWidth != null && def.width > def.maxWidth) {
        issues.push(`列 "${id}" 的 width(${def.width}) 大于 maxWidth(${def.maxWidth})，将按 maxWidth 渲染`);
      }
    }
  };

  walk(defs, 0);
  for (const [id, count] of seenIds) {
    if (count > 1) issues.push(`存在 ${count} 个重复的 colId/field "${id}"，已自动加后缀区分，建议显式命名 colId`);
  }
  return issues;
}
