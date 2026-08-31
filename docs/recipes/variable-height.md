# 变高行与换行

## 最简写法（autoHeight 内容自适应）

列上同时开 `autoHeight` + `wrapText`，行高按内容自动算，无需回调：

```ts
{ field: "desc", headerName: "描述", flex: 1, wrapText: true, autoHeight: true }
```

- 按列宽用 canvas 逐字测量换行行数（CJK 安全），行高 = 行数 × 行高 + 内边距
- 结果进入 per-node 行高缓存：滚动/重排零重复测量，编辑/撤销后仅该行失效重测
- 多列 autoHeight 取最大行数；与 `getRowHeight` 并存时取两者最大值

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
- 基于前缀和 + 二分查找定位，滚动、`scrollToIndex`、行合并、明细行全部精确
- 行池按**最小行高**估算容量，变高行多时自动扩池
- 运行时更新：`api.updateOptions({ getRowHeight: fn })` 自动重排

## 自动换行（wrapText）

`wrapText: true` 让单元格内容折行显示（`white-space: normal` + 顶部对齐）：

```ts
{ field: "desc", headerName: "描述", flex: 1, wrapText: true }
```

::: tip 换行样式与行高是两件事
`wrapText` 只负责折行样式；行高由 `getRowHeight` 决定。两者配合才是完整的多行单元格。
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
`getRowHeight` 在每次布局计算中对**全部行**调用一次。请保持纯函数 + 轻计算（不要在里面做 DOM 测量/正则重活）。基于内容自动测量行高在路线图中。
:::

## 限制

| 场景 | 行为 |
| --- | --- |
| 无限滚动 | 未加载的行使用固定 `rowHeight`（前缀和按默认高预估，块加载后修正） |
| 固定首末行 | 跟随 `rowHeight`，暂不支持单独定制 |
| 行合并（rowSpan/autoRowSpan） | 兼容：合并格高度按被覆盖行的实际高度差计算 |
| 动态高度变化（编辑后文本变长） | 调 `api.updateOptions({ getRowHeight })`（传同一函数引用即可触发重算）或 `api.view.refreshLayout()` |
