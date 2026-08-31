# 主从明细（嵌套子表格）

行内展开一片自定义内容区——典型用法是嵌套子表格或详情表单。

## 基础

```ts
createGrid(host, {
  masterDetail: true,
  detailRowHeight: 260,
  detailToggleColumn: true,          // 自动插入左侧 ▶ 展开列（默认）
  columnDefs: [
    { field: "orderNo", headerName: "订单号", width: 140 },
    { field: "customer", headerName: "客户", flex: 1 }
  ],
  rowData: orders,
  rowKey: "id"
});
```

不提供 `detailRowRenderer` 时展开为空白占位；通常配合渲染器。

## 渲染器协议

```ts
detailRowRenderer: (params) => {
  // params: { data, node(主行), api }
  const div = document.createElement("div");
  div.textContent = `订单 ${params.data.orderNo} 明细…`;
  return div;                        // HTMLElement
  // 或返回字符串（纯文本）
  // 或 { el, destroy } —— 收起时自动调用 destroy（清理嵌套表格/组件实例）
}
```

**推荐返回 `{ el, destroy }`**：明细行被虚拟滚动回收时保证资源释放。

## 嵌套子表格（官方推荐姿势）

```ts
import { createGrid } from "@agile-team/mach-table";
import type { GridApi } from "@agile-team/mach-table";

detailRowRenderer: (params) => {
  const host = document.createElement("div");
  host.style.height = "100%";
  const childApi = createGrid<OrderItem>(host, {
    columnDefs: [
      { field: "sku", headerName: "物料", width: 120 },
      { field: "qty", headerName: "数量", width: 90, type: "rightAligned" }
    ],
    rowData: params.data.items,
    size: "compact"
  });
  return { el: host, destroy: () => childApi.destroy() };
};
```

## 框架组件渲染

```ts
// Vue
import { vueDetailRenderer } from "@agile-team/mach-table-vue/adapters";
detailRowRenderer: vueDetailRenderer(OrderDetailPanel)

// React
import { reactDetailRenderer } from "@agile-team/mach-table-react/adapters";
detailRowRenderer: reactDetailRenderer(OrderDetailPanel)
```

## 行级控制

```ts
// 部分行不可展开（隐藏 ▶）
isRowExpandable: (p) => p.data.hasDetail !== false

// 编程式
api.hierarchy.setRowExpanded(id, true);
api.hierarchy.setRowExpanded(id, false);
api.hierarchy.isRowExpanded(id);
api.hierarchy.setAllDetailsExpanded(true);
api.hierarchy.setAllDetailsExpanded(false);
```

## 行为细节

| 关注点 | 行为 |
| --- | --- |
| 展开状态 | 数据过滤/排序后跟随行 id 保持；`api.rows.setData()` 清空 |
| 事件 | `detailToggled: { rowId, rowNode, expanded }` |
| 高度 | 统一 `detailRowHeight`（变高明细请用 `getRowHeight` 按 `node.isDetail` 分支） |
| 选中/编辑 | 明细行不可选不可编辑；CSV 导出自动跳过 |
| 滚动 | 明细行参与变高行前缀和，滚动定位精确 |
| 与树形互斥 | `treeData` 同时开启时告警并忽略明细 |

## 变高明细行示例

```ts
getRowHeight: (p) =>
  p.node.isDetail
    ? 320
    : String(p.data?.remark ?? "").length > 30 ? 52 : 36
```
