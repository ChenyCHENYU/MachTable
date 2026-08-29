# 概述

MachTable（马赫表格）是一个**高性能、零运行时依赖、跨框架**的企业级数据表格插件。名字取自"马赫数"——音速的倍数，代表它的核心承诺：**超音速渲染**。

## 为什么选择 MachTable

| 痛点 | MachTable 的答案 |
| --- | --- |
| 大数据量卡顿（el-table 1 千行开始卡） | 行/列双虚拟化，10 万行 × 100 列渲染开销恒定 |
| 商业网格授权与体积边界不透明 | 明确的书面授权边界、完整内核 gzip 约 65KB、零运行时依赖 |
| 换框架就要换表格库 | 框架无关内核 + React/Vue 适配层，一套 API |
| 列宽/顺序用户改了下次就丢 | `columnStateKey` 一行配置自动记忆（localStorage 或后端） |
| 批量编辑误操作无法挽回 | 内置 Undo/Redo，填充/粘贴/清除自动成组撤销 |
| Excel 数据来回搬 | Ctrl+C/X/V TSV 互通 + 填充柄（复制/循环/等差） |

## 特性矩阵

| 分类 | 能力 |
| --- | --- |
| **渲染性能** | 行虚拟化（行池复用）、列虚拟化（可视列窗口）、变高行前缀和 + 二分定位、rAF 合帧、`contain` 布局隔离、范围坐标帧内缓存 |
| **布局** | 左/右固定列（三窗格物理隔离）、flex/px 列宽、拖拽调宽（min/max、双击自适应）、列拖拽换位、多级分组表头、自定义表头组件 |
| **数据模型** | 客户端排序过滤、服务端模式（manualSorting/manualFiltering）、无限滚动数据源协议（getRows + 服务端总行数） |
| **选择** | 多选/单选(radio)/行禁选、Ctrl/Shift、表头全选半选、分组行级联、树形父子级联三态、`setSelection`/`getVisibleSelection`/`getSelectedIds` |
| **编辑** | 双击/Enter/F2/单击编辑、4 种内置编辑器 + 工厂自定义、`validate` 校验拦截、`valueSetter`、Tab 跳转、类型推断、**Undo/Redo** |
| **单元格操作** | 框选、Ctrl+C/X/V（TSV 互通）、Delete 批量清除、填充柄、右键菜单、`cellStyle`/`cellClass`、tooltip 定制、渲染器注册表 |
| **行特性** | 行分组 + 聚合（7 内置 + 自定义）、树形数据、主从明细（可嵌套子表格）、行合并、行拖拽、序号列、**固定首末行**、**变高行** |
| **汇总** | 合计行、状态栏（行数/选中数/范围聚合）、固定首末行 |
| **工程化** | 列状态记忆（含异步后端存储）、列设置面板、i18n、Schema 驱动、CSV 防公式注入导出、SSR 安全、ARIA + 键盘导航 |

## 适用场景

**强烈推荐**

- 后台管理列表页：分页/非分页、1 千 ~ 100 万行（无限滚动）
- 工业数据台账：状态标色、单元格校验编辑、批量粘贴录入
- 财务/报表：固定列、合计行、框选求和（状态栏实时聚合）
- 组织架构/物料清单：树形层级 + 级联勾选
- 订单/工单：主行展开明细（内嵌子表格/表单）
- 低代码平台：Schema JSON 驱动 + 渲染器注册表（配置可序列化）

**不建议**

- 纯只读的透视表/交叉表大屏 —— 考虑 canvas 渲染的 VTable 类方案
- 需要单元格级合并任意矩形（Excel 自由画布）—— 考虑 Handsontable/ Luckysheet
- 移动端长列表简单展示 —— 原生虚拟列表更轻

## 技术选型边界

完整竞品证据、统一评分矩阵和实测计划见[《数据表格竞品调研与提升计划》](../advanced/competitive-analysis.md)。下面仅用于快速确认产品路线，不替代按版本和商业/社区功能拆分的正式选型。

| 维度 | MachTable | AG Grid 社区版 | AG Grid 企业版 | TanStack Table | el-table |
| --- | --- | --- | --- | --- | --- |
| 渲染 | DOM + 双虚拟化 | DOM + 虚拟化 | DOM/canvas | Headless（自渲染） | DOM 全量 |
| 运行时依赖 | **0** | 2 | 多 | 1 | 0（随 EP） |
| 体积（gzip 内核） | ~65KB | 随模块与版本变化 | 随构建变化 | 轻量 headless | — |
| 固定列 / 拖拽调宽换位 | ✅ | ✅ | ✅ | 自实现 | 有限 |
| 范围框选 / 剪贴板 / 填充柄 | ✅ | ❌ | ✅ | 部分 | ❌ |
| 行分组聚合 / 树形 / 主从 | ✅ | ❌ | ✅ | 树形 headless | 树形 |
| 无限滚动 | ✅ | ✅ | ✅ | 手动 | ❌ |
| 撤销重做 | ✅ | ❌ | ❌ | ❌ | ❌ |
| 列状态持久化 | ✅ 内置 | 手动 | 手动 | 手动 | ❌ |
| Vue3 / React | ✅ | ✅ | ✅ | ✅ | Vue only |
| 许可 | Source-available，需作者书面授权 | MIT | 商业 | MIT | MIT |

MachTable 从 `0.9.1` 起不是 OSI 定义下的开源软件。公开源码只表示可查看，不表示可安装、运行、修改、集成、部署或分发；详见[许可证与授权](./licensing.md)。

## 包结构

| 包 | 说明 | 依赖 |
| --- | --- | --- |
| `@agile-team/mach-table` | 内核 + 原生用法 + 主题 CSS | 无 |
| `@agile-team/mach-table-vue` | Vue 单包入口；局部导入、全局同步插件、全局异步插件与预加载 | peer: vue ≥ 3.2 |
| `@agile-team/mach-table-react` | React 单包入口；命名导入与标准 `React.lazy` 默认导出 | peer: react/react-dom ≥ 18 |
| `@agile-team/mach-table-xlsx` | Excel 页面可选桥接；动态注入工作簿引擎，不进入默认包 | Core；工作簿引擎由宿主选择 |

内核、适配层与可选扩展独立发版、版本联动（changesets fixed）。Vue/React 项目平时只安装自己的适配包；只有 Excel 页面才增加 XLSX 扩展。

## 浏览器与环境

- 现代浏览器（Chrome/Edge ≥ 88、Firefox ≥ 89、Safari ≥ 14），依赖 `ResizeObserver`、`PointerEvent`、`color-mix`（范围高亮，低版本自动降级为无色块）
- 仓库开发与文档构建：Node.js ≥ 22.22.2、pnpm 11.8.0；发布包运行时仍以浏览器能力为准
- SSR 安全：内核只在浏览器执行 DOM 操作，Nuxt/Next 中客户端挂载后调用 `api.refreshLayout()`
