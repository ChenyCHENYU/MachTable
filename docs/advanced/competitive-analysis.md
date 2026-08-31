# 数据表格竞品调研与提升计划

> 调研基线：2026-08-29。本文以产品官方文档、官方仓库和 npm 发布元数据为依据。当前结论属于桌面研究，不把厂商宣传中的“百万级”直接当成可复现的性能结论；最终评分必须经过统一基准与真实业务 UAT。

AG Grid 已完成固定 commit 的源码级审计，详见 [AG Grid 源码审计与 MachTable 演进台账](/advanced/ag-grid-source-study)。本文保留横向产品矩阵，源码结论与实施状态以后者为准。

## 目标与原则

MachTable 不以“把所有竞品功能全部复制一遍”为目标。调研要回答四个问题：

1. 复杂中后台与数据录入场景中，哪些能力会直接阻塞项目接入？
2. 哪些能力应进入零依赖 Core，哪些必须作为可选模块，避免所有用户承担体积和复杂度？
3. Vue 优先、React 官方支持的策略下，如何做到框架体验自然且内核不分叉？
4. 哪些赛道不应追赶，例如完整电子表格、纯 Canvas 超密集分析或无需求依据的框架扩张？

比较对象：AG Grid、Vxe-Table、Surely Vue Table、Handsontable、RevoGrid（含 `@revolist/vue3-datagrid`）和 VisActor VTable。

## 统一评估矩阵

最终评分使用同一套证据和权重，不能仅凭功能列表打勾。

| 维度 | 权重 | 核心问题 | 证据 |
| --- | ---: | --- | --- |
| 渲染与数据规模 | 15% | 行列虚拟化、变高行、固定区域、滚动稳定性、更新吞吐、内存 | 可重复 benchmark + 性能时间线 |
| 服务端数据模型 | 15% | 分页/无限/块缓存、并发取消、服务端分组聚合、实时 viewport | API 实现 + 故障注入 |
| 编辑与业务事务 | 12% | 单元格/整行、校验、批量修改、失败回滚、冲突、撤销 | 订单/台账 UAT |
| 类 Excel 交互 | 10% | 范围、多范围、剪贴板、填充、合并、公式、键盘模型 | 用户任务完成率 |
| 分析能力 | 10% | 分组、聚合、Pivot、图表、钻取、服务端下推 | 分析工作台 UAT |
| Vue 开发体验 | 10% | 单包安装、响应式、插槽/组件、全局默认值、Nuxt、类型提示 | 接入代码量 + 类型测试 |
| 跨框架一致性 | 6% | React/Vanilla 能力、生命周期、API 一致性 | 消费端测试 |
| 扩展与模块化 | 8% | renderer/editor/filter/feature 插件、按需加载、版本兼容 | 第三方扩展示例 |
| 可访问性 | 6% | ARIA、键盘、对比度、NVDA/JAWS/VoiceOver | 自动审计 + 真机读屏 |
| 工程与生态 | 5% | 文档、示例、迁移、发布、支持、问题响应 | 仓库与接入访谈 |
| 包体与总体成本 | 3% | 实际应用增量 gzip、依赖、授权、升级成本 | 构建产物 + 授权条款 |

评分规则：`0` 无能力，`1` 仅原型，`2` 可用但边界明显，`3` 常规生产可用，`4` 复杂场景成熟，`5` 有公开证据且行业领先。厂商宣传但尚未复现的能力最高记为“待验证”，不直接记 4/5 分。

## 产品定位与官方证据

| 产品 | 主要定位与渲染路径 | 当前授权形态 | 对 MachTable 最有参考价值的部分 |
| --- | --- | --- | --- |
| MachTable 0.19 | DOM 行列双虚拟化；复杂业务浏览和录入；Vue 优先、React 官方支持 | 从 0.9.1 起源码公开可查看，使用前需书面授权 | 分层配置、嵌套过滤、冲突保存、命名视图、随机块 LRU、Worker 边界、可诊断 Feature/API/性能、零 Core 运行时依赖 |
| AG Grid 36 | DOM 虚拟化；Community + Enterprise；四类 Row Model | Community MIT，Enterprise 商业授权 | SSRM/Viewport、Pivot/图表/XLSX、模块注册、工具面板、无障碍治理 |
| Vxe-Table 4 | Vue 3 PC 端 CRUD/可编辑表格；虚拟列表和插件生态 | MIT | Vue 模板体验、Grid/Form/Toolbar 一体化、CRUD、导入导出与插件生态 |
| Surely Vue Table 5 | Vue 3 商业表格；默认虚拟滚动，强调 10 万行/列与复杂布局 | Commercial | Vue 单包接入、自动行高/合并/树/子表在虚拟滚动下的一致体验 |
| Handsontable 18 | DOM 虚拟化；电子表格式数据编辑 | 专有非商业/评估许可 + 商业许可 | 公式、任意合并、批注、快捷键、单元格类型、无障碍与视觉回归体系 |
| RevoGrid 4 | Web Components 内核 + 多框架包装；高性能类 Excel 网格 | Core MIT，Pro 商业授权 | 插件化、多框架一致 API、Pro 公式/多范围/XLSX/服务端分组路线 |
| VTable 1 | Canvas 可视区域绘制；列表、Pivot、PivotChart、Sheet | MIT | 百万级只读分析、Pivot/PivotChart、按需注册、Canvas 自定义绘制 |

主要官方依据：

- [AG Grid Row Models](https://www.ag-grid.com/javascript-data-grid/row-models/)、[模块化](https://www.ag-grid.com/javascript-data-grid/modules/)、[SSRM 分组](https://www.ag-grid.com/javascript-data-grid/server-side-model-grouping/)、[Excel 导出](https://www.ag-grid.com/javascript-data-grid/excel-export/)、[无障碍](https://www.ag-grid.com/javascript-data-grid/accessibility/)
- [Vxe-Table 官方仓库](https://github.com/x-extends/vxe-table)、[XLSX 插件](https://github.com/x-extends/vxe-table-plugin-export-xlsx)
- [Surely Vue Table npm 页面](https://www.npmjs.com/package/@surely-vue/table)
- [Handsontable 功能](https://handsontable.com/features)、[无障碍](https://handsontable.com/docs/angular-data-grid/accessibility/)、[授权](https://handsontable.com/docs/12.0/software-license/)
- [RevoGrid Vue](https://rv-grid.com/vue-data-grid)、[服务端数据](https://rv-grid.com/guide/server-side-data)、[授权](https://rv-grid.com/guide/licensing)
- [VTable 官方仓库](https://github.com/VisActor/VTable)、[Canvas 滚动](https://www.visactor.io/vtable/guide/interaction/scroll)、[PivotChart](https://www.visactor.io/vtable/guide/table_type/pivot_chart)、[按需加载](https://www.visactor.io/vtable/guide/Load_on_Demand)

## 能力差距总览

符号说明：`强` 表示当前目标场景成熟，`有` 表示具备常规能力，`有限` 表示边界明显，`无` 表示当前没有，`待测` 表示需要统一验证。商业版能力以“商业”标注，避免与免费能力混在一起。

| 维度 | MachTable | AG Grid | Vxe-Table | Surely | Handsontable | RevoGrid | VTable |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 行列虚拟化 | 强（DOM） | 强（DOM） | 强（Vue/DOM） | 强（Vue/DOM） | 强（DOM） | 强（Web Component） | 强（Canvas） |
| 变高行 + 固定区 + 复杂单元格 | 有 | 强 | 强 | 强 | 有 | 有 | 强（绘制模型不同） |
| 平面无限加载 | 有 | 强 | 有/待测 | 有限/待测 | 有 | 有，应用层控制 | 有/待测 |
| 服务端分组/Pivot/块缓存 | 无 | 强（商业 SSRM） | 待测 | 无公开证据 | 服务端数据，深度待测 | 商业 | Pivot 强，服务端协议待测 |
| 单元格编辑 | 强 | 强 | 强 | 强 | 强 | 强 | 有 |
| 原子化整行事务编辑 | 强 | 有 | 强 | 有 | 非主要模型 | 有限 | 非主要模型 |
| 范围/复制/填充/撤销 | 有（单范围） | 强 | 强 | 部分能力仍在路线中 | 强 | 商业能力更完整 | Sheet/插件能力强 |
| 任意矩形合并 | 无 | 有 | 有 | 有 | 强 | 商业 | 强 |
| 公式/公式栏 | 无 | 有限，偏值计算/导出 | Pivot 为主，公式待测 | 无公开证据 | 强（HyperFormula） | 强（商业） | Sheet 有 |
| Pivot/图表 | 无 | 强（商业） | Pivot；图表插件 | 图表仍标注规划中 | 非核心 Pivot，公式强 | 商业 | 强 |
| XLSX 导入导出 | 有，独立可选包/动态引擎 | 强（商业） | 插件 | 官方列表仍标注规划中 | 有（外接 ExcelJS） | 商业 | 插件/Sheet |
| Vue 原生模板体验 | 强，cell/header/editor/overlay/detail/actions 插槽 | 成熟包装 | 强 | 强 | 成熟包装 | 成熟包装 | 有 Vue 包 |
| React/跨框架 | 强 | 强 | 无 | 无 | 强 | 强 | 强 |
| 按需模块化 | Feature 依赖/冲突清单 + 框架子入口 + XLSX 独立包 | 强 | 强 | 待测 | 插件体系成熟 | 强 | 强 |
| 无障碍证据 | ARIA/E2E 已有，真机矩阵不足 | 强 | 官方证据不足 | 官方证据不足 | 强，宣称 WCAG 2.1 AA | 有，深度待测 | Canvas 下证据不足 |
| 生态/支持/迁移资产 | 早期 | 行业成熟 | Vue 生态成熟 | 商业支持 | 商业支持与大量配方 | 开源 + 商业 | VisActor 生态 |

## MachTable 的真实优势

1. **业务事务编辑比“只有输入框”更完整。** 单元格确认/取消与整行草稿、同步/异步校验、跨字段校验、setter 失败回滚、成组撤销已经形成一致事务边界。
2. **体积和依赖边界清楚。** Core 零运行时依赖，Vue/React 适配包自动带入 Core，业务方只安装一个框架包。
3. **跨框架但不牺牲 Vue 优先级。** 公共类型和行为来自同一 Core，Vue/React 不复制数据模型。
4. **工程治理已经早于功能规模。** `GRID_OPTION_META`、稳定错误码、状态版本、资源销毁、消费端类型/exports/体积/覆盖率门禁，为后续扩展提供了可靠底座。
5. **DOM 路线适合复杂业务组件。** 表单控件、操作按钮、可访问性和 UI 库组件嵌入更自然，不需要为追求 Canvas 指标重写整个交互层。

## 当前最关键的不足

### P0：1.0 前必须补齐

| 缺口 | 业务影响 | 建议交付物 | 验收指标 |
| --- | --- | --- | --- |
| 服务端数据契约仍是平面无限模型 | 大数据分组、聚合、权限过滤无法形成统一后端协议 | `RemoteRowModel` 请求模型、可取消块缓存、LRU、并发上限、失效/重试 API | 乱序响应不覆盖新状态；缓存上限可证明；故障注入 E2E |
| 公共契约尚未冻结 | 0.x 快速变化会阻碍企业长期接入 | API 兼容清单、弃用周期、状态/错误码快照、迁移自动化 | 兼容测试阻止意外破坏；至少一个真实项目升级演练 |
| 无障碍仍以自动化为主 | 政企/国际项目需要真实读屏证据 | NVDA/JAWS/VoiceOver 矩阵、对比度审计、焦点视觉回归 | 核心浏览/选择/编辑任务通过 WCAG 2.1 AA 检查 |
| 缺少公开的同机对比基准 | “高性能”难以让采用者信服 | 可复现 benchmark 仓库与结果页 | 固定设备、固定数据生成器、5 次中位数和原始 trace 可下载 |

### P1：形成复杂业务壁垒

| 能力 | 为什么优先 | 架构边界 |
| --- | --- | --- |
| 高级筛选构建器 UI | 0.18 已有同构 AST，下一步降低复杂条件组装成本 | 独立 UI/Feature，复用 AST，不让视图结构污染 datasource |
| 批量修改审阅面板 | 0.18 已有详细失败/冲突协议，下一步提供可选审阅 UI | 基于 `saveChangesDetailed` 与 `failedRowIds`，不内置业务合并策略 |
| 服务端分组行模型 | 0.19 已完成随机访问块缓存，但尚无 AG SSRM 的分组/聚合 Store | 先冻结服务端 group key、child count、aggregate 与事务协议；保持为可选 Feature |
| 列分组与服务端聚合展示 | 分析型 B 端的高频下一层 | 服务端先计算、前端展示；不把 Pivot 引擎塞入 Core |
| 受控矩形合并 | 报表/审批单存在真实需求 | 独立 span/merge 模型；先限定静态/只读，再评估编辑和虚拟化 |
| 功能模块包级拆分 | Core 继续增长会突破体积边界 | Core 只保留模型和稳定 SPI；高级 UI、XLSX、Pivot 独立入口 |

### P2：独立立项，不进入默认 Core

- 服务端分组、聚合、Pivot 结果列协议；先支持“服务端计算、前端呈现”，再决定是否实现客户端 Pivot 引擎。
- Formula Engine、公式栏、依赖图和错误模型；必须独立包并定义与业务字段模型的边界。
- 图表联动插件；优先接 VChart/ECharts，不自研图表引擎。
- Worker 排序/过滤已在 0.19 以可选 Processor 实现并保留同步小数据快路径；Pivot 仍不进入 Core。
- 多范围选择、协同编辑、审计时间线；必须先明确服务端一致性与权限模型。

## 明确不追赶的方向

- **不把 Core 改成 Canvas。** VTable 的 Canvas 路线适合超密集只读分析；MachTable 保留 DOM，以复杂组件、可访问性和业务编辑为主。
- **不在 1.0 前做完整电子表格。** Handsontable 的公式、批注、多 Sheet 和任意合并是另一条产品线。
- **不因为 RevoGrid 跨框架就立即增加 Angular/Svelte。** Vue 体验和 Core 契约成熟度优先于框架数量。
- **不把图表、XLSX、公式塞进默认包。** 按需能力必须由独立包或 `GridFeature` 提供。
- **不以功能数量替代可靠性。** SSRM、Pivot、协同编辑都必须有真实业务协议、性能预算和失败恢复设计后再开发。

## 实测调研执行计划

### 阶段 A：冻结样本与环境（2 天）

- 锁定各产品版本、许可形态、模块组合和构建配置；保存 `package.json`、lockfile 与官方证据链接。
- 统一 Chrome Stable、Windows 11、Node LTS、CPU 限速和 1920×1080 viewport。
- 建立 4 个公开数据生成器：`100k×20`、`100k×100`、`1m×20`、`20k×40 + 复杂 renderer/变高行`。

### 阶段 B：性能与资源（3–5 天）

- 首屏：创建实例到首个稳定可交互帧。
- 滚动：连续 30 秒纵向/横向滚动的 FPS、P95 帧时长、长任务数量。
- 更新：每批 100/1000 行更新的吞吐和交互延迟。
- 资源：峰值 heap、稳定 heap、DOM/Canvas 节点、销毁后残留监听器。
- 产物：最小功能和等价功能两套 gzip/brotli，不拿 npm 解包大小冒充应用包体。

### 阶段 C：四套业务 UAT（5 天）

1. 订单列表：服务端排序/筛选、选择保持、操作列、详情、乐观更新。
2. 工业台账：单元格/整行编辑、异步校验、粘贴、撤销、批量提交与失败定位。
3. BOM 树：懒加载、级联选择、跨层拖拽、固定列、变高行。
4. 分析工作台：分组聚合、Pivot、图表联动、XLSX 导出。

每个任务记录完成时间、接入代码量、必须绕过的 API、错误恢复能力和最终用户操作步数。

### 阶段 D：框架、可访问性与治理（3 天）

- Vue：局部/全局/异步、响应式更新、插槽、UI 库编辑器、Nuxt 客户端挂载。
- React：受控更新、StrictMode、卸载、懒加载和自定义组件生命周期。
- 无障碍：axe + 键盘全流程 + NVDA/VoiceOver；记录虚拟化下的索引和焦点问题。
- 安全：不可信 renderer/overlay、CSV/XLSX 公式注入、原型污染、服务端错误文本。
- 治理：版本策略、迁移文档、Issue 响应、商业授权和长期维护风险。

### 阶段 E：评分和决策（2 天）

- 按统一矩阵打分，每一分都链接到 trace、代码、截图或官方文档。
- 使用 `优先级 = 业务覆盖 × 风险降低 × 差异化价值 ÷ (实现成本 × 架构侵入)` 排序。
- 每个候选能力必须输出 ADR：进入 Core、独立包、业务示例，或明确不做。
- 形成 `0.10 → … → 0.19 → 1.0` 路线图；0.19 前高频业务、治理与性能内核里程碑已经合并验收，1.0 继续由真实项目证据驱动。

## 建议版本路线

| 版本 | 唯一主目标 | 退出条件 |
| --- | --- | --- |
| 0.9.1 | 许可证边界和竞品基线 | npm/README/包内许可证一致；调研计划可复现 |
| 0.10 | 配置 V2 与 Vue 原生 DX | 命名预设、scoped defaults、自动 fit、原生插槽完成 |
| 0.11 | 标准 B 端远程查询 | 分页、取消、竞态、加载/空/错、跨页/查询级选择完成 |
| 0.12 | 业务字段与编辑保存闭环 | 字典缓存、EP 编辑器、部分保存、回滚与离页保护完成 |
| 0.13 | 高频工作台能力 | 列工作台、权限动作、可选 XLSX、懒加载树、主从详情完成 |
| 0.14—0.15 | 页面工作流与列宽体验 | 控制器、工具栏、完整状态、手动查询和可恢复列宽完成 |
| 0.18 | 业务治理与性能证据 | Option/Feature 治理、高级过滤、命名视图、冲突保存、状态迁移和 renderer/性能诊断完成 |
| 0.19 | 性能内核与 API 治理 | 随机块 LRU、Worker 边界、增量几何索引、更新调度、领域 API、API 快照完成 |
| 1.0 | 稳定发布 | UAT、迁移、无障碍、性能、发布与回滚演练全部通过 |

## 当前结论

MachTable 已经不是“普通 Vue 表格”的水平：基础网格、增量双虚拟化、复杂编辑、列工作台、懒加载树、主从、嵌套过滤、冲突保存、随机远程块、状态/API 治理和跨框架内核已经形成完整产品骨架。与成熟商业网格相比，主要差距不在再加几个按钮，而在 **服务端分组聚合模型、分析插件、真实无障碍/公开对比证据和生态成熟度**。

0.10—0.19 的高频业务、治理和性能内核路线已经完成。下一步先让真实项目验证随机块、Worker、编辑与状态闭环，再按证据建设高级过滤构建器或服务端分组协议；Pivot、公式、图表继续按独立 ADR 决策。这样既扩展企业适用面，又不会丢掉 MachTable 小内核、低依赖和复杂业务编辑的差异化优势。
