# 高级过滤表达式

0.18 新增可序列化的高级过滤 AST，用一棵有界表达式树描述嵌套 `AND / OR / NOT`。同一个模型可以由客户端直接执行，也会被 `datasource`、Vue/React `useMachTableQuery()` 原样传给服务端，避免页面维护两套过滤语义。

## 建立并应用表达式

```ts
import {
  advancedFilterCondition,
  advancedFilterGroup,
  type AdvancedFilterModel
} from "@agile-team/mach-table-vue";

const model: AdvancedFilterModel = {
  version: 1,
  root: advancedFilterGroup("and", [
    advancedFilterCondition("status", {
      type: "set",
      values: ["active", "pending"]
    }),
    advancedFilterGroup("or", [
      advancedFilterCondition("department", {
        type: "text",
        conditions: [{ match: "equals", value: "研发部" }]
      }),
      advancedFilterCondition("amount", {
        type: "number",
        conditions: [{ match: "greaterThan", value: 100_000 }]
      })
    ])
  ])
};

api.setAdvancedFilterModel(model);
api.getAdvancedFilterModel();
api.setAdvancedFilterModel(null); // 清空
```

`advancedFilterGroup("and" | "or", children, { not?: true })` 可对整组取反。普通列过滤、快速过滤和高级过滤同时存在时，三者按 `AND` 合并。

## 远程查询

```ts
const query = useMachTableQuery({
  query: searchForm,
  rowKey: "id",
  mode: "manual",
  request: ({ page, pageSize, sortModel, filterModel, advancedFilterModel, signal }) =>
    orderApi.page({
      page,
      pageSize,
      sort: sortModel,
      filters: filterModel,
      expression: advancedFilterModel,
      signal
    })
});
```

`FilterChangedEvent` 同时包含 `filterModel` 与 `advancedFilterModel`。无限数据源的 `InfiniteGetRowsParams` 也包含这两个字段。

## 安全与边界

所有入口都会通过 `normalizeAdvancedFilterModel()` 克隆和归一化不可信 JSON：

- 最大深度 16、最大节点 512；
- 单列组合条件最多 20；
- set 值最多 2,000；
- 循环引用、未知列、无效操作符和非有限数字会被隔离；
- `GridState`、命名视图、远程查询和本地执行共享同一个归一化器。

服务端仍必须做自己的字段白名单、权限和参数校验。客户端归一化是稳定性边界，不是服务端授权边界。
