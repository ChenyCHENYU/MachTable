# API 治理

0.19 在不破坏 0.x 兼容性的前提下，把命令、配置、扩展和发布门禁放进同一套治理边界。

## 平面 API 与领域 API

原有平面方法继续有效；领域入口用于新代码的自动补全和职责发现：

```ts
api.rows.setData(rows);                // api.setRowData(rows)
api.columns.setWidth("amount", 180);  // api.setColumnWidth(...)
api.selection.clear();                 // api.deselectAll()
api.editing.getChanges();              // api.getChanges()
api.state.get();                        // api.getState()
api.diagnostics.get();                  // api.getDiagnostics()
```

0.x 不要求全量迁移。领域 facade 只转发到同一实现，不维护第二套状态，也不会增加框架适配差异。

## 原子更新与脏刷新

```ts
api.batch((grid) => {
  grid.applyTransaction({ update: changedRows });
  grid.setColumnVisibility("cost", canViewCost);
  grid.refreshCells({
    rowIds: changedRows.map((row) => row.id),
    columns: ["status", "cost"]
  });
});
```

嵌套 batch 安全；最外层结束时统一提交。更新调度器合并列重建、行池、布局、数据、局部单元格、固定行、合计和 overlay，并在 `getDiagnostics().updates` 暴露请求/合并/刷新次数。batch 只接受同步回调，异步请求应先完成数据准备，再在一个同步 batch 中提交结果。

`refreshCells()` 不传参数时保持原全量可见区刷新；传入 `rowIds`/`rowIndexes` 与 `columns` 后只触碰匹配单元格。存在 colSpan 时会按 pane 安全刷新，避免留下覆盖关系错误。

## 配置单一事实源

`GridOptions` 每新增一个非事件字段，TypeScript 会强制要求在 `GRID_OPTION_META` 声明值类别和框架更新策略。Vue/React 动态 props、`setGridOption`、`updateOptions` 与运行时 JavaScript/低代码 JSON 校验共同消费该 registry，避免“类型里有、适配器不更新”的漂移。

## Feature 版本契约

```ts
const auditFeature: GridFeature = {
  key: "audit",
  version: "0.3.0",
  requires: [{ key: "permissions", version: "^0.2.0" }],
  conflicts: ["readonly-mode"],
  setup(context) { /* ... */ }
};
```

支持 exact、`>`/`>=`/`<`/`<=`、`^`、`~`、空格 AND 与 `||` OR。缺失、版本不满足、冲突或循环依赖会在任何 setup 副作用前隔离，并以稳定 issue code 写入诊断。

## API 快照门禁

`pnpm check:api` 比较 Core export，以及 `GridApi`/领域 API、`GridOptions`、`GridFeature`、`GridDataProcessor` 和事件映射的完整成员签名快照。参数、返回值、可选性或成员发生变化时，CI 会要求先完成兼容性评审与迁移文档，再显式运行：

```bash
pnpm check:api:update
```

快照不是阻止演进，而是阻止无意识的删除、改名和适配器遗漏。0.x 破坏性变化仍必须使用 minor 版本、写入 Changelog/升级指南，并保留合理兼容窗口。
