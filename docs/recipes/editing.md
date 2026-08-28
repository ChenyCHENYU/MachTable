# 单元格编辑与校验

## 进入编辑的方式

| 方式 | 配置 |
| --- | --- |
| 双击 | 默认（列 `editable: true`） |
| Enter / F2 | 焦点格可编辑时 |
| 单击 | `singleClickEdit: true`（全局）或列级 `singleClickEdit: true` |
| 编程式 | `api.startEditingCell({ rowIndex: 0, colId: "name" })` |

结束：Enter/Tab/点击他处（保存）；Escape（取消）；`api.stopEditing(cancel?)`。

## 内置编辑器

| `cellEditor` | 推断规则 | 值类型 |
| --- | --- | --- |
| `"text"`（默认） | — | `string` |
| `"number"` | 原值是 number | `number \| null` |
| `"date"` | 原值是 Date / ISO 字符串 | `string`（保留原值时间部分 `HH:mm`） |
| `"select"` | 配了 `cellEditorParams.values` | 选项原始类型 |

```ts
{ field: "level", editable: true, cellEditor: "select",
  cellEditorParams: { values: ["P1", "P2", "P3"] } }
```

编辑器按值类型自动推断，多数情况只需 `editable: true`。

## 动态可编辑

```ts
{ field: "qty", editable: (p) => p.data.status === "draft" }
```

粘贴 / 填充柄 / Delete 批量清除同样遵守此规则（只写可编辑格）。

## 写值链路：valueSetter

默认按 `field` 点路径写值。自定义：

```ts
{
  field: "price",
  editable: true,
  valueSetter: (p) => {
    if (p.newValue < 0) return false;          // 返回 false = 未变更（不发事件）
    p.data.price = p.newValue;
    p.data.total = p.data.qty * p.newValue;    // 联动其他字段
    return true;
  }
}
```

编辑 / 粘贴 / 填充 / 剪切 / 撤销全部走同一写值链路。

## 校验（validate）

```ts
{
  field: "score",
  editable: true,
  validate: (value) =>
    typeof value === "number" && value >= 0 && value <= 100 ? true : "请输入 0-100"
}
```

- 返回字符串 = 拦截：编辑器红框 + title 提示、保持编辑态、**值不落库**、不发 `cellValueChanged`
- 修正后重新输入即清除错误态
- `null` / `undefined` / `true` 均视为通过

## 自定义编辑器

实现 `ICellEditor` 接口即可，返回 `{ el, getValue, focus?, destroy? }`：

```ts
cellEditor: (params) => {
  const input = document.createElement("input");
  input.className = "mach-editor-input";
  input.type = "text";
  input.value = params.value ?? "";
  return {
    el: input,
    getValue: () => input.value,
    focus: () => { input.focus(); input.select(); },
    destroy: () => { /* 清理（如卸载 Vue/React root）*/ }
  };
};
```

挂 UI 库组件（el-select / n-date-picker 等）见 [Element Plus 集成](/guide/element-plus) / [Naive UI 集成](/guide/naive-ui)。

高频编辑器建议注册后用字符串引用（配置可序列化）：

```ts
registerCellEditor("qtyEditor", myEditor);
{ field: "qty", editable: true, cellEditor: "qtyEditor" }
```

## 键盘流

`Tab` / `Shift+Tab` 在可编辑格之间横向跳转（自动滚动到可见），Enter 确认后下一行同列可编辑格——Excel 式连续录入无需碰鼠标。

## 事件

```ts
onCellEditingStarted: (e) => console.log("开始", e.colId),
onCellEditingStopped: (e) => console.log("结束", e.oldValue, e.newValue),
onCellValueChanged: (e) => {
  // 编辑/粘贴/填充/清除/撤销 统一入口
  api.autoSizeColumn(e.colDef.colId ?? "");
  submitDraft(e.data);
}
```

## 与撤销联动

每次成功写值自动入撤销栈；`api.undo()` 可回滚（含批量操作整体回滚），详见[撤销/重做](/recipes/undo-redo)。
