# 升级指南

MachTable 尚处于 0.x，minor 版本可能包含有意的契约整理。升级前阅读本页与各包 Changelog，并在业务预发布环境回归。

```bash
pnpm up @agile-team/mach-table-vue@^0.34.0
# 或
pnpm up @agile-team/mach-table-react@^0.34.0
```

## 0.33.0 → 0.34.0

四包固定版本组同步升级。原有根入口 API、表格配置、列值与 XLSX 默认行为保持兼容。新增 `createDictionaryColumn()` 与 `summarizeRows()` 只从 Core/Vue/React 的 `/business` 按需导入，无 UI、附加 CSS、自动请求或额外运行时依赖。

- 字典列辅助使用现有 Provider 的同步 `get()`，异步标签须由应用先预热。`display` 默认 `label`，未声明的 clipboard/csv/xlsx 输出保留原编码及类型；原有 `createDictionaryRenderer()` 继续仅负责渲染，不改变导出默认值。标签反向解析要求显式 `options`，以新数组替换不可变快照；原码优先，重复标签或码名冲突拒绝歧义，未知值由列 `validate` 决定是否允许提交。
- `createCachedDictionary.resolve()` 复用同 key 已排队或在途的 Promise。`invalidate(keys)` 或无参数全量失效现在同时结束对应等待任务，结果为 `undefined`，并隔离旧响应；之后 `resolve()` 发起新代次。`prime()` 显式值优先并完成对应等待，`destroy()` 拒绝未完成请求，销毁后不再接受回填。依赖旧在途请求在失效后继续回填的页面须改为显式重新请求。
- 成功响应中未返回的 key 作为缺失项进入相同 TTL/LRU，`size` 包含这些缺失项；`ttlMs: 0` 表示直到失效或 LRU 淘汰。需要立即重试缺失项时先 `invalidate()`；加载失败不缓存，后续请求可重试。错误观察回调异常不会阻止等待任务结束。
- `summarizeRows()` 显式声明 `page` / `selected` / `query`，只汇总传入数组；`query` 不自动获取全量。币种、单位等分组由业务传入，`ratio` 分别汇总分子分母后相除。默认数值策略拒绝数值字符串、非法值和安全范围溢出，不保证精确小数；已有精确算法通过同步 `numeric` 策略接入。结果继续交给已有 `summaryMethod` 或固定行。

详见[业务列与字典](/recipes/business-columns)和[列值策略](/recipes/column-values)。本轮发布与消费状态以[实施台账](/advanced/implementation-plan)为准。

## 0.32.1 → 0.33.0

四包固定版本组同步升级。原有领域 API 与单包框架接入保持有效，新增 `/import` 为可选入口，无附加样式。请关注以下行为收口：

- 应用 defaults / preset 中的 `dataProcessor` 改为每表工厂 `() => createWorkerDataProcessor(...)`，避免共享实例被其他表销毁；直接单表 `GridOptions.dataProcessor` 仍接受独占实例。动态替换会释放旧实例，工厂每个 owner 只解析一次。
- 可在既有 `columnTypes` / `defaultColDef` / 列配置中声明同步 `valueParser` / `valueSerializer`。单次导入显式 `parseValue` 优先于列 parser，不重复调用；排序、过滤、可信事务和撤销使用已有规范值。解析异常会拒绝输入，而不是悄悄保留未经解析的原文。
- `io.exportMatrix()` 默认返回保留类型的二维值，`target` 默认为 `"xlsx"`，文件读写仍由独立 XLSX 包提供。`importMatrix()` 与 `importCsv()` 返回同步 `boolean`，受 10000 数据行、含表头共 100000 单元格边界约束；replace/append 装载记录，paste 发起既有输入校验，其返回值不表达后续异步校验结果。需要预览、整批校验后 replace/append 或逐行 paste 时使用 `/import`；已有编辑或未保存记录不能被计划装载悄悄覆盖。详见[列值策略](/recipes/column-values)和[导入预览](/recipes/import-preview)。
- `/import` 的 replace/append 计划明确要求扁平本地模型，`treeData: true` 返回 `UNSUPPORTED`；树的当前显示节点仍可 paste。计划 paste 与既有输入一致：同值和 parser 返回 `undefined` 不写 setter、不发事件、不产生 undo；全部无变化是成功请求，`importedRowCount: 0`，不把无变化行算作部分失败。
- XLSX 默认保留 number/boolean/Date，`valueFormatter` 不再先转为显示 CSV。默认读取 `raw: true`、`cellDates: true`；旧显式字符串 `transformCell` / `parseValue` 继续执行。需要自定义导出形态时配置列 serializer 或转换回调。
- 默认数字聚合忽略 NaN / Infinity，空数值集合与溢出返回 null，min/max 不再对大数组展开；count 仍计全部记录。自定义聚合不改变原始输入契约。
- 分组身份采用列 ID 与类型化路径，数字 `1`、文本 `"1"`、空值和文本 `"(空)"` 各自独立。既有持久化展开路径仅在全量输入中唯一时迁移；歧义清除并通过 `gridState.groupExpansion` 报告，避免展开错误分组。业务不应解析内部分组 ID 字符串。canonical 分组 ID 的持久化上限为 65536 个 JavaScript 字符（按 `String.length`，非 UTF-8 字节数），展开 ID 列表的总字符预算仍为 `100000 × 512`；普通行/列和旧路径 ID 仍为 512 字符。超协议长度的身份不参与状态恢复，模型本身可继续展示这些分组；内置持久化 store 的 `maxBytes` 另行限制整个快照。
- 超大普通布局采用最多 16000000px 的物理滚动轴，行高保持不变。API、键盘、滚轮、填充与拖拽使用逻辑坐标；原生触屏惯性滚动仍按物理轴比例映射，真实设备手势验收单列待人工。`autoHeight` 不属于虚拟滚动路径。

普通字段的无关更新可以跳过排序、过滤和分组；上次投影保存活动字段的标量基线，以兼容原地修改后提交副本。getter、自定义 comparator/aggregate、对象叶值、树和处理器等无法可靠声明依赖的情形保持完整重算，相关字段变化仍完整刷新，不承诺已有局部祖先聚合缓存。

## 0.32.0 → 0.32.1

公共 API 与配置无需迁移。修正可选 `/ordering` 控制器在筛选后执行 Alt + ↑/↓ 时，目标可能选到隐藏兄弟行的问题：现在跳过筛选隐藏行，以对应方向的相邻可见兄弟行作为目标；到达可见边界时不移动。

排序仍基于宿主持有的完整数据模型，不把筛选后的可见数组写回数据源，隐藏记录不会丢失。例如完整数据为 A、B、C，筛选仅显示 A、C：C 上移后可见顺序为 C、A，完整模型仍保留 A、B、C 三条记录。保存继续使用稳定 ID 与完整排序计划，既有 CAS、撤销/重做和失败回滚协议不变。

四包按固定版本组同步升级到 `0.32.1`，XLSX 桥接 API 不变。

## 0.31.2 → 0.32.0

现有根入口、领域 API 和单行托管排序接入保持兼容。新增能力显式从 `/workbench`、`/preferences`、`/ordering`、`/server-side`、`/analysis`、`/multi-range` 导入；Vue/React 从对应适配包的同名子路径导入，继续只安装一个包。

- 过滤/修改审阅/诊断和分析 UI 引入 `/styles/workbench.css`，服务端分组控件引入 `/styles/server-side.css`；原有 `styles.css`/`styles/mach-table.css` 路径保持有效。
- 新增 `rowDragPolicy` 行级与目标判定。高级多行/树排序由 `createRowOrderController().bindings` 接入，复用默认手柄及主题；普通托管排序的旧事件下标语义保持不变。
- 排序控制器 `undo()`/`redo()` 与移动共用保存通道和版本检查。保存端须原子处理 `context.operations` 全批次或 `context.plan.after`；旧的单意图 transport 只支持普通移动，不会自动实现复杂撤销。
- 服务端 Store 是显式 route 分页的数据模型，绑定时接管手动排序/过滤和客户端分页；不能与原有 datasource 或查询工作流同时绑定同一表格。有编辑或未保存数据时新投影等待显示，保存/回滚/取消后继续。
- 状态默认仍严格接受 v2；历史 v1、字段重命名、删除和过滤类型变化通过可选偏好适配器显式迁移并报告。切换账号须创建新 store，不能复用已绑定旧身份的实例。
- Vue KeepAlive 停用会关闭临时编辑/弹层与拖拽，保留模型、脏数据、选择和滚动；重新激活只恢复布局，不抢占页面其他输入的焦点。
- Pivot、公式及多范围有明确资源上限，超限报告错误，不截断为伪完整结果。远程分析限定已加载视图；多业务 UAT、人工读屏与双边性能比较不由自动测试代替。

详见[按需工作台](../recipes/workbench.md)、[排序](../recipes/row-presentation.md)、[企业偏好](../recipes/enterprise-preferences.md)、[服务端 Store](../recipes/server-side-store.md)、[分析](../recipes/analysis.md)、[多范围](../recipes/multi-range.md)。

## 0.31.1 → 0.31.2

公共 API 与配置无需迁移。粘贴、清空、填充现在与编辑器一样执行已有列 `validate` 和整行 `rowEditValidator`；批量输入按行拒绝无效数据，有效行形成一条撤销记录。旧版本依赖“粘贴绕过校验”的逻辑应移除；可信数据更新继续使用 `rows.transact()`。

随机块淘汰会保留未保存行供保存/回滚；渲染、焦点和编辑块所需范围可临时超过 `maxBlocksInCache`，上界为保护块数加一个取数槽。完整 `rows.setData()`、`reload()`、`purgeCache()` 和远程查询切换会清空旧作用域的脏状态与撤销历史。异步输入/保存不会写入同 ID 的新记录。Vue/React 编辑工作流隔离过期保存结果和冲突，React 查询也修正 StrictMode 与同值搜索的重复请求。详见[剪贴板](/recipes/clipboard)、[随机块缓存](/recipes/random-access-datasource)与[批量保存](/recipes/batch-save)。

## 0.31.0 → 0.31.1

修正 Vue 表格按 key 重建时组件 ref 可能早于 mounted 执行的问题。`useMachTable()` 与 `useMachTableController()` 会在挂载完成后绑定新 API，正确同步 ready、选择状态和工具栏命令；已替换或卸载实例的延迟任务不会回写。页面配置无需迁移。

## 0.30.1 → 0.31.0

新增可选 `rowStyleRules`，不配置时沿用原有样式。`dragColumn()` 默认固定左侧并固定工具列宽；可用 overrides 调整。自动拖拽与 `rows.reorder()` 在列排序、分组、树、远程和 dataProcessor 模式下会拒绝重排；外部维护顺序的扁平数据请使用 `applyRowDrag: false`。`rowDragEnd` 现在在自动移动完成后发出，新增 `targetIndex`（最终下标）和 `applied`；保留旧 `toIndex` 插入边界语义。依赖回调前读取旧顺序的代码需要调整。详见[行拖拽与条件整行颜色](/recipes/row-presentation)。

## 0.30.0 → 0.30.1

修正固定列宽被重复扣除造成的留白。`columnLayout: "fit"` 继续按定义比例填满容器，`autoSize()` / `autoSizeAll()` 的测量结果保留为响应式内容基准；旧手动宽度仍保持固定。`columns.fit()` 保留固定列及 `suppressSizeToFit` 列，在 `fit` 模式下恢复自动列的响应性。正常布局模式行为不变，业务无需增加 ResizeObserver 或 ready 回调。详见[列状态与内容自适应](/recipes/column-state)。

## 0.29.2 → 0.30.0

0.30.0 仅增加 `createRemoteExportRequest()` 辅助函数，不改变 `GridApi`、`GridOptions` 或既有渲染、编辑、CSV/XLSX 与工具栏的默认行为。现有页面可直接升级，无需迁移配置。服务端全量导出按[导出配方](/recipes/remote-export)由业务显式接入。

## 0.25 → 0.28

0.28 是稳定性治理版本，没有新增、删除或改名公共 API，也不要求修改现有 Vue/React 页面：

- 31 项历史圈复杂度豁免已全部清零，所有生产函数统一受 `15` 的门禁约束。
- 配置解析、布局、渲染、选择、筛选、编辑动作和交互事件按职责拆分，公共 API 快照保持不变。
- 集合筛选在搜索后会保留不可见选项的已选状态，并正确区分同文本的数字/字符串/空值；列菜单按下不再进入列拖拽路径。
- 直接把框架适配包升级到 `^0.29.2` 即可；无需额外安装 Core，也无需迁移配置文件。

## 0.24 → 0.25

0.25 是正式接入前的契约终审版本：

- `persistence.sections` 现在同时限制写入与恢复；`columns` 不再隐式携带排序，异步 store 写入保持顺序并合并为最新快照。
- `useMachTableQuery().reset()` 同时清空普通、高级和快速过滤，且只发起一次请求。
- 应用配置中的事件观察器会与 Vue 页面监听器/React 组件回调各执行一次。
- Vue 全局 `MachTableToolbar` 类型只在导入 `/ui` 后生效，与可选插件的实际注册边界一致。
- `ActionItem.danger` 改为唯一入口 `variant: "danger"`；暗色配置统一使用 `theme: "dark"`，不再从 `className` 推断。

## 0.23 → 0.24

0.24 在正式规模接入前完成 API 收口，不保留重复/旧名称的兼容层。核心能力没有被删除，而是归入唯一入口。

### 1. 平面 GridApi 改为领域 API

| 0.23 调用 | 0.24 调用 |
| --- | --- |
| `api.setRowData(rows)` | `api.rows.setData(rows)` |
| `api.applyTransaction(tx)` | `api.rows.transact(tx)` |
| `api.getSelectedRows()` | `api.selection.getRows()` |
| `api.setColumnWidth(id, width)` | `api.columns.setWidth(id, width)` |
| `api.openColumnWorkbench()` | `api.columns.openWorkbench()` |
| `api.setQuickFilter(text)` | `api.filtering.setQuickText(text)` |
| `api.getState()` / `applyState()` | `api.state.get()` / `api.state.apply()` |
| `api.saveChangesDetailed(handler)` | `api.editing.save(handler)` |
| `api.undo()` / `redo()` | `api.editing.undo()` / `api.editing.redo()` |
| `api.getDataAsCsv()` | `api.io.exportCsv()` |
| `api.refreshCells()` / `refreshLayout()` | `api.view.refreshCells()` / `api.view.refreshLayout()` |
| `api.getDiagnostics()` | `api.diagnostics.get()` |

根级仍保留 `batch`、`whenReady`、`getOption`、`updateOptions`、`on`、`destroy`、`isDestroyed`。

```ts
api.batch((grid) => {
  grid.rows.transact({ update: changedRows });
  grid.view.refreshCells({ rowIds: changedIds });
});
```

### 2. 只使用 `rowKey`

简单字段和派生规则统一为：

```ts
rowKey: "id"
rowKey: (row) => `${row.tenantId}:${row.id}`
```

回调直接接收行数据，不再接收 `{ data }` 参数对象。

### 3. 持久化合并为一个配置

完整工作区：

```ts
persistence: { key: "tenant:user:orders" }
```

只保存列宽、顺序、显隐、固定和排序：

```ts
persistence: {
  key: "tenant:user:orders",
  sections: ["columns", "sort"],
  store: customStore,
  debounceMs: 160
}
```

旧的多组 state/column state key 与 store 不再存在。`initialState` 和手动 `api.state.apply()` 继续使用同一 GridState v2 契约。

### 4. 框架命名统一

- Vue/React 组件只有 `MachTable`。
- Vue/React 生命周期 Hook 都叫 `useMachTable()`。
- 远程 Query 返回 `bindings`，不再提供重复别名。
- Vue 只保留 `provideMachTableConfig()`，不再维护另一套 defaults 注入函数。
- React Provider 只接收 `config`。

### 5. 可选能力从子入口导入

```ts
import { useMachTableQuery } from "@agile-team/mach-table-vue/workflows";
import { MachTableToolbar } from "@agile-team/mach-table-vue/ui";
import { vueCellRenderer } from "@agile-team/mach-table-vue/adapters";
```

React 使用相同的 `/workflows`、`/ui`、`/adapters`、`/worker` 结构。Vue 另有 `/async` 与 `/editors`。

### 6. renderer/editor 注册改为作用域配置

内置 renderer 保持不可变。业务组件通过应用配置顶层 `components` 或单表 `components` 注入，不再使用进程级可变注册函数：

```ts
defineMachTableConfig({
  components: { cellRenderers: { statusTag: StatusTagRenderer } }
});
```

这避免 SSR、多租户、微前端和测试之间互相污染。

### 7. Locale 与 State 名称

- `MachTableLocale` / `MachTableLocaleKey` 是规范类型名。
- `normalizeGridState()` 只归一化当前 v2 输入。
- v1 迁移代码已移除；旧业务快照应由宿主迁移或清空后再升级。

## 升级验证

```bash
pnpm typecheck
pnpm build
pnpm test
```

业务项目重点验证：

- 所有命令已进入正确领域。
- `rowKey` 回调签名正确且全局唯一。
- 持久化恢复的区段符合预期。
- Vue/React 可选能力从子入口导入。
- 编辑部分成功/冲突和远程请求取消仍按业务预期工作。
- 列宽拖动后刷新页面能恢复且不会跨用户串状态。

更早版本的历史变更保留在各包 Changelog；当前接入文档不再展示已删除 API，避免复制旧示例。
