# 单元格与整行编辑

## 进入编辑的方式

| 方式 | 配置 |
| --- | --- |
| 双击 | 默认（列 `editable: true`） |
| Enter / F2 | 焦点格可编辑时 |
| 单击 | `singleClickEdit: true`（全局）或列级 `singleClickEdit: true` |
| 编程式 | `api.startEditingCell({ rowIndex: 0, colId: "name" })` |

结束：Enter/Tab/点击他处（保存）；Escape（取消）；`api.stopEditing(cancel?)`。

可编辑格默认在 hover / 键盘聚焦时显示轻量铅笔入口。进入编辑后，当前格呈现输入框和就地的对勾/取消按钮；对勾与 Enter 走同一条校验提交链路，取消与 Escape 都不会写值：

```ts
const options = {
  editableIndicator: "hover" // "always" | "none"
};
```

`hover` 保持浏览态干净，`always` 适合录入型页面，`none` 适合完全依赖双击、键盘或外部按钮的场景。

## 整行编辑

整行编辑不是连续触发多个单元格提交。它会暂存该行所有可编辑值，全部校验通过后再事务式写入，并把这一批改动作为一个 undo 批次；任意字段校验失败或 `valueSetter` 拒绝时，已尝试的字段会回滚，不发送部分 `cellValueChanged`，整行继续保持编辑。

```ts
import { rowActionsColumn } from "@agile-team/mach-table";

const options = {
  editType: "fullRow",
  columnDefs: [
    { field: "name", editable: true },
    { field: "age", editable: true, cellEditor: "number" },
    { field: "department", editable: true, cellEditor: "select",
      cellEditorParams: { values: ["技术部", "人事部"] } },
    rowActionsColumn({
      onView: ({ data }) => openDetail(data),
      onDelete: ({ data }) => confirmDelete(data),
      labels: { view: "查看", edit: "编辑", delete: "删除", save: "保存", cancel: "取消" }
    })
  ]
};
```

浏览态操作列显示查看、编辑、删除等业务动作；点击编辑后，整行可编辑格切为输入框，操作列只保留对勾和取消。此时 Enter 提交整行、Escape 取消整行、Tab / Shift+Tab 在该行编辑器间循环。

也可完全由业务按钮控制：

```ts
api.startEditingRow(rowIndex);
api.isRowEditing(rowIndex);
await api.stopEditingRow(false); // 校验并保存草稿到行数据
await api.stopEditingRow(true);  // 丢弃整行草稿
```

同一表格同一时刻只允许一个编辑会话，避免多行草稿、排序过滤和虚拟滚动之间出现隐式冲突。横向或纵向虚拟滚动会保存整行草稿并在单元格重新出现时恢复编辑器。

跨字段规则使用 `rowEditValidator`。`values` 以 `colId` 为键包含全部可编辑草稿；返回普通字符串会定位到首个变更格，返回 `{ [colId]: message }` 可同时精确标红多个字段：

```ts
rowEditValidator: async ({ values, data }) => {
  if (new Date(String(values.startAt)) > new Date(String(values.endAt))) {
    return { startAt: "开始时间不能晚于结束时间", endAt: "请调整时间范围" };
  }
  return await permissionApi.canEdit(data.id) ? true : "当前记录已被锁定";
}
```

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

校验也可返回 Promise，适合唯一性、库存、权限等服务端规则：

```ts
{
  field: "code",
  editable: true,
  validate: async (value) => {
    const available = await api.checkCode(value);
    return available ? true : "编码已存在";
  }
}
```

异步校验期间编辑器进入 `aria-busy` 且禁止重复提交；校验失败恢复焦点，取消编辑或组件卸载会让迟到结果失效。命令式流程使用 `await gridApi.stopEditingAsync()`。

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

单元格模式下，`Tab` / `Shift+Tab` 在可编辑格之间跳转；Enter 确认，Escape 取消。整行模式下，Tab 在当前行编辑器间循环，Enter 提交整行，Escape 取消整行。

## 事件

```ts
onCellEditingStarted: (e) => console.log("开始", e.colId),
onCellEditingStopped: (e) => console.log("结束", e.oldValue, e.newValue),
onRowEditingStarted: (e) => console.log("开始编辑行", e.rowIndex),
onRowEditingStopped: (e) => console.log("整行结束", e.cancelled, e.changes),
onCellValueChanged: (e) => {
  // 编辑/粘贴/填充/清除/撤销 统一入口
  api.autoSizeColumn(e.colDef.colId ?? "");
  submitDraft(e.data);
}
```

## 与撤销联动

每次成功写值自动入撤销栈；`api.undo()` 可回滚（含批量操作整体回滚），详见[撤销/重做](/recipes/undo-redo)。

## 脏数据、批量保存与回滚

成功写值同时进入变更跟踪，无需业务层另建一份 diff：

```ts
api.getDirtyRowIds();
api.getChanges();

try {
  await api.saveChangesDetailed((changes) => orderApi.saveBatch(changes));
} catch (error) {
  // 保存失败不会清理 dirty 集合，可重试或让用户回滚。
}

api.rollbackChanges([rowId]);
```

`saveChangesDetailed` 先固定本次快照。若网络请求期间用户把同一格继续从 B 改为 C，服务端确认 B 后，本地仍保留 `B → C` 的待保存变更，不会把新编辑错误地标成已保存。完整失败/冲突协议见[批量保存、失败与版本冲突](/recipes/batch-save)。

Vue 页面推荐直接使用响应式控制器：

```ts
import { useMachTable } from "@agile-team/mach-table-vue";
import { useMachTableEditing } from "@agile-team/mach-table-vue/workflows";

const grid = useMachTable<Order>();
const edit = useMachTableEditing(grid, {
  guardBeforeUnload: true,
  onSaveError: (error) => message.error(toErrorMessage(error))
});

async function save() {
  const result = await edit.saveDetailed(async (changes) => {
    const result = await orderApi.saveBatch(changes);
    // 部分成功时只确认成功行，失败行继续保持 dirty 供修正/重试。
    return { savedRowIds: result.successIds };
  });
  if (result.conflicts.length) edit.reveal(result.conflicts[0].rowId);
}
```

模板可直接绑定 `edit.dirty`、`edit.saving`、`edit.saveError`、`edit.changes`、`edit.saveIssues` 和 `edit.failedRowIds`；使用 `edit.rollback(rowIds)` 回滚，使用 `edit.reveal(rowId, colId, true)` 定位并打开失败单元格，使用 `edit.resolveConflict()` 显式接受服务端值或保留本地值。重复点击保存会被拦截，卸载时监听器自动清理。
