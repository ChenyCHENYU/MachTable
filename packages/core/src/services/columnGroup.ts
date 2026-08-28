import type { ColDefGroup } from "../types/colDef";
import type { Column } from "./column";

export class ColumnGroup<TData = any> {
  readonly groupId: string;
  readonly def: ColDefGroup<TData>;
  parent: ColumnGroup<TData> | null = null;
  children: (ColumnGroup<TData> | Column<TData>)[] = [];

  constructor(groupId: string, def: ColDefGroup<TData>) {
    this.groupId = groupId;
    this.def = def;
  }

  get headerName(): string {
    return this.def.headerName ?? this.def.groupId ?? "";
  }

  getLeafColumns(out: Column<TData>[] = []): Column<TData>[] {
    for (const child of this.children) {
      if (child instanceof ColumnGroup) child.getLeafColumns(out);
      else out.push(child);
    }
    return out;
  }
}
