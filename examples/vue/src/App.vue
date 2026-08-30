<script setup lang="ts">
import { ref } from "vue";
import { rowActionsColumn, type ColDef } from "@agile-team/mach-table-vue";
import { useMachTableController } from "@agile-team/mach-table-vue/workflows";

interface Order {
  id: string;
  product: string;
  qty: number;
  price: number;
  region: string;
}

const REGIONS = ["华东", "华南", "华北", "西南", "东北"];

function makeRows(count: number): Order[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `SO-${String(index + 1).padStart(6, "0")}`,
    product: `产品-${(index % 40) + 1}`,
    qty: 10 + ((index * 7) % 490),
    price: Math.round(100 + Math.random() * 9900),
    region: REGIONS[index % REGIONS.length]
  }));
}

const rows = ref(makeRows(8_000));
const controller = useMachTableController<Order>();

const columns: ColDef<Order>[] = [
  { field: "id", headerName: "订单号", width: 140, pinned: "left" },
  { field: "product", headerName: "产品", flex: 1, editable: true, filter: "text" },
  { field: "qty", headerName: "数量", width: 100, filter: "number", editable: true },
  {
    field: "price",
    headerName: "单价",
    width: 120,
    filter: "number",
    type: "rightAligned",
    valueFormatter: ({ value }) => `¥${Number(value).toLocaleString()}`
  },
  { field: "region", headerName: "区域", width: 110, filter: "set" },
  rowActionsColumn<Order>({
    max: 3,
    overflow: "drawer",
    drawerTitle: "订单操作",
    onView: ({ data }) => window.alert(`查看 ${data.id}`),
    onSave: async ({ data }, changes) => {
      console.info("save", data.id, changes);
    },
    onDelete: ({ data }) => {
      rows.value = rows.value.filter((row) => row.id !== data.id);
    },
    extraActions: [
      { icon: "copy", label: "复制订单号", onClick: ({ data }) => navigator.clipboard?.writeText(data.id) },
      { icon: "download", label: "导出订单", onClick: ({ data }) => console.info("export", data.id) }
    ]
  })
];
</script>

<template>
  <main class="demo-page">
    <h1>MachTable Vue 3 集成示例</h1>
    <MachTableToolbar
      v-model="controller.search.value"
      :api="controller.table.api.value"
      :commands="controller.commands"
      :loading="controller.busy.value"
      :selected-count="controller.selectedCount.value"
      @clear-selection="controller.table.api.value?.deselectAll()"
    >
      <button type="button" @click="rows = makeRows(rows.length + 2_000)">追加 2,000 行</button>
    </MachTableToolbar>

    <div class="demo-grid">
      <MachTable
        :ref="controller.table.ref"
        preset="crud"
        :column-defs="columns"
        :row-data="rows"
        row-key="id"
        state-key="vue-orders"
      />
    </div>
  </main>
</template>

<style scoped>
.demo-page { display: grid; gap: 12px; padding: 16px; font-family: system-ui, sans-serif; }
h1 { margin: 0; font-size: 20px; }
.demo-grid { height: 70vh; min-height: 400px; }
</style>
