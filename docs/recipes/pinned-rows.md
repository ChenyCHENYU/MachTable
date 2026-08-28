# 固定首末行（Pinned Rows）

表体上下各一条**只读展示行**，滚动时不随数据滚动——常用于汇总条、合计行、差异行、快捷操作行。

## 使用

```ts
createGrid(host, {
  columnDefs,
  rowData,
  pinnedTopRowData: [
    { name: "差异行", amount: -120, updatedAt: "2026-08-26" }   // 结构与 rowData 相同
  ],
  pinnedBottomRowData: [
    { name: "合计", amount: 99800, updatedAt: "" }
  ]
});
```

固定行数据结构必须与 `rowData` 一致（走同一套 ColDef 渲染）。

## 运行时更新

```ts
api.setPinnedTopRowData([diffRow]);      // 传 null/[] 清空并隐藏该区域
api.getPinnedTopRowData();
api.setPinnedBottomRowData([totalRow]);
api.getPinnedBottomRowData();
```

## 渲染能力

固定行支持与普通行一致的**展示类**能力：

| 能力 | 支持 |
| --- | --- |
| `valueFormatter` / `cellRenderer` / `cellClass` / `cellStyle` / `tooltipValueGetter` | ✅ |
| 多级表头对齐、固定列对齐、横向滚动同步 | ✅ |
| `wrapText`（配合足够行高） | ✅ |
| 复选框列 / 展开列 / 拖拽列 / 序号列 | 渲染为空占位 |

## 语义边界（设计为只读）

- 不参与选择、编辑、排序、过滤、分组
- 不计入 `getDisplayedRowCount()` 与序号列
- CSV 导出不包含固定行
- 行高跟随 `rowHeight`（暂不支持 `getRowHeight` 单独定制固定行）

## 与合计行（showSummary）的区别

| 方案 | 适用 |
| --- | --- |
| `pinnedTop/BottomRowData` | 需要**完整数据行**的展示（如"本页合计 + 上期对比"两行、带渲染器的差异行） |
| `showSummary + summaryMethod` | 每列一段文本的简单合计（跟随过滤/排序自动重算） |
| 状态栏 `rangeAggregate` | 用户框选的临时聚合 |

三者可同时使用。

## 常见示例：跟随数据变化的合计

```ts
onCellValueChanged: () => {
  const sum = rows.reduce((a, r) => a + r.amount, 0);
  api.setPinnedBottomRowData([{ name: "合计", amount: sum }]);
}
```
