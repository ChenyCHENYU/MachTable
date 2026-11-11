# Schema 驱动渲染

报表接口可以一起返回列和行。列定义已经是 `{ field, headerName }` 时，直接传给 `columnDefs`。接口使用 `field / title / type` 描述字段时，用 `buildColDefsFromSchema()` 转换。

## Vue 接入报表接口

假设项目的 `getReportApi()` 返回 `{ schema: GridSchema, rows: ReportRow[] }`，每行含有稳定、唯一的 `id`。

```vue
<script setup lang="ts">
import { computed, onMounted, shallowRef } from "vue";
import { MachTable, buildColDefsFromSchema } from "@agile-team/mach-table-vue";
import { getReportApi } from "@/api/report";

const report = shallowRef<Awaited<ReturnType<typeof getReportApi>>>();
const schema = computed(() => report.value?.schema);
const columns = computed(() => schema.value ? buildColDefsFromSchema(schema.value) : []);
const rows = computed(() => report.value?.rows ?? []);

async function loadReport() {
  report.value = await getReportApi();
}

onMounted(loadReport);
</script>

<template>
  <MachTable :column-defs="columns" :row-data="rows" row-key="id" />
</template>
```

一次替换响应即可更新列和行。只刷新数据或翻页时，复用同一份 `schema`，避免重新生成列定义。跨查询保持字段标识稳定，表头名称可以随接口更新。

同一个报表新增或删减字段时，表格按稳定列 ID 延续现有列偏好。切换到独立报表时，Vue 用 `:key="reportId"` 区分实例。启用列状态持久化的页面也应为每个报表分配独立的 `persistence.key`。

`initialSort` 在列首次创建时生效。刷新同 ID 列的标题或配置，会保留用户当前排序，包括已经清空排序的状态。

## Schema 结构

```ts
import { buildColDefsFromSchema } from "@agile-team/mach-table";
import type { GridSchema } from "@agile-team/mach-table";

const schema: GridSchema = {
  fields: [
    { field: "orderNo", title: "订单号", type: "string", width: 130 },
    { field: "owner",   title: "负责人", type: "select", width: 110, editable: true,
      options: [{ label: "张三", value: "zhang" }, { label: "李四", value: "li" }] },
    { field: "amount",  title: "金额", type: "number" },
    { field: "done",    title: "完成", type: "boolean", width: 70 },
    { field: "at",      title: "更新时间", type: "date", format: "datetime", width: 150 },
    { field: "remark",  title: "备注", filterable: false, hidden: false }
  ],
  groups: [{ groupId: "execution", title: "执行信息", fields: ["owner", "amount"] }]
};

const api = createGrid(host, {
  columnDefs: buildColDefsFromSchema(schema),
  rowData
});
```

## 字段类型自动映射

| `type` | 生成行为 |
| --- | --- |
| `"string"`（默认） | 文本过滤器 |
| `"number"` | 居中等宽数字、数字过滤器；`editable` 时使用数字编辑器，即使初始值为空 |
| `"date"` | `format: "date" \| "datetime"` 格式化、日期过滤器；`editable` 时使用日期编辑器，即使初始值为空 |
| `"select"` | options 字典翻译显示（`value → label`）+ set 过滤器；`editable` 时生成 select 下拉编辑器（值为原始 value） |
| `"boolean"` | `是 / 否` 格式化 + set 过滤器 |

## 字段清单

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `field` | `string` | 数据字段（必填） |
| `title` | `string` | 表头文本 |
| `type` | `string \| number \| date \| select \| boolean` | 字段类型 |
| `width` / `minWidth` / `maxWidth` / `flex` | `number` | 列宽 |
| `pinned` | `"left" \| "right"` | 固定列 |
| `editable` / `sortable` / `filterable` / `resizable` / `hidden` | `boolean` | 开关（sortable/resizable 默认 true） |
| `options` | `{ label, value }[]` | select 字典 |
| `format` | `"date" \| "datetime"` | date 展示格式 |
| `cellClass` | `string \| string[]` | 附加类名 |

## groups 与字段去重

`groups[].fields` 引用的字段渲染为分组表头子列。未分组字段按声明顺序排在前，同名字段只出现一次。分组会改名或有同名分组时，为每组提供唯一、稳定的 `groupId`，更新标题时便可保留组内列顺序。

## 与渲染器注册表组合（完全可序列化配置）

Schema 覆盖通用映射；特殊列用**注册名**表达，整份列配置可存 JSON：

```ts
// 专用配置文件集中维护代码侧能力
const components = {
  cellRenderers: { statusBadge: (p) => renderStatusBadge(p.value) },
  cellEditors: { "ep-select": epSelectEditor() }
};

// Schema 的字段级扩展：构建后追加
const defs = buildColDefsFromSchema(schema);
defs[2].cellRenderer = "statusBadge";   // 或在 fields 元数据中约定 renderer: "statusBadge" 后映射
```

把 `components` 放进 `defineMachTableConfig({ components })` 可供全应用复用；也可以只传给当前表格。Schema 只保存稳定注册名，不保存函数。
