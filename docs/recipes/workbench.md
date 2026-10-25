# 高级筛选、修改审阅与诊断工作台

工作台通过可选 `/workbench` 入口挂载，复用现有 `GridApi`。它们是页面内的独立区域，适合放在表格旁、抽屉内容区或详情区域；不需要重新创建表格，也不维护第二份筛选或修改状态。

## 导入与生命周期

```ts
import {
  mountAdvancedFilterBuilder,
  mountChangeReview,
  mountDiagnostics,
  type WorkbenchHandle
} from '@agile-team/mach-table/workbench';
import '@agile-team/mach-table/styles/workbench.css';

// api 已就绪；host 是表格容器外的一个 HTMLElement。
let active: WorkbenchHandle | null = null;
function openFilter(trigger: HTMLElement) {
  active?.destroy();
  trigger.focus();
  active = mountAdvancedFilterBuilder(host, {
    api,
    onClose: () => { active = null; }
  });
}

// 宿主区域卸载时主动释放；表格销毁也会自动释放工作台。
function closeWorkbench() {
  active?.destroy();
  active = null;
}
```

Vue 和 React 只从所使用的适配包导入，无需另外安装或直接引用 Core：

| 使用环境 | 函数与类型入口 | 样式入口 |
| --- | --- | --- |
| Core | `@agile-team/mach-table/workbench` | `@agile-team/mach-table/styles/workbench.css` |
| Vue | `@agile-team/mach-table-vue/workbench` | `@agile-team/mach-table-vue/styles/workbench.css` |
| React | `@agile-team/mach-table-react/workbench` | `@agile-team/mach-table-react/styles/workbench.css` |

在 Vue 的 API 就绪后或 React 的 effect 内挂载；API 实例改变时先销毁旧 handle，再用新 API 挂载。不要在每次 render 时调用工厂。三个工作台都返回 `refresh()` / `destroy()`，销毁可重复调用；工作台自动跟随关联表格实际明暗主题（包括 `auto` 与系统后续切换），并同步表格根节点上的主题令牌；宿主修改外层 CSS 规则或其他配置后，可手动调用 `refresh()` 重新同步。`onClose` 用于用户点击关闭、取消或按 Escape 的通知，直接调用 `destroy()` 不会再次通知。

不导入该子入口时，普通表格无需加载工作台实现与工作台 CSS。静态 import 会进入当前页面的构建依赖；需要打开时再下载，可由页面使用动态 import，并在等待后再次确认 API 与宿主仍属于当前实例。

## 高级筛选：草稿确认后生效

```ts
const builder = mountAdvancedFilterBuilder(host, {
  api,
  // 省略 fields 时从列定义推断。
  fields: [
    { colId: 'amount', label: '金额', type: 'number' },
    { colId: 'createdAt', label: '创建日期', type: 'date' },
    { colId: 'status', label: '状态', type: 'set', options: [
      { label: '待处理', value: 'pending' },
      { label: '已完成', value: 'done' }
    ] }
  ]
});

const draft = builder.getDraft(); // 脱离内部对象的快照
builder.setDraft(draft);         // 只更新草稿
const applied = builder.apply(); // 验证通过才写入 api.filtering
builder.cancel();               // 重新读取当前已生效模型，面板继续保留
```

显式传入 `fields` 时，它就是工作台可选字段清单；只有当前列 schema 中存在的 ID 会被接纳。省略时根据列的 `filter`、编辑器、字典和当前首行值推断。字段类型不明确、远程数据尚未到达或业务字典不完整时，建议明确配置。

面板编辑现有 `AdvancedFilterModel`，支持嵌套 AND / OR、整组 NOT、文本/数值/日期/集合条件。点击“应用筛选”才更新表格；“清空草稿”也需要应用。“取消”按钮关闭面板并放弃草稿，`cancel()` 方法则保留面板并重新读取当前模型。未完成条件、非法日期/区间、移除字段和字段类型不匹配会显示错误，阻止应用，避免悄悄删掉条件后扩大查询范围。

用户编辑草稿期间，外部筛选更新会保留草稿并提示冲突；取消可重新加载最新模型。高级条件仍通过 `api.filtering.setAdvancedModel()` 生效，与普通过滤和快速搜索共同工作；远程查询接收同一 AST，命名视图也保存同一高级过滤模型。面板本身不会发 HTTP 请求或创建另一种过滤语言。参见[高级过滤表达式](/recipes/advanced-filter)和[命名视图](/recipes/saved-views)。

条件树上限为 512 个节点、16 层，每字段最多 20 条值条件。集合字段优先读取列字典；没有显式字典时，仅从当前视图前 2000 行采样，不能代表远程全集。当前字典外的已选值会保留并标注，避免恢复视图时丢失条件。

## 修改审阅：复用批量保存协议

```ts
const review = mountChangeReview(host, {
  api,
  save: changes => orderApi.saveChanges(changes)
});
```

`save` 使用现有 `SaveChangesHandler`：宿主把后端响应转换成成功、失败及冲突结果，协议见[批量保存与版本冲突](/recipes/batch-save)。不提供处理器时仍可查看差异、定位和撤销，保存按钮会禁用并说明原因。

面板显示稳定行 ID、字段名称、原值/新值、问题字段和错误信息，支持逐行/全部撤销、保存全部，以及仅重试仍存在且允许重试的失败/冲突。每页 20 行，每行每页 20 个字段，避免一次粘贴后创建无界 DOM。被筛选、分页或缓存淘汰的行可能无法直接定位，面板会提示调整视图。

冲突提供明确操作：“保留本地并重试”保留本地修改并仅重试该行，不会自动把 `serverVersion` 合入业务数据；服务端版本合并与 CAS 由宿主 `save` 处理器负责。“采用服务端记录”需要服务端返回匹配行 ID 的 `serverData`。部分成功的行不会重复提交；保存期间的新修改继续保留。保存中禁止重复提交和回滚，关闭面板不会取消已经发出的保存请求。换数据作用域或换实例后的旧响应不能确认新数据的修改。

审阅面板展示保存结果中的问题，不额外执行一轮全表业务校验；审批、协同和后端权限由宿主实现。

## 诊断：手动快照与规则解释

```ts
const diagnostics = mountDiagnostics(host, {
  api,
  // 可选：传入宿主已有配置解析器的 explain 函数。
  // Vue 组件实例可提供 explainOption(key)。
  explain: key => tableInstance.explainOption(key)
});
```

也可以只传 `{ api }`。面板读取公开诊断快照，显示行列数量、dirty、活动扩展、性能与更新调度快照及近期错误。配置来源只有传入 `explain` 后才显示来源层；未提供时明确显示“未知”，不会从当前值猜测来源。

输入稳定行 ID，点击“检查记录”后会检查这一行的已知拖拽限制、显示/渲染状态及排序过滤执行模式，并按首条命中解释 `rowStyleRules`。检查会按需执行业务 `canDrag` 和样式回调，可能触发宿主副作用；异常会隔离，宿主仍应编写无副作用的判定函数。面板挂载、刷新和切换配置项不会重新执行这些行回调，结果明确作为上次显式检查快照展示。

无需面板时，可使用相同的可选结构化接口：

```ts
import { inspectGridRow, type GridRowInspection } from '@agile-team/mach-table-vue/workbench';

const inspection: GridRowInspection = inspectGridRow(api, 'ORDER-1024');
// inspection.drag: { allowed: boolean | null, policyEvaluated, reasons: [{ code, message }] }
// inspection.visibility / rendered / execution / notes
```

检查仅按 ID 读取一个节点、核对一个当前显示下标，并检查有限的已渲染 DOM；不遍历数据行、不执行过滤谓词、不触发远程加载。已知原因包括活动编辑、结构/加载行、自动分组、托管模式与树形 / datasource / dataProcessor / 列排序冲突，以及业务拒绝或异常。没有当前渲染手柄时，`drag.allowed` 可为 `null`；非托管树形是否已安装层级交互不能单凭 policy 存在推断为可用。检查不会在缺少目标行时调用 `canDrop`，源行可拖也不代表任意落点有效。

未显示行可能被过滤、折叠、位于其他页或仅保留 dirty 草稿，公开信息不足时会列出候选；已显示但未渲染的行会说明可能处于虚拟窗口之外。手柄禁用但公开信息不足时保留通用原因，不推断成权限拒绝。业务判定期间替换同 ID 记录会使结果过期。

排序/过滤模式区分客户端、手动宿主处理、datasource，以及“客户端或 dataProcessor”。最后一项不冒充处理器实际执行轨迹：规模阈值、失败回退等当前分支并未公开。面板没有恢复阶段追踪、慢 renderer 归因或脱敏导出功能；业务数据和错误文本是否可以向最终用户展示，由宿主决定。

## 键盘与可访问性边界

工作台使用带名称的 `section`、原生按钮和表单控件，按正常 Tab 顺序导航。Escape 关闭；若关闭时焦点还在工作台内，会恢复到打开前已经聚焦的元素。宿主希望返回打开按钮时，应在挂载前显式调用 `trigger.focus()`，因为鼠标点击按钮并非所有浏览器都会自动聚焦。Safari 的原生全控件遍历可使用 Option+Tab；工作台不接管 Tab 或替宿主抽屉实现模态焦点锁定。诊断刷新保留内部控件焦点；原控件已移除且没有对应控件时，回到工作台区域，不抢占外部焦点。

自动化测试检查角色、可访问名称、键盘路径、主题与强制颜色模拟；这些检查不能证明 NVDA、JAWS 或 VoiceOver 的真实朗读表现。本轮尚无 Windows 真人读屏验收，相关矩阵与待验收项见[可访问性与键盘](/advanced/accessibility)。
