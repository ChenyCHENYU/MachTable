# 可访问性与键盘规范

MachTable 0.14 按 WAI-ARIA Grid / Treegrid 交互模型实现语义和键盘基础。业务仍需为页面提供清晰标题、操作说明、颜色对比和可访问的自定义 renderer/editor。

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
| 表头 | Alt+左右方向 | 调整列宽 |
| 表头 | Ctrl+左右方向 | 移动列 |

设置 `suppressCellFocus` 或 `suppressHeaderFocus` 会关闭对应键盘入口，只应用在确有替代交互的只读展示场景。

## 自定义内容责任

- 交互控件必须使用原生 `button` / `input` 或提供等价角色、名称和键盘行为；
- 不要只用颜色表达状态；状态标签同时渲染文本；
- 异步编辑校验应返回明确错误字符串；MachTable 会设置 `aria-invalid`、`aria-busy` 并把焦点留在编辑器；
- 自定义 detail/renderer 的 tab 顺序由组件作者负责。

## 自动化验收

仓库在 Chromium、Firefox、WebKit 验证角色、活动单元格、方向键、编辑与过滤弹层生命周期。业务 E2E 至少补一条真实列模型的键盘路径，并在目标读屏软件上做人工抽查。
