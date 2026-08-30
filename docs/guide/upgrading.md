# 版本升级指南

## 版本策略

MachTable 当前处于 `0.x`。Core、Vue、React 与可选 XLSX 包固定版本联动：

- patch：兼容性修复和文档改进；
- minor：新能力，也可能包含经过说明的破坏性调整；
- `1.0.0`：公共 API 和兼容策略稳定后再发布。

从 `0.4.1` 起，Vue/React 适配器会自动安装匹配版本的 Core；框架项目只需升级自己的适配包。

```bash
pnpm up @agile-team/mach-table-vue@^0.18.1
```

如果框架项目没有直接使用 Core 包路径，升级后可以移除原来的显式依赖：

```bash
pnpm remove @agile-team/mach-table
```

原有 Core import 和 CSS 路径继续兼容；新代码推荐统一从适配包导入 API、类型及 `styles.css`，从而保持真正的单包接入。

## 0.18.0 → 0.18.1

`0.18.1` 修复 Vue 适配包 CommonJS 根入口的重复重导出冲突。ESM 用户无需改代码；使用 `require()`、CommonJS SSR 或仍会消费 `require` 条件的构建链应至少升级到 `0.18.1`。发布门禁现在会直接执行 Core、Vue、React 与 XLSX 的 ESM/CJS 根入口，避免只校验文件存在而遗漏运行时冲突。

## 0.15 → 0.18

0.16/0.17 的能力统一在 0.18 发布，没有要求业务安装中间版本。现有列宽、查询、编辑和状态 API 保持兼容，主要变化如下：

- `GridState` 输出版本从 v1 升到 v2，增加 `advancedFilterModel`；`applyState()`、`initialState` 和内置 store 自动迁移 v1，不需要一次性清空用户状态。
- `FilterChangedEvent` 和远程查询参数增加 `advancedFilterModel`。原有 handler 可忽略新增字段；需要复杂筛选时使用[高级过滤 AST](/recipes/advanced-filter)。
- `saveChanges()` 继续返回成功的修改；需要逐行失败或版本冲突时改用 `saveChangesDetailed()`，Vue/React 使用 `useMachTableEditing().saveDetailed()`。
- 自定义 cell renderer 可选实现 `refresh(params): boolean`。不实现仍安全重建；Vue/React 官方 renderer 已自动原地刷新。
- `GridFeature` 可增加 `version/requires/conflicts`。重复 key、缺失依赖、冲突和循环会被隔离并写入诊断，而不会执行部分 setup。
- `updateOptions()` 现在丢弃运行时类型错误的 JS/JSON 字段并报告警告；依赖“传错类型后由内部强制转换”的代码必须修正输入。

命名视图是新增的偏好层，不替代 `stateKey`：前者不保存选择/展开/当前页，后者用于完整页面会话恢复。详见[命名视图](/recipes/saved-views)。

## 0.14 → 0.15

0.15 将用户交互式列宽调整改为显式启用，避免只读列表无意显示拖动热区：

```ts
// 建议放在 mach-table.config.ts，全应用只配置一次。
defineMachTableConfig({
  defaults: { enableColumnResize: true }
});
```

- 原来依赖 `defaultColDef.resizable: true` 的页面，需要增加表格级 `enableColumnResize: true`；列级 `resizable: false` 仍用于排除选择、序号和操作列。
- 列宽记忆不需要新的存储 API：完整工作区继续使用 `stateKey`，仅列偏好继续使用 `columnStateKey`。
- 新状态会携带可选 `flex` 与 `widthMode` 字段，使未手动拖动的普通列和弹性列都保持响应式；旧列状态仍可读取。
- 新增 `api.setColumnWidth(colId, width)`，非法宽度或未知列安全返回 `false`。
- `columnResized.finished: false` 不再触发状态写入；松手、键盘和 API 完成事件才保存。

## 0.13 → 0.14

0.14 以兼容新增为主，现有 `getRowId`、手动 GridState、`MachTableProvider defaults` 与 Vue 根入口工作流仍可使用：

- 简单稳定主键可改为 `rowKey: "id"`；同时提供 `getRowId` 时后者优先。
- `stateKey` 自动保存和恢复完整 GridState；已有自管状态无需迁移。不要让 `stateKey` 和业务手动恢复同时争夺最终状态。
- 远程查询错误现在使用一等 `error` overlay，而不是伪装成 no-rows；`useMachTableQuery().bindings` 已自动适配。
- `useMachTableQuery({ mode: "manual" })` 只在显式 `reload/reset/retry` 时请求；默认 `auto` 保持旧行为。
- Vue 标准工具栏位于同一包的 `/ui` 可选入口，基础插件不会自动注册；需要全局使用时额外 `.use(MachTableUiPlugin)`。
- React Provider 新增完整 `config`，`defaults` 继续作为兼容简写；React Hooks 必须在每次渲染中无条件调用，因此远程页面先调用 `useMachTableQuery`，再把结果传给 `useMachTableController`。
- 行操作确认按钮在没有服务端 `onSave` 时使用“确认”语义；显式 `labels.save` 继续覆盖。提供 `onSave` 后，失败会保留脏数据并重新打开整行编辑，便于修正或重试。

## 0.10 → 0.13

0.13 汇总验收了早期已合并但未按路线更新版本号的 0.11/0.12 能力，并新增列工作台、懒加载树和独立 XLSX 包。现有配置默认值保持兼容：

- `openColumnPanel()` 继续可用，新代码改用 `openColumnWorkbench()`；自定义抽屉读取 `getColumnWorkbenchItems()`。
- 普通树表不受影响；仅同时提供 `isTreeRowExpandable` 与 `loadTreeChildren` 时启用懒加载。
- Vue 的 `vueCellEditor()` 与 `createElementPlusEditors()` 从同包的 `@agile-team/mach-table-vue/editors` 按需导入，不安装 Element Plus 时不产生依赖。
- XLSX 不随适配器安装；只有 Excel 页面额外安装 `@agile-team/mach-table-xlsx` 和宿主选择的工作簿引擎。
- `useMachTableQuery` 新增错误/空态 overlay 绑定；已有 `#empty` 插槽仍可完全覆盖。

## 0.9 → 0.10

0.10 保留现有表格 props，并新增专用配置文件、命名 preset 与 `explainOption()`；Vue 新增原生插槽、`useMachTableQuery()` 和 `useMachTableEditing()`。默认列状态存储改为版本化信封，但会自动读取旧数组格式；需要读取原始 localStorage 的业务代码应改用 `loadColumnState()`。

两个 composable 仍可从 Vue 根入口导入；对体积敏感的新代码推荐从 `@agile-team/mach-table-vue/workflows` 导入。它是同一个安装包的按需子入口，不增加依赖。

远程查询在业务查询/过滤变化时默认清空跨页选择，防止旧查询误操作新数据。如旧业务明确需要保留，设置 `clearSelectionOnQueryChange: false`。`saveChanges()` handler 可返回 `{ savedRowIds }` 表示部分成功，省略时行为与 0.9 一致。

## 0.5 → 0.9

0.9 保留既有 API，并把 `MachTable` 设为规范组件名。`RobotGrid` 和对应 Props 类型仍可用，但已标注 deprecated，建议在 1.0 前完成替换。

新增能力均为 opt-in 或兼容默认值：

- Vue 插件支持 `defaults`，并新增 `provideMachTableDefaults`；异步插件支持加载/错误组件、超时和重试回调。
- React 新增 `MachTableProvider`；默认组件导出仍支持 `React.lazy`。
- `validate` 可返回 Promise；命令式调用可改为 `await api.stopEditingAsync()`。
- 新增 `GridState`、脏数据/保存/回滚、异步事务、数据源重试、诊断快照和稳定错误码。
- Tree/group 角色现在使用 `treegrid`；若 E2E 写死 `getByRole("grid")`，请按实际模式改成 `grid` 或 `treegrid`。

`onGridError` 载荷新增必填 `code` 字段，不影响只解构旧字段的代码。监控聚合建议从易变的 `source` 迁移到稳定 `code`。

## 0.4 → 0.5

`0.5.0` 新增加载能力，不会破坏已有局部导入：

- Vue 可选 `MachTablePlugin` 全局同步注入。
- Vue 可从 `@agile-team/mach-table-vue/async` 使用全局异步注入和 `preloadMachTable()`。
- React 根入口新增默认组件导出，可直接交给 `React.lazy`。
- 局部 `import { MachTable }`、原 Core API 和既有样式路径继续兼容。

## 标准升级流程

1. 阅读 Core 与适配器的 `CHANGELOG.md`。
2. 在独立分支升级并提交 lockfile。
3. 执行类型检查、单元测试和表格业务 E2E。
4. 验证选择、编辑、导出、列状态、弹窗布局和服务端数据源。
5. 灰度发布；保留上一 lockfile/制品作为回滚点。

## 0.3 → 0.4

### 包名迁移

| 旧名称 | 0.4 正式名称 |
| --- | --- |
| `@mach-table/core` | `@agile-team/mach-table` |
| `@mach-table/vue` | `@agile-team/mach-table-vue` |
| `@mach-table/react` | `@agile-team/mach-table-react` |

替换依赖和 import，并重新生成 lockfile。

### Overlay 安全默认值

自定义 Overlay 的字符串现在按纯文本渲染：

```ts
overlayNoRowsTemplate: "<strong>暂无数据</strong>" // 显示为文本，不再解释 HTML
```

推荐改为 DOM 工厂：

```ts
overlayNoRowsTemplate: () => {
  const message = document.createElement("strong");
  message.textContent = "暂无数据";
  return message;
}
```

只有完全可信的静态 HTML 才可临时设置 `allowUnsafeOverlayHtml: true`。

### 适配器更新

- Vue/React 现在同步全部 GridOptions，运行时变化不再遗漏数据源、列默认值、树形、Feature 等选项。
- `gridClassName` 会响应式更新内部 `.mach-root`。
- Vue `useMachTable` 和 React `useMachGrid` 在卸载后正确清空 API 状态。
- 同一批次同时更新数据源与结构选项只触发一次数据加载。

### 扩展机制

新增实例级 `components` 和 `features`。业务扩展应优先使用 `GridFeature` 组合，不要继承内部 Service 或修改 `GridCore`。

## 列状态迁移

如果升级同时改变了 `colId`、固定列或分组结构，应升级 `columnStateKey` 的版本后缀：

```ts
columnStateKey: "orders-v2"
```

这比尝试兼容所有旧状态更可靠。

## 回滚

回滚必须同时回滚本次实际安装的 MachTable 包和 lockfile。若新版本已经写入新的列状态 key，旧版本继续使用旧 key，不要复用不兼容状态。
