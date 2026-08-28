<script setup lang="ts">
import { ref } from "vue";
import { RobotGrid } from "@agile-team/mach-table-vue";
import type { ColDef } from "@agile-team/mach-table";

interface Order {
  id: string;
  product: string;
  qty: number;
  price: number;
  region: string;
}

const REGIONS = ["华东", "华南", "华北", "西南", "东北"];

function makeRows(count: number): Order[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `SO-${String(i + 1).padStart(6, "0")}`,
    product: `产品-${(i % 40) + 1}`,
    qty: 10 + ((i * 7) % 490),
    price: Math.round(100 + Math.random() * 9900),
    region: REGIONS[i % REGIONS.length]
  }));
}

const rowData = ref(makeRows(8000));
const selectedCount = ref(0);
const grid = ref<{ getApi: () => unknown } | null>(null);

const columnDefs: ColDef<Order>[] = [
  { field: "id", headerName: "订单号", width: 140, pinned: "left" },
  { field: "product", headerName: "产品", flex: 1, editable: true, filter: "text" },
  { field: "qty", headerName: "数量", width: 100, filter: "number", editable: true },
  {
    field: "price",
    headerName: "单价",
    width: 120,
    filter: "number",
    type: "rightAligned",
    valueFormatter: (p) => `¥${Number(p.value).toLocaleString()}`
  },
  { field: "region", headerName: "区域", width: 110, filter: "set" }
];
</script>

<template>
  <div style="padding: 16px; font-family: system-ui, sans-serif">
    <h3 style="margin-bottom: 12px">MachTable Vue 3 集成示例</h3>
    <div style="display: flex; gap: 8px; margin-bottom: 12px; align-items: center">
      <button @click="rowData = makeRows(rowData.length + 2000)">追加数据</button>
      <span style="color: #64748b; font-size: 13px">已选中 {{ selectedCount }} 行</span>
    </div>
    <div style="height: 70vh; min-height: 400px">
      <RobotGrid
        ref="grid"
        :column-defs="columnDefs"
        :row-data="rowData"
        :row-selection="'multiple'"
        :get-row-id="(p: any) => p.data.id"
        @selection-changed="(e: any) => (selectedCount = e.selectedRows.length)"
        @cell-value-changed="(e: any) => console.log('cell changed', e.colDef.field, e.newValue)"
      />
    </div>
  </div>
</template>
