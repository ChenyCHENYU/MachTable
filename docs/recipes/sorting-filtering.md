# 排序与过滤

## 排序

**交互**：点击表头循环 升 → 降 → 无；`Shift + 点击` 叠加多列（表头显示序号徽标 ①②）；开启 `enableColumnResize` 后可双击列宽把手自适应，列菜单中的自适应命令不受该交互开关影响。

```ts
// 声明
{ field: "amount", headerName: "金额", sortable: true /* 默认 */, initialSort: "desc",
  comparator: (a, b) => a - b }        // 自定义比较器（缺省用内置）

// 编程式
api.sorting.setModel([
  { colId: "region", direction: "asc" },
  { colId: "amount", direction: "desc" }
]);
api.sorting.getModel();
```

内置比较器语义：null/空串排末、数值与日期按大小、字符串 `localeCompare`（numeric + 忽略大小写）。多列排序稳定（同键保持原序）。

**空值与特殊值**：`null`/`undefined`/`""` 一律排最后（升序与降序都是）。

## 服务端排序

```ts
manualSorting: true,           // 本地不排序，表头指示器照常
onSortChanged: (e) => fetchPage({ sort: e.sortModel })   // 自行请求并 rows.setData
```

无限滚动模式下排序变更自动携带 `sortModel` 从第 0 行重载，无需额外处理。

## 过滤

### 内置过滤器（表头弹面板）

| 类型 | 条件 |
| --- | --- |
| `"text"` | 包含 / 不包含 / 等于 / 不等于 / 开头 / 结尾 / 为空 / 不为空（忽略大小写） |
| `"number"` | = ≠ < ≤ > ≥ / 介于（范围）/ 为空 / 不为空 |
| `"date"` | = ≠ 早于 / 晚于 / 介于 / 为空 / 不为空 |
| `"set"` | 勾选候选值（默认从数据派生，上限 500，可 `filterParams.values` 指定） |

激活过滤的列表头显示**条件摘要 tag**（如 `> 100`、`已选 3 项`）。

### FilterModel API（配合自定义筛选栏）

```ts
api.filtering.setModel({
  amount: { type: "number", conditions: [{ match: "inRange", value: 100, value2: 500 }] },
  status: { type: "set", values: ["运行中", "待机"] },
  name:   { type: "text", conditions: [{ match: "contains", value: "泵" }] }
});
api.filtering.getModel();
api.filtering.isPresent("amount");
```

多条件：`conditions` 数组 + `operator: "and" | "or"`（默认 and）。模型可直接 JSON 序列化——适合"保存我的筛选"功能。

### 全局快速过滤

```ts
// 分词 AND、跨列 OR 包含，覆盖所有列的格式化文本
api.filtering.setQuickText("华东 泵");
createGrid(host, { quickFilterText: "xxx" });
```

### 过滤与 valueGetter

过滤基于 `valueGetter ?? field` 的原始值（不是格式化文本）；若希望按显示文本过滤，在 `valueGetter` 中返回格式化串。

### 服务端过滤

```ts
manualFiltering: true,
onFilterChanged: (e) => fetchPage({ filter: e.filterModel })
```

## 排序 + 过滤 + 分组的数据流

单管线顺序：**过滤 → 排序 → 分组/树/明细拼接 → 序号分配 → 行合并计算**。过滤隐藏的行不参与分组聚合与序号。
