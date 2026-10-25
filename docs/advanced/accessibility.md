# 可访问性与键盘规范

MachTable 0.28 按 WAI-ARIA Grid / Treegrid 交互模型实现语义和键盘基础。业务仍需为页面提供清晰标题、操作说明、颜色对比和可访问的自定义 renderer/editor。

## 可访问名称

```ts
{
  ariaLabel: "订单列表",
  ariaDescribedBy: "orders-grid-help"
}
```

有可见标题时优先使用 `ariaLabelledBy` 指向标题 id。Vue/React 的宿主 `aria-*` 属性作用于外层容器；内部网格请使用 `gridAriaLabel`、`gridAriaLabelledBy`、`gridAriaDescribedBy`。

网格会根据能力自动维护：

- 普通表格 `role="grid"`，树/分组表格 `role="treegrid"`；
- `aria-rowcount`、`aria-colcount`、`aria-rowindex`、`aria-colindex`；
- 多选、只读、展开层级、行列合并与活动单元格；
- `aria-activedescendant` 指向当前焦点格，虚拟滚动后保持稳定 id。

## 键盘

| 区域 | 按键 | 行为 |
| --- | --- | --- |
| 单元格 | 方向键、Home/End、PageUp/PageDown | 移动焦点并按需滚动 |
| 单元格 | Enter / F2 | 进入编辑 |
| 编辑器 | Enter / Tab / Shift+Tab | 校验并确认；Tab 在可编辑格间移动，到边界后退出表格 |
| 编辑器 | Escape | 取消编辑 |
| 表头 | 左右方向、Home/End | roving tabindex 导航 |
| 表头 | Enter / Space | 排序 |
| 表头 | Alt+左右方向 | 调整列宽（需 `enableColumnResize: true`） |
| 表头 | Ctrl+左右方向 | 移动列 |

单元格编辑不会因焦点移出或指针操作自动提交。鼠标用户通过就地对勾/取消控件结束事务；键盘用户继续使用 Enter、Escape、Tab。输入法处于组合输入阶段时，Enter 不会被误识别为提交命令。

列筛选条件使用内置 `combobox` / `listbox` 交互，不依赖操作系统原生下拉弹窗；方向键、Home、End、Enter 和 Space 用于选择条件。第一次按 Escape 只收起条件列表并保留筛选面板，第二次按 Escape 才关闭面板。

设置 `suppressCellFocus` 或 `suppressHeaderFocus` 会关闭对应键盘入口，只应用在确有替代交互的只读展示场景。

## 自定义内容责任

- 交互控件必须使用原生 `button` / `input` 或提供等价角色、名称和键盘行为；
- 不要只用颜色表达状态；状态标签同时渲染文本；
- 异步编辑校验应返回明确错误字符串；MachTable 会设置 `aria-invalid`、`aria-busy` 并把焦点留在编辑器；
- 自定义 detail/renderer 的 tab 顺序由组件作者负责。

## 自动化验收

仓库在 Chromium、Firefox、WebKit 验证角色、活动单元格、方向键、编辑与过滤弹层生命周期。业务 E2E 至少补一条真实列模型的键盘路径，并在目标读屏软件上做人工抽查。

### 可选工作台与分析模块矩阵

`tests/e2e/workbench.spec.ts` 使用独立页面、公开 `GridApi` 和实际构建产物执行下列自动化场景。执行结果以当前 Playwright 报告为准；测试代码存在本身不代表全部引擎已经通过。

| 场景 | Chromium | Firefox | WebKit | 自动检查内容 |
| --- | --- | --- | --- | --- |
| 高级筛选与命名视图 | 覆盖 | 覆盖 | 覆盖 | 草稿隔离、应用、取消、AST 往返、视图恢复、控件可访问名称 |
| 修改审阅与冲突 | 覆盖 | 覆盖 | 覆盖 | 部分成功、仅重试剩余项、多行连续冲突、保留本地/采用服务端、同 ID 换数后的晚到隔离 |
| 公式、Pivot 与图表 | 覆盖 | 覆盖 | 覆盖 | 公式输入、聚合合计、柱/线图名称、完整数值表分页、公式错误位置 |
| 浅色/深色诊断 | 覆盖 | 覆盖 | 覆盖 | 主题 token、规则命中文本、手动快照、错误文本安全显示、Escape 与触发焦点恢复 |
| 强制高对比颜色 | 覆盖 | 不执行此模拟 | 不执行此模拟 | `forced-colors` 生效、边框和键盘焦点可见、NOT/规则含义同时提供文本 |

工作台是页面内有名称的 `section` 区域，采用原生表单控件和正常 Tab 顺序，不声明模态对话框。关闭或 Escape 会在焦点仍属于工作台时恢复打开前已聚焦的元素；宿主若希望返回打开按钮，应在挂载前显式聚焦该按钮。Safari 的按钮遍历遵循原生 Option+Tab 路径；诊断刷新保留内部焦点，不能抢占外部焦点。图表提供有名称的 SVG，并以可分页表格提供完整数值；图表只画前 40 组时会明确说明。审阅按行、字段分别分页，大批输入在下一次绘制前合并为一次刷新。

多范围附加选区使用独立的边框轮廓；强制颜色模式保留 `Highlight` 轮廓，不能只依靠淡色背景判断选区。行状态颜色必须同时配合业务状态文本或可选图例。

### 尚需真实读屏软件验收

本轮 DOM、可访问树快照、键盘和颜色模拟不能替代真实辅助技术。用户已确认目前暂无对应人工验收环境，以下项目保留待人工，不应以自动化通过标记为已完成；本轮实际自动化统计见[实施与验收台账](/advanced/implementation-plan)。

- NVDA + Firefox：虚拟行移动、工作台进入/退出、嵌套 AND/OR/NOT 与校验消息朗读。
- JAWS + Chrome：修改前后值表格、部分保存和冲突提示、分页后的当前位置与焦点。
- VoiceOver + Safari：原生多选字典、SVG 名称和数据表、Escape 返回触发按钮。
- 操作系统高对比与缩放：200%/400% 缩放、系统颜色主题、不同输入法及仅键盘完成整条操作链。

建议记录操作系统、浏览器、辅助技术版本、实际朗读内容和失败步骤，再决定是否可以对外宣称已完成相应兼容验收。
