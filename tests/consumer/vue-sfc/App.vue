<script setup lang="ts">
import { ref } from "vue";
import {
  MachTable,
  createColumnHelper,
  useMachTable,
  type MachTableVueExposed,
  type SelectionChangedEvent
} from "@agile-team/mach-table-vue";
import { MachTableToolbar } from "@agile-team/mach-table-vue/ui";

interface Order {
  id: string;
  customer: { name: string };
  amount: number;
}

const column = createColumnHelper<Order>();
const columns = [
  column.accessor("customer.name", { headerName: "客户" }),
  column.accessor("amount", { headerName: "金额", editable: true })
];
const rows: Order[] = [{ id: "o-1", customer: { name: "Ada" }, amount: 99 }];
const table = useMachTable<Order>();
const exposed = ref<MachTableVueExposed<Order> | null>(null);
const search = ref("");

function onSelectionChanged(event: SelectionChangedEvent<Order>) {
  event.selectedRows.forEach((row) => row.amount.toFixed(2));
}
</script>

<template>
  <MachTableToolbar v-model="search" :api="table.api.value" />
  <MachTable
    :ref="table.ref"
    :column-defs="columns"
    :row-data="rows"
    row-key="id"
    row-selection="multiple"
    @selection-changed="onSelectionChanged"
  />
  <MachTable ref="exposed" :column-defs="columns" :row-data="rows" row-key="id" />
</template>
