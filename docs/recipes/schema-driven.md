# Schema 驱动渲染

设计器 / 低代码平台的页面描述 JSON 直接生成列配置——表格"由数据渲染"。

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
  groups: [{ title: "执行信息", fields: ["owner", "amount"] }]   // 可选：生成多级表头
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
| `"number"` | 右对齐 + tabular-nums + 数字过滤器 |
| `"date"` | `format: "date" \| "datetime"` 格式化（ISO → 日期/日期时间）+ 日期过滤器 |
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

`groups[].fields` 引用的字段渲染为分组表头子列；未分组字段按声明顺序排在前。同名字段只出现一次。

## 与渲染器注册表组合（完全可序列化配置）

Schema 覆盖通用映射；特殊列用**注册名**表达，整份列配置可存 JSON：

```ts
// 应用启动时注册一次
registerCellRenderer("statusBadge", (p) => renderStatusBadge(p.value));
registerCellEditor("ep-select", epSelectEditor());

// Schema 的字段级扩展：构建后追加
const defs = buildColDefsFromSchema(schema);
defs[2].cellRenderer = "statusBadge";   // 或在 fields 元数据中约定 renderer: "statusBadge" 后映射
```

## 动态 Schema（设计器联动）

```ts
watch(schema, (next) => {
  api.setColumnDefs(buildColDefsFromSchema(next));   // 列状态（宽/序/显隐）按 colId 保留
});
```
