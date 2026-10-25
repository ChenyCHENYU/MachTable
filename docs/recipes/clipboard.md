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
api.selection.getRange();      // { row1, row2, colId1, colId2 } | null
api.selection.clearRange();
onRangeSelectionChanged: (e) => ...
```

## 剪贴板（Excel TSV 互通）

| 快捷键 | 行为 |
| --- | --- |
| `Ctrl/Cmd + C` | 复制范围为 TSV（Tab 分列、换行分行、引号转义）——可直接粘进 Excel |
| `Ctrl/Cmd + X` | 复制 + 清除范围内可编辑格（单条撤销单元） |
| `Ctrl/Cmd + V` | 从锚点格铺开粘贴：数字自动转型、跳过只读/复选框/序号列、跳过分组与明细行、越界截断 |
| `Delete` / `Backspace` | 清除范围内可编辑格（单条撤销单元） |

粘贴、清空和填充复用编辑器已有的 `editable`、列 `validate`、整行 `rowEditValidator` 与 `valueSetter`，不需要额外配置。整行校验的 `values` 包含当前各列值及本次拟修改值，因此跨字段约束也适用于批量输入。

批量输入按行校验和提交：某行校验失败，该行不写入；其他有效行一起形成一条撤销记录。失败通过 `gridError` 的 `VALIDATION_ERROR` 报告，详情包含行 ID 与字段错误。同步校验仍同步生效；存在异步校验时，所有校验完成后才提交。新的批量输入、Escape、撤销/重做、开始编辑或销毁实例会取消旧的待提交输入，行数据或列被替换后，旧校验结果也不会写回。

`valueSetter` 应只负责当前字段赋值；某个 setter 拒绝写入时，内核会尝试恢复该行已写字段。自定义 setter 的外部副作用无法由表格撤销。服务端返回的数据继续使用 `rows.transact()`，不会被当作用户输入重新校验。

```ts
// 系统剪贴板 API（右键菜单同款）
await api.io.copyRange();
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
