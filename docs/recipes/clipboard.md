# 框选 / 复制 / 粘贴 / 填充

## 开启

```ts
createGrid(host, {
  enableRangeSelection: true,   // 框选 + 剪贴板 + Delete
  fillHandle: true,             // 填充柄（默认 true）
  contextMenu: true             // 右键菜单（可选）
});
```

## 范围选择

| 操作 | 行为 |
| --- | --- |
| 鼠标拖选 | 框选 |
| Shift + 点击 | 扩展到该格 |
| Shift + 方向键 | 逐格扩展（焦点跟随） |
| Escape | 取消范围 |
| 点击范围外 | 重新起始 |

范围高亮为描边样式（四边 1.5px 主题色），不遮挡内容。状态栏 `rangeAggregate` 面板实时显示框选数值的 **和 / 均 / 计**。

```ts
api.getRangeSelection();      // { row1, row2, colId1, colId2 } | null
api.clearRangeSelection();
onRangeSelectionChanged: (e) => ...
```

## 剪贴板（Excel TSV 互通）

| 快捷键 | 行为 |
| --- | --- |
| `Ctrl/Cmd + C` | 复制范围为 TSV（Tab 分列、换行分行、引号转义）——可直接粘进 Excel |
| `Ctrl/Cmd + X` | 复制 + 清除范围内可编辑格（单条撤销单元） |
| `Ctrl/Cmd + V` | 从锚点格铺开粘贴：数字自动转型、跳过只读/复选框/序号列、跳过分组与明细行、越界截断 |
| `Delete` / `Backspace` | 清除范围内可编辑格（单条撤销单元） |

粘贴写入走 `valueSetter` 与 `validate`，并遵守 `editable` 回调——与服务端编辑约束完全一致。

```ts
// 系统剪贴板 API（右键菜单同款）
await api.copyRangeToClipboard();
```

`suppressClipboard: true` 可整体禁用快捷键与菜单剪贴板项（如含敏感数据的页面）。

::: tip 权限说明
Ctrl+V 走浏览器原生 `paste` 事件（无需权限）；右键菜单"粘贴"调用 `navigator.clipboard.readText`，Chrome/Edge 需用户已授予剪贴板读取权限，失败静默跳过。
:::

## 填充柄

选中范围（≥1 格）后右下角出现填充柄，向下拖拽：

| 源内容 | 填充规则 |
| --- | --- |
| 单值 | 逐格复制 |
| 多个文本 | 循环重复（`n0,n1 → n0,n1,n0…`） |
| 纯数值序列 | 等差外推（`1,3 → 5,7,9`；整数序列保持整数，浮点保留 6 位） |

拖拽过程实时高亮目标区；松手一次写入（**单条撤销单元**）；只写可编辑格。

## 右键菜单

`contextMenu: true` 后在单元格右键弹出（跟随 i18n）：复制 / 粘贴 / 清除内容。点击菜单外或 Escape 关闭。自定义菜单项：监听 `cellContextMenu` 事件 `e.preventDefault()` 后弹自己的菜单。

## 与其他能力的组合

| 组合 | 说明 |
| --- | --- |
| 撤销 | 剪切/粘贴/清除/填充均为单条撤销单元 |
| 无限滚动 | 框选/粘贴限于已加载行 |
| 分组 / 树形 | 分组行、明细行自动跳过 |
| 服务端持久化 | 全部写值统一发 `cellValueChanged`，批量操作逐格触发 |
