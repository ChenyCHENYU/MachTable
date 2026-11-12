# 变高行与换行

## 最简写法（autoHeight 内容自适应）

列上同时开 `autoHeight` + `wrapText`，行高按内容自动算，无需回调：

```ts
{ field: "desc", headerName: "描述", flex: 1, wrapText: true, autoHeight: true }
```

- 复用单个不可见测量节点，按浏览器实际的字体、列宽和换行规则计算文字高度，包含内边距与边框。
- 行高按节点缓存。同宽、同文本复用测量节点的排版，超长测量文本立即释放。普通滚动复用行高缓存，文字、列宽和字体变化后重新测量。
- WebFont 加载完成后自动更新测宽和行高缓存。以代码添加已加载的字体时，调用 `api.view.refreshLayout()` 同步字体变化，无需拖动列宽。
- 多列 `autoHeight` 取最高结果；与 `getRowHeight` 并存时取两者最大值。自定义渲染器的高度使用 `getRowHeight` 指定。

## 变高行（getRowHeight 回调，完全控制）

```ts
createGrid(host, {
  rowData,
  getRowHeight: (p) => {
    if (p.node.isDetail) return 320;                    // 明细行统一高度
    return String(p.data?.remark ?? "").length > 30 ? 56 : 36;
  },
  columnDefs: [
    { field: "remark", headerName: "备注", flex: 1, wrapText: true },
    { field: "name", headerName: "名称", width: 120 }
  ]
});
```

- 返回值单位 px，最小 1；非法值回退 `rowHeight`
- 使用 Fenwick 索引维护偏移，定位和单行高度更新均为 O(log n)。
- 行池按**最小行高**估算容量，变高行多时自动扩池
- 运行时更新：`api.updateOptions({ getRowHeight: fn })` 自动重排

## 自动换行（wrapText）

`wrapText: true` 让单元格内容折行显示（`white-space: normal` + 顶部对齐）：

```ts
{ field: "desc", headerName: "描述", flex: 1, wrapText: true }
```

::: tip 换行样式与行高是两件事
`wrapText` 负责折行样式。配合 `autoHeight` 自动测量文字，或用 `getRowHeight` 指定业务行高。
:::

## 常用估算策略

```ts
// 按字符长度阶梯
getRowHeight: (p) => {
  const len = String(p.data?.desc ?? "").length;
  return len > 60 ? 72 : len > 25 ? 54 : 36;
}

// 按显式字段
getRowHeight: (p) => p.data?.heightOverride ?? 36
```

::: warning 性能建议
`getRowHeight` 的结果按节点缓存，保持回调纯净且轻量。只改变行内容的事务会更新受影响行的高度索引；排序、分页等改变行位置时重新计算。回调依赖外部状态或其他行时，调用 `api.updateOptions({ getRowHeight })` 显式更新缓存。

大量唯一长文本的 `autoHeight` 仍需首次排版测量；多列会叠加此成本。普通字段的内容事务只重新测量受影响行，并局部更新高度索引。包含 `valueGetter` / `valueFormatter` 的自动测高列可访问整表，继续使用完整投影与高度失效以保证结果正确。高频更新的大列表优先使用固定行高或轻量 `getRowHeight`。
:::

## 限制

| 场景 | 行为 |
| --- | --- |
| 无限滚动 | 未加载的行使用固定 `rowHeight`（前缀和按默认高预估，块加载后修正） |
| 固定首末行 | 跟随 `rowHeight`，暂不支持单独定制 |
| 行合并（rowSpan/autoRowSpan） | 兼容：合并格高度按被覆盖行的实际高度差计算 |
| 回调依赖的外部状态变化 | 调 `api.updateOptions({ getRowHeight })`，可传同一函数引用重算。普通布局刷新复用行高缓存 |

动态列与数据一起更新时，先完成列宽布局，再测量换行行高；不会为临时零宽度额外测量一遍。
