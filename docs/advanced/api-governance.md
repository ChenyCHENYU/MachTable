# API 治理

0.28 使用 API Governance V6：公开能力必须有唯一职责、稳定类型、语义测试和明确入口。0.28 公共快照相对 0.25 保持不变，治理目标从“继续收口”转为“真实项目验证”，不再机械增加或删减 API。

## 公共层级

| 层级 | 承诺 | 示例 |
| --- | --- | --- |
| 根稳定入口 | 高频、跨场景、受 API 快照与语义测试保护 | `createGrid`、`GridOptions`、`GridApi` |
| 明确子入口 | 可选能力，单独进入 chunk | `/workflows`、`/ui`、`/adapters`、`/worker` |
| 扩展契约 | 允许业务组合，不暴露内部实现 | `GridFeature`、`GridComponents`、renderer/editor 契约 |
| 内部实现 | 可重构，不从 package exports 暴露 | `GridCore`、service、layout、registry |

## GridApi 规则

根级固定为：

- 12 个领域：`rows`、`columns`、`selection`、`editing`、`filtering`、`sorting`、`pagination`、`hierarchy`、`view`、`state`、`io`、`diagnostics`。
- 7 个横切能力：`batch`、`whenReady`、`getOption`、`updateOptions`、`on`、`destroy`、`isDestroyed`。

领域对象按需创建、引用稳定并被冻结。内部 `GridApiImpl` 不会逃逸到消费者；同一命令不再同时维护根级和领域级两种名称。

新增 API 必须回答：

1. 它属于哪个唯一领域？
2. 是否能用现有配置、事件或 Feature 组合完成？
3. 是否是跨项目高频能力，而非单一业务便利函数？
4. 同步/异步、取消、失败和销毁后的语义是什么？
5. 是否有类型、语义测试、文档和迁移说明？

## GridOptions 规则

每个非事件 Option 必须登记在 `GRID_OPTION_META`：

- 值类别和运行时校验规则。
- Vue/React 更新策略。
- 是否可进入应用 defaults/preset。
- 修改后需要触发的模型、布局或视图失效级别。

应用配置中心只接受无实例身份的稳定约定。`rowData`、`columnDefs`、请求状态、初始状态和 `persistence` 等字段在默认严格模式下直接拒绝；`components` 与 `columnTypes` 使用顶层专用注册字段。

## 框架一致性

- Vue 与 React 都使用 `MachTable`、`useMachTable`、`bindings`。
- 两个适配包都从 `/workflows`、`/ui`、`/adapters`、`/worker` 获取可选能力。
- Vue 额外提供 `/async`、`/editors` 和原生 slots；React 遵循模块导入与路由 lazy。
- 适配包自动依赖 Core，业务只安装一个框架包。

框架差异只出现在平台能力，不制造同义业务 API。

## 状态治理

- 当前 `GridState.version` 固定为 `2`。
- `initialState`、`api.state.apply()` 和 `persistence` 使用同一输入契约。
- 自动持久化只有 `persistence: { key, sections?, store?, debounceMs? }`。
- `sections` 同时约束写入和恢复；未获准区段在进入自定义 store 前已被清空。
- `normalizeGridState()` 只接收当前 schema；未来跨版本迁移必须有显式工具和测试。

## 发布门禁

`scripts/check-api-surface.mjs` 从 TypeScript AST 生成 `api/public-api.snapshot.json`，覆盖：

- Core 根、adapter、worker 导出。
- Vue/React 根和所有子入口。
- XLSX 导出。
- `GridApi` 全部领域、`GridOptions`、`ColDef`、状态/持久化、动作列、配置中心、Vue/React 组件与远程查询等高风险契约。

任何导出或签名变化都会让 CI 失败。维护者必须先评审设计、更新测试和迁移说明，再显式执行：

```bash
pnpm check:api:update
```

`api/public-api-policy.json` 同时限制根成员数量、领域清单和稳定级别。复杂度、依赖循环、包体和真实消费端构建提供第二层防回归。文档门禁还会逐个校验 README/指南中的包名、子入口和具名导入，过期示例不能通过 CI。

## 0.x 演进策略

项目尚未冻结 1.0。0.28 沿用已经完成收口的单一契约，并清零内部复杂度豁免。真实项目试用期间默认只接受兼容修复；若证据证明必须调整契约，只能在 `1.0.0-rc` 前通过设计评审、升级说明和快照变更完成，patch 版本不得破坏已发布契约。
