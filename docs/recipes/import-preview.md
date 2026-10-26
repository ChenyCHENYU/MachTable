# 导入预览计划

`/import` 是独立可选入口，提供有界、可取消的解析和校验计划。它复用 Core 的 `valueParser`、`validate`、`rowEditValidator` 和交互写值管线，不引入工作簿模型或第二套校验配置。默认根入口不加载此模块。

```ts
import type { GridApi } from "@agile-team/mach-table";
import { createImportPlan } from "@agile-team/mach-table/import";

type Item = { id: string; amount: number };
declare const api: GridApi<Item>;
const plan = createImportPlan(api, {
  kind: "matrix",
  rows: [["id", "amount"], ["0012", "12.50"]]
}, { mode: "append" });
try {
  const preview = await plan.preview();
  if (preview.status === "ready") {
    // 宿主在这里显示规范值与确认按钮；用户确认后调用 commit。
    const result = await plan.commit();
    console.log(result.status, result.importedRowCount);
  } else {
    console.log(preview.issues);
  }
} finally {
  plan.destroy();
}
```

也可传 `{ kind: "rows", rows: records }`。记录输入保留未映射的额外字段，按列 field 读取并解析映射字段，支持嵌套路径。预览隔离本次输入，不修改调用方记录；不会为预览复制整张现有表。`columns`、`headerRowIndex`、`coerceNumbers`、`parseValue` 与 [列值政策](./column-values.md) 中的矩阵桥一致，但计划严格拒绝未知或歧义表头。

## 预览和结果

`preview()` 返回 `status`、`rowCount`、逐字段 `{ rowIndex, colId, value }` 的 `cells` 和结构化 `issues`。`rowIndex` 从数据区 0 开始，不含表头；`-1` 代表整个计划。错误代码为 `MAPPING`、`PARSE`、`VALIDATION`、`STALE`、`UNSUPPORTED`，字段错误可带 `columnIndex` / `colId`。返回的 cells 值是隔离快照，修改它不会更改待提交记录。

计划支持同步与异步字段、整行校验。parser 同步执行，远程检查放入现有 validate；整行规则读完整候选 `values`。任何 Promise 拒绝或业务失败都进入 issues。未知字段不会被静默丢弃。

- `replace` / `append`：仅支持扁平本地记录模型；`treeData: true` 会明确返回 `UNSUPPORTED`，避免未校验的 children 在装载时被递归展开。所有候选记录都有效才装载，任一失败不替换也不追加。预先检查 rowKey 缺失、批内重复和 append 与现有记录重号。新记录模式要求先结束活动编辑并保存/回滚已有 dirty，防止替换丢失本地改动。
- `paste`：按当前显示数据行顺序从第一行开始映射，只读字段跳过；无可编辑目标或目标未加载会给出问题。已有 dirty 可保留，每行字段与整行规则都成功才写入；有效行可成功，失败行保留原值，结果为 `partial`。成功行组成一次 undo 操作，setter 拒绝也沿用现有行内回滚边界。

paste 复用既有输入的无变化规则：规范值与原值 `Object.is` 相等，或 parser 返回 `undefined` 时，该字段不校验、不写 setter、不发值变化事件，也不产生 undo。`cells` 仅列实际候选改动，`importedRowCount` 计实际写入行；全部可编辑字段均无变化时仍为 `ready → applied`，计数为 `0`、issues 为空。混入有效改动时，无变化行不计作部分失败；没有可编辑目标或目标未加载仍是错误。树模型可对当前显示节点执行 paste，但不通过此计划装载树结构。

`commit()` 首次可自行触发预览，已有预览则使用其同一份规范值，不重复调用 parser/validator。结果包含 `applied`、`partial`、`invalid`、`stale` 或 `destroyed` 状态和实际导入行数。已经尝试写入的计划不能重复提交；修改输入、处理失败行或需要重试时创建新计划。replace/append 是记录装载，不承诺整表结构的 undo；paste 使用已有值撤销。

任意自定义 setter 的外部副作用无法回滚。因此新记录的映射列若含 `valueGetter` / `valueSetter` 会明确拒绝，不能让预览和装载出现不同语义；派生列应不参与导入映射，或由使用侧先转换为普通字段。paste 仍支持现有 setter，但 setter 必须遵守既有同步、可回滚契约。parser、validator、rowKey 都应保持纯函数；`rows.transact` 仍是可信数据操作。

## 上限、过期与清理

每个计划最多 10000 数据行、100000 单元格（含表头）。输入快照最多 200000 个值、32 层深度。只接受基本值、Date、数组、普通对象；循环、accessor、函数、Symbol、自定义原型和危险原型键明确拒绝，不执行输入 getter，不做静默截断。输入对象中很大的非映射字段也计入快照限制。

预览或提交之前，实例销毁、数据范围/模式变化、列结构/校验规则变化、更新的用户输入或新的预览，会使旧结果过期。晚到 Promise 不覆盖新记录。过期 commit 返回 `stale`，不会自动重做预览后覆盖新数据；需要宿主明确重新预览。受控 API 的数据/值事件也参与版本检查。调用方直接无事件修改表记录不属于受控事务，宿主应使用 rows API。

`destroy()` 幂等，取消该计划的晚到结果并移除订阅。即使尚未完成异步校验，关闭预览面板或切换 API 时也应调用。验证 Promise 本身可能仍在宿主请求中执行；计划不承诺取消宿主网络请求。

这是本地行模型导入协议，不会取回远程全部数据，不提供 Excel 工作簿公式求值、样式或宏执行。UI 由宿主复用现有对话框与分页表格显示；不要把 100000 个预览单元格一次性挂到 DOM。
