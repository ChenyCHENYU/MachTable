# API 治理

MachTable 遵循 API Governance V6：公开能力必须有唯一职责、稳定类型、语义测试和明确入口。0.28 已完成早期 API 收口与复杂度治理；此后新增场景和可选模块均受同一套签名、行为、消费端及产物门禁约束。治理目标是验证契约与实际使用成本，不机械增加或删减 API。

## 公共层级

| 层级 | 承诺 | 示例 |
| --- | --- | --- |
| 根稳定入口 | 高频、跨场景、受 API 快照与语义测试保护 | `createGrid`、`GridOptions`、`GridApi` |
| 明确子入口 | 可选能力，按需消费并检查依赖图 | `/workflows`、`/ui`、`/workbench`、`/server-side`、`/analysis` |
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

## 入口兼容承诺

入口拆分表示按需成本，不表示可以任意破坏契约。1.0 候选冻结范围按下表评审；正式发布前仍需在就绪清单签明版本与支持范围。

| 公开范围 | 契约与维护边界 |
| --- | --- |
| Core/Vue/React 根入口及 XLSX | 类型、默认行为、事件和错误语义均纳入兼容评审；1.x 的破坏性变化需新的 major |
| 已文档化的可选子入口 | 与根入口遵循同一语义版本规则；资源上限、数据范围和外部引擎责任以各配方为准 |
| Core `/adapter` 与框架 `/adapters` | 保留为受控扩展契约，纳入同一兼容规则；普通页面无需引用，内部实现不因此成为公共 API |
| 已文档化的主题变量、slots 与 renderer/editor 契约 | 作为公开定制面评审；未文档化 DOM 结构、内部 class 和私有字段不作为扩展契约 |
| 明确标注的实验能力 | 必须逐项标明实验身份、版本范围和升级路径；独立子路径本身不构成实验身份 |

当前不因任何子入口是可选模块就把它隐式归为实验性。签名快照能够发现结构变化，行为兼容仍需对应语义与真实消费测试；policy 中的稳定等级说明不等同于已经执行了逐入口行为证明。

## 状态治理

- 当前 `GridState.version` 固定为 `2`。
- `initialState`、`api.state.apply()` 和 `persistence` 使用同一输入契约。
- 自动持久化只有 `persistence: { key, sections?, store?, debounceMs? }`。
- `sections` 同时约束写入和恢复；未获准区段在进入自定义 store 前已被清空。
- `normalizeGridState()` 只接收当前 schema；未来跨版本迁移必须有显式工具和测试。
- 用户、租户和组织身份由宿主提供；身份更换不能复用上一用户的存储键。状态版本是数据格式版本，不等同于 npm 包版本。

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

`api/public-api-policy.json` 同时限制根成员数量、领域清单和稳定级别。复杂度、依赖循环、包体和真实消费端构建提供第二层防回归。文档门禁校验 README/指南中的包名、子入口、具名导入和 JSX/TSX 语法；真实消费端 fixture 另行验证类型。文档片段可能省略业务依赖，这些检查不等同于每个示例的完整业务类型与运行验证。

## 兼容与维护策略

项目尚未发布 1.0。patch 保持已发布契约；0.x minor 若确需调整默认行为或语义，必须同步升级说明、行为回归与快照，不能把快照更新本身当作兼容证明。[升级指南](/guide/upgrading)列出实际迁移内容。

1.0 候选评审应分别冻结类型、运行时行为和持久化格式。进入稳定版后，兼容修复进入 patch，兼容新增进入 minor；破坏性变化进入新的 major，并先提供弃用说明和可执行迁移路径。安全版本当前按 [Security Policy](https://github.com/ChenyCHENYU/MachTable/blob/main/SECURITY.md)维护最新 minor；尚未承诺历史大版本 LTS，不把未来支持计划写成已提供的服务。

框架 peer 范围描述可安装范围，实际已验收版本、执行环境和限制由兼容报告记录。jsdom 的挂载/编辑/卸载检查不替代真实浏览器布局、原生输入法或辅助技术验收。Playwright WebKit 通过也不等于所有 Safari 版本通过。

进入 1.0 的证据与剩余条件见[就绪评估](/advanced/release-readiness)。业务 UAT、读屏与目标环境记录不能用本地模拟或测试数量替代。
