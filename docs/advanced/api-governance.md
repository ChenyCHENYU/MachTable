# API 治理

0.23 建立 API Governance V3：公开能力必须有唯一职责、稳定契约、语义测试和兼容策略。目标不是追求 API 数量最少，而是让每个入口都能回答“归谁负责、何时使用、与谁重复、如何演进”。

## 到底需要多少 API

当前 `GridApi` 有 126 个公开成员，其中包含 8 个领域入口；其余为 0.x 平面兼容面，覆盖数据、列、过滤、分页、选择、编辑、树/分组、范围、状态、导入导出、诊断和生命周期。这个数字不是推荐用户逐个记忆的产品界面。

新代码只需先认识 8 个稳定领域：

| 领域 | 唯一职责 | 不负责 |
| --- | --- | --- |
| `rows` | 行数据、事务、定位、远程块缓存 | 列状态、宿主请求参数 |
| `columns` | 列状态、显隐、宽度 | 过滤模型、业务权限 |
| `selection` | 已选数据与 ID、全选/清空 | 跨查询规则；由框架 Query 工作流负责 |
| `editing` | 脏数据、保存、回滚、结束编辑 | 请求 UI 和业务冲突决策 |
| `filtering` | 普通/高级/快速过滤状态 | 发起后端请求 |
| `pagination` | 页码、页大小、总量和开关 | 拉取页面数据 |
| `state` | 版本化工作区快照 | 命名视图的存储策略 |
| `diagnostics` | 无业务行数据的健康与性能快照 | 日志上传和用户数据采集 |

领域 facade 按第一次访问惰性创建，只转发到同一实现，不复制状态。0.x 平面方法继续兼容；1.0 前不做无迁移窗口的删除。

```ts
api.rows.apply({ update: changedRows });
api.columns.setWidth("amount", 180);
api.filtering.setQuickText(keyword);
api.pagination.setPage(2);
api.editing.getChanges();
api.state.get();
api.diagnostics.get();
```

## 新增、保留与拒绝规则

新增公开 API 必须同时满足：

1. 对至少一个高频 B 端场景形成完整闭环，而不是仅暴露内部实现细节。
2. 不能由既有领域操作、`GridOptions`、事件或 `GridFeature` 清晰表达。
3. 有确定的输入边界、返回语义、销毁/取消行为和错误策略。
4. Core、Vue、React 的类型/运行时边界一致，并更新文档、签名快照和语义测试。
5. 默认路径不引入可选重能力；实验能力先放独立 subpath 或 `GridFeature`。

仅为了缩短一行调用的别名、同时读写多个无关领域的“万能方法”、返回内部 Service/DOM 池对象的逃生口，一律不进入稳定 API。

机器可读策略位于 `api/public-api-policy.json`：

- `stable`：文档化并通过签名与语义门禁。
- `experimental`：仅存在于显式子入口或 Feature，升级时可调整但必须写迁移说明。
- `internal`：不得从包入口导出。
- `deprecated`：给出唯一替代项和至少一个 minor 兼容窗口；当前只有 `openColumnPanel → openColumnWorkbench`。

## 原子配置提交与增量失效

`updateOptions(patch)` 先逐项净化整个 patch，再在一个更新调度批次内应用合法子集。未知字段或运行时类型错误只报告且丢弃；同一 patch 引发的列、布局、单元格、合计和覆盖层工作只提交一次视图刷新。

`applyTransaction({ update })` 会先判断失效范围：没有本地排序/过滤、分组、树、主从、变高或行合并时，仅替换行引用并刷新对应可见单元格；任何会改变顺序、成员、几何或合并关系的场景自动执行完整管线。优化不会要求使用侧维护“脏字段”提示，也不会因错误提示造成数据错位。

需要组合多个命令时使用显式同步批处理：

```ts
api.batch((grid) => {
  grid.rows.apply({ update: changedRows });
  grid.columns.setVisible("cost", canViewCost);
  grid.refreshCells({
    rowIds: changedRows.map((row) => row.id),
    columns: ["status", "cost"]
  });
});
```

异步网络工作应先完成，再把结果放进同步 `batch`；不要把 `async` 回调传给 `batch`。

## 配置单一事实源

`GridOptions` 每新增一个非事件字段，TypeScript 强制要求在 `GRID_OPTION_META` 声明值类别和框架更新策略。Vue/React 动态 props、`setGridOption`、`updateOptions` 与 JavaScript/低代码 JSON 净化共同消费该 registry，避免“类型有字段、适配器不更新”。

应用级默认配置仍建议放在独立 `mach-table.config.ts`，通过 Vue `app.use(MachTablePlugin, config)` 或 React `MachTableProvider` 一次注入；页面 props 只覆盖差异项。配置层级与来源解释见[配置系统](/guide/configuration)。

## Feature 版本契约

可选业务能力优先使用 `GridFeature`。`version/requires/conflicts` 支持 exact、比较符、`^`、`~`、AND 与 `||` OR；缺失、版本不满足、冲突或循环会在 setup 副作用前隔离，并以稳定 issue code 写入诊断。

## 自动化门禁

`pnpm check:api` 同时检查：

- Core 与 Worker 入口导出；
- Vue/React 主入口和工作流/异步入口导出；
- XLSX 可选入口导出；
- `GridApi`、8 个领域 API、`GridOptions`、Feature、Processor 与事件签名；
- API 生命周期策略文件。

签名变化必须先完成兼容评审、Changelog 和升级说明，再显式执行 `pnpm check:api:update`。此外 `governance23.test.ts` 验证领域对象稳定性、配置单次提交、增量管线安全回退、请求并发/优先级和 Observer 生命周期。快照阻止无意识漂移，语义测试阻止“签名没变、行为变了”。
