import { createActionButtonsRenderer, type ColDef } from "@agile-team/mach-table";

export interface BenchRow {
  id: string;
  c0: string;
  c1: string;
  c2: number;
  c3: string;
  c4: number;
  c5: string;
  c6: string;
  c7: number;
}

const STATUSES = ["运行中", "待机", "故障"];

export function makeRows(n: number, seed = 20261026): BenchRow[] {
  let state = seed >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const rows: BenchRow[] = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      id: `r${i}`,
      c0: `RG-${String(i + 1).padStart(6, "0")}`,
      c1: `设备-${i + 1}`,
      c2: Math.round(random() * 100000) / 100,
      c3: STATUSES[i % 3],
      c4: Math.round(random() * 100),
      c5: `车间-${(i % 12) + 1}`,
      c6: new Date(Date.UTC(2026, 9, 26) - random() * 86400000 * 30).toISOString(),
      c7: Math.round(random() * 1000)
    });
  }
  return rows;
}

export function buildDefs(colCount: number): ColDef<BenchRow>[] {
  const base: ColDef<BenchRow>[] = [
    { field: "c0", headerName: "编号", width: 130 },
    { field: "c1", headerName: "名称", width: 160 },
    { field: "c2", headerName: "数值", width: 110, type: "rightAligned" },
    { field: "c3", headerName: "状态", width: 110, cellRenderer: "statusTag" },
    { field: "c4", headerName: "进度", width: 140, cellRenderer: "progressBar" },
    { field: "c5", headerName: "车间", width: 100 },
    { field: "c6", headerName: "更新时间", width: 170 },
    { field: "c7", headerName: "计数", width: 90, type: "rightAligned" }
  ];
  const defs = base.slice(0, Math.min(colCount, 6));
  for (let i = defs.length; i < colCount - 1; i++) {
    defs.push({ field: `x${i}`, headerName: `扩展列 ${i}`, width: 120, valueGetter: (p) => (p.node.rowIndex + i) % 997 });
  }
  defs.push({
    colId: "op",
    headerName: "操作",
    width: 120,
    pinned: "right",
    sortable: false,
    resizable: false,
    movable: false,
    cellRenderer: createActionButtonsRenderer({
      actions: [
        { icon: "view", title: "查看", onClick: () => undefined },
        { icon: "edit", title: "编辑", onClick: () => undefined },
        { icon: "delete", title: "删除", variant: "danger", onClick: () => undefined }
      ]
    })
  });
  return defs;
}
