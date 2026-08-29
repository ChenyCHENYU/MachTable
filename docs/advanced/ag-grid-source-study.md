# AG Grid 源码审计与 MachTable 演进台账

> 审计日期：2026-08-29。稳定发布基线为 AG Grid `36.1.0`；源码审计固定在官方仓库 commit [`b51ca642`](https://github.com/ag-grid/ag-grid/commit/b51ca642a2f7bd35598b67ce38c1036ed0082df9)（仓库当时为 `36.1.0-beta.20260828.1541`）。稳定版与仓库主线不同的结论必须标记，不能把 beta 实现误写成稳定契约。

## 审计边界与合规原则

- 只使用 AG Grid 官方仓库、官方文档和公开类型作为证据；Community 包是 MIT，Enterprise 包是 Commercial，见[官方仓库许可说明](https://github.com/ag-grid/ag-grid/blob/b51ca642a2f7bd35598b67ce38c1036ed0082df9/LICENSE.txt)。
- 可以研究架构边界和外部行为，不能复制 Enterprise 源码、私有算法、文案或测试数据。MachTable 的实现必须从自身需求、协议和测试独立推导，并保留设计记录。
- “AG 有”不等于“MachTable 必须有”。是否实现按真实 B 端覆盖率、可维护性、包体和授权风险决定。
- 每次重新审计必须记录产品版本、commit、文件路径、结论变化和对应 MachTable issue/ADR。

## 源码结构结论

### 1. 模块不是简单的按需导出

AG 的 [`moduleRegistry.ts`](https://github.com/ag-grid/ag-grid/blob/b51ca642a2f7bd35598b67ce38c1036ed0082df9/packages/ag-grid-community/src/modules/moduleRegistry.ts) 同时处理：

- 全局模块和单 Grid 模块；
- 模块依赖递归注册；
- 按 Row Model 限定模块；
- major/minor 版本一致性检查；
- 模块自己的运行时校验与注册钩子；
- Grid 销毁后的作用域模块清理。

MachTable 目前已有 `GridFeature` 和组件注册表，但缺少模块依赖、版本握手、能力冲突与 per-grid 模块清单。短期不照搬 Bean/Module 规模；先把高级能力改为可声明、可诊断、可销毁的 feature manifest，避免 Core 随功能线性膨胀。

### 2. 生命周期治理是 AG 稳定性的关键

AG 的 [`context.ts`](https://github.com/ag-grid/ag-grid/blob/b51ca642a2f7bd35598b67ce38c1036ed0082df9/packages/ag-grid-community/src/context/context.ts) 建立 Grid 级 Bean 容器、确定性创建/销毁顺序和依赖注入；[`BeanStub`](https://github.com/ag-grid/ag-grid/blob/b51ca642a2f7bd35598b67ce38c1036ed0082df9/packages/ag-grid-community/src/context/beanStub.ts) 把日志、警告和废弃提示收口到 Grid 作用域。`RowRenderer` 还使用两阶段销毁、僵尸行过渡和可缓存 RowCtrl，见 [`rowRenderer.ts`](https://github.com/ag-grid/ag-grid/blob/b51ca642a2f7bd35598b67ce38c1036ed0082df9/packages/ag-grid-community/src/rendering/rowRenderer.ts)。

MachTable 已有显式 service 销毁、renderer `{ el, destroy }`、Vue slot 卸载和泄漏测试。本次继续为 `GridFeatureContext` 增加托管 Grid 事件、DOM 监听、定时器、cleanup 和 AbortController；feature 热替换、setup 抛错或 Grid 销毁都会逆序回收。后续仍需增加开发模式的“未释放 DOM/第三方资源”归因。

### 3. 运行时校验是产品能力，不只是类型检查

AG 的 [`validationService.ts`](https://github.com/ag-grid/ag-grid/blob/b51ca642a2f7bd35598b67ce38c1036ed0082df9/packages/ag-grid-community/src/validation/validationService.ts) 和 [`gridOptionsValidations.ts`](https://github.com/ag-grid/ag-grid/blob/b51ca642a2f7bd35598b67ce38c1036ed0082df9/packages/ag-grid-community/src/validation/rules/gridOptionsValidations.ts) 覆盖拼写建议、依赖模块、互斥选项、数值约束、废弃迁移和组件合法性。错误不仅写控制台，还带稳定编号和缺失模块建议。

MachTable 已有 `GRID_OPTION_META`、列定义校验、稳定错误码、`getDiagnostics()` 和配置来源 `explainOption()`；本次新增了基础 `validateGridOptions()` registry，能够发现未知选项、给出相似拼写、校验服务端分页和数据模型冲突。后续继续覆盖：

- 初始选项与运行时可更新选项；
- 互斥的数据模型组合；
- 功能依赖和缺失组件；
- 带替代方案与移除版本的 deprecation；
- `actionPolicy`、服务端分页、稳定 `rowKey` 等安全前置条件。

### 4. 真正的 Infinite Model 是随机块缓存

AG Community 的 [`InfiniteCache`](https://github.com/ag-grid/ag-grid/blob/b51ca642a2f7bd35598b67ce38c1036ed0082df9/packages/ag-grid-community/src/infiniteRowModel/infiniteCache.ts)、[`InfiniteBlock`](https://github.com/ag-grid/ag-grid/blob/b51ca642a2f7bd35598b67ce38c1036ed0082df9/packages/ag-grid-community/src/infiniteRowModel/infiniteBlock.ts) 和 [`RowNodeBlockLoader`](https://github.com/ag-grid/ag-grid/blob/b51ca642a2f7bd35598b67ce38c1036ed0082df9/packages/ag-grid-community/src/infiniteRowModel/rowNodeBlockLoader.ts) 形成了：

- 按任意 rowIndex 建块，不要求从第一页顺序追加；
- 最大并发数与加载 debounce；
- LRU 式块淘汰；
- 正在显示或包含焦点的块不淘汰；
- 快速滚动时只保留少量未加载空块；
- 未知总数的虚拟尾部与最终 rowCount 收敛；
- 可观察的块状态。

MachTable 当前 `datasource` 是可靠的顺序追加模型，已有 AbortSignal、乱序隔离、重试和预取，但不是随机访问块缓存。`useMachTableQuery` 则很好地覆盖普通 B 端分页。二者不能包装成“完整 Remote Row Model”。如真实项目需要随机块访问，0.13 之后应单独设计 `RemoteBlockStore`，而不是继续给 `RowModel` 增加条件分支。

### 5. SSRM 的难点是层级 Store，不是一个 getRows

AG Enterprise 的公开仓库主线显示，SSRM 使用每个分组路由独立 store/cache、惰性块加载、刷新与事务状态机。证据包括 [`lazyCache.ts`](https://github.com/ag-grid/ag-grid/blob/b51ca642a2f7bd35598b67ce38c1036ed0082df9/packages/ag-grid-enterprise/src/serverSideRowModel/stores/lazy/lazyCache.ts)、[`lazyBlockLoadingService.ts`](https://github.com/ag-grid/ag-grid/blob/b51ca642a2f7bd35598b67ce38c1036ed0082df9/packages/ag-grid-enterprise/src/serverSideRowModel/stores/lazy/lazyBlockLoadingService.ts) 和 [`transactionManager.ts`](https://github.com/ag-grid/ag-grid/blob/b51ca642a2f7bd35598b67ce38c1036ed0082df9/packages/ag-grid-enterprise/src/serverSideRowModel/transactionManager.ts)。

因此 MachTable 不应把“服务端分页”改名成 SSRM。未来只有在两个以上真实项目需要服务端树/分组/聚合时，才定义 route、groupKeys、rowGroupCols、valueCols、filter AST、sort、range 和 store refresh 协议；协议先于 UI。

### 6. 百万行全选必须保存规则

AG SSRM 的 [`defaultStrategy.ts`](https://github.com/ag-grid/ag-grid/blob/b51ca642a2f7bd35598b67ce38c1036ed0082df9/packages/ag-grid-enterprise/src/serverSideRowModel/services/selection/strategies/defaultStrategy.ts) 保存 `selectAll + toggledNodes`，而不是下载所有 ID；官方也建议使用 [Server-Side Selection State](https://www.ag-grid.com/javascript-data-grid/server-side-model-selection/)。

MachTable 已据自身远程查询协议实现 `selectionScope: "query"`、`selectAllMatching()` 和 `{ mode: "allMatching", excludedKeys }`，并在查询条件变化时默认清空规则。这是本次审计中已关闭的高价值差距。

### 7. 框架组件需要统一契约

AG 的 [`userComponentFactory.ts`](https://github.com/ag-grid/ag-grid/blob/b51ca642a2f7bd35598b67ce38c1036ed0082df9/packages/ag-grid-community/src/components/framework/userComponentFactory.ts) 统一解析 JS 函数、类组件、框架组件、selector、默认参数、popup 和 mandatory methods。Vue/React 包只负责桥接生命周期，数据模型不分叉。

MachTable 的 Core renderer/editor 契约更小，Vue 已有原生 cell/header/editor/overlay/detail/actions slots，并会继承 appContext 和销毁挂载。后续应补 `refresh(params)` 可选契约，减少高频更新时组件重建；不能为了“像 AG”把简单函数 renderer 全部类化。

### 8. 状态必须版本化并能迁移

AG 官方 [Grid State](https://www.ag-grid.com/javascript-data-grid/grid-state/) 包含版本，并在载入旧状态时迁移；还覆盖列、筛选、选择、展开、分页、固定行、滚动和工具面板。

MachTable 已有版本化 `GridState`，本次又把列布局本地存储升级为 `{ version, savedAt, columns }`，支持旧数组迁移、用户/租户/路由隔离和非法载荷净化。仍缺状态更新事件、销毁前最终状态、焦点/滚动/展开状态的完整兼容策略。

## wl 项目真实使用画像

2026-08-29 对当前工作区进行静态扫描，约有 342 个 Vue 文件直接使用 `ag-grid-vue`、478 个 Grid 实例和 558 处 AG 相关源码引用。高频样板集中在：

| 模式 | 命中量 | MachTable 对策 |
| --- | ---: | --- |
| `grid-ready` | 461 | 全局配置、自动列布局、composable 隐藏普通页面 API |
| locale | 456 | 应用配置一次注入 |
| row/header height | 438 / 435 | size preset + 应用 defaults |
| `sizeColumnsToFit` | 242 / 342 个文件 | `columnLayout: "fit"` 自动响应容器 |
| `gridApi` / `getSelectedRows` | 190 / 141 | `useMachTable` 与 `useMachTableQuery` |
| 外部分页器 | `el-pagination` 153、业务分页 116 | 受控服务端分页内置 |

业务能力命中主要为 pinned 321、renderer 264、checkbox 253、pagination 247、editable 173、tooltip 158、header checkbox 140、range 114、editor 91；tree 32、master/detail 15、group 8、drag 3、aggregation 2。结论很清楚：先把列表、选择、编辑、字典、操作、分页和状态打磨到极致，比先做 Pivot/图表覆盖更多迁移页面。

## 当前对比结论

| 维度 | AG Grid 36.1 | MachTable 当前 | 判断 |
| --- | --- | --- | --- |
| 普通 Vue 列表接入 | 仍需模块/主题/GridOptions 组合 | 单包、单配置文件、`app.use(MachTablePlugin, config)`、原生 slots | MachTable 更轻、更符合现有项目约定 |
| 配置可控性 | 全局选项、模块、丰富校验 | app → route → preset → table 分层，且 `explainOption()` 可追溯 | MachTable 的来源解释更直观；校验深度落后 |
| 编辑事务 | 成熟单元格/整行与批处理 API | 原子整行草稿、异步跨字段校验、dirty diff、部分保存、回滚 | MachTable 更贴近当前 B 端保存流程；高级批量审阅仍缺 |
| 平面远程列表 | 成熟分页与 Infinite Cache | 受控分页很顺滑；顺序无限加载，不是随机块缓存 | 常规页面 MachTable 更简单；任意跳转/滚动 AG 更强 |
| SSRM / Pivot / 分析 | 非常成熟，多项为商业能力 | 尚无 | AG 显著领先；按真实需求独立立项 |
| 百万行选择 | 规则状态，含层级 | 平面 query 全选 + 排除规则已完成 | 平面场景已对齐；层级规则未做 |
| 组件生态 | 契约完整、框架覆盖广 | Vue 优先、React 官方支持、组件契约更小 | AG 生态领先；MachTable 学习和包体成本更低 |
| 状态与升级 | 状态覆盖广、自动迁移、长期版本资产 | 核心已版本化，列状态迁移已补 | AG 覆盖与历史验证领先 |
| 运行时诊断 | 规则、错误编号、缺模块提示成熟 | 错误码、快照、配置来源与基础 validation registry | AG 规则覆盖仍领先；MachTable 已关闭拼写/核心冲突盲区 |
| 授权 | Community MIT + Enterprise 商业 | 源码可见，任何使用需作者书面授权 | 不能只比较功能，采购/授权流程必须前置 |

## 可执行路线与退出条件

### 0.10：配置 V2 与 Vue 原生 DX（已完成）

- 专用 `mach-table.config.ts`，`main.ts` 保持一行安装；
- app/route/preset/table 四层覆盖与配置来源解释；
- 原生 Vue slots、自动列宽、命名预设和响应式 scoped defaults；
- 托管 feature 生命周期和基础 GridOption 校验。

退出条件：常用列表页无需直接保存 `gridApi`；配置示例和严格类型测试通过。

### 0.11：标准 B 端远程查询（已完成）

`useMachTableQuery` 已覆盖服务端分页、排序/过滤、debounce、AbortSignal、请求代次、失败重试、加载/空/错状态、跨页选择和查询级全选规则。它明确不是 AG Grid SSRM 或随机 Block Store。

退出条件：故障注入下无陈旧覆盖和永久 loading；跨页选择不下载全量 ID；查询切换默认清理旧规则。

### 0.12：业务字段与编辑保存闭环（已完成）

- 语义业务列、TTL/LRU/批量字典缓存和统一权限策略；
- 通用 Vue v-model 编辑器与可选 Element Plus 编辑器桥接；
- 脏状态、稳定保存快照、部分成功、回滚、定位和离页保护。

退出条件：单元格/整行编辑共享保存事务；保存中产生的新编辑不会被旧响应误确认；EP 未安装时零成本。

### 0.13：高频工作台能力（已完成）

已完成列工作台、权限动作、可选 XLSX 动态扩展、可取消/去重/重试的树表懒加载和主从详情闭环。随机 Block Store、高级筛选 AST、服务端分组/Pivot、公式和图表仍需独立 ADR，不以版本号倒逼功能。

### 1.0：暂不上

至少完成两个真实项目迁移 UAT、公共 API 兼容测试、三浏览器 E2E、读屏矩阵、公开性能 trace、发布回滚演练和授权流程验证，再讨论 1.0。

## 长期竞品台账模板

每次对 AG Grid、Vxe-Table、Surely Vue、Handsontable、RevoGrid 或 VTable 复审，追加一条记录：

| 字段 | 必填内容 |
| --- | --- |
| 产品基线 | 精确版本、commit/tag、Community/Commercial 模块 |
| 证据 | 官方源码永久链接、官方文档、可复现示例 |
| 业务场景 | 对应 wl 中的页面类型和真实使用频率 |
| 对比数据 | 接入代码量、交互步骤、P95 帧时、heap、产物 gzip |
| 结论 | MachTable 已优、需补、保持边界或明确不做 |
| 交付约束 | Core / feature / 独立包 / 项目层，测试和体积预算 |
| 合规 | 许可证、是否只读审计、clean-room ADR |

没有源码/测试证据的结论标记为“待验证”，不得写成性能或企业能力承诺。
