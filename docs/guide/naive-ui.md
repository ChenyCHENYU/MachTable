# Naive UI 集成

Naive UI 的主题体系基于 `n-config-provider` 注入的运行时主题（`--n-*` 变量作用在组件子树），与 MachTable 集成同样零冲突。

## 1. 主题桥接

方式 A：CSS 变量映射（Naive 的 CSS 变量可直接在模板内引用）：

```css
.mach-root {
  --mach-primary: var(--n-color-target, var(--n-primary-color, #18a058));
  --mach-primary-weak: var(--n-color-hover, #36ad6a1a);
  --mach-border-color: var(--n-border-color, #efeff5);
  --mach-header-bg: var(--n-color-embedded, #fafafc);
  --mach-header-fg: var(--n-text-color-2, rgba(0, 0, 0, 0.66));
  --mach-body-fg: var(--n-text-color-1, rgba(0, 0, 0, 0.9));
  --mach-row-hover-bg: var(--n-color-hover, rgba(0, 0, 0, 0.03));
}
```

方式 B（推荐）：直接读取 Naive 的 `themeVars` 注入 CSS 变量：

```vue
<script setup lang="ts">
import { darkTheme, useThemeVars } from "naive-ui";
const vars = useThemeVars();
const cssVars = computed(() => ({
  "--mach-primary": vars.value.primaryColor,
  "--mach-primary-weak": vars.value.primaryColorHover + "22",
  "--mach-border-color": vars.value.borderColor,
  "--mach-header-bg": vars.value.bodyColor,
  "--mach-header-fg": vars.value.textColor2,
  "--mach-body-fg": vars.value.textColor1,
  "--mach-row-hover-bg": vars.value.hoverColor,
  "--mach-row-selected-bg": vars.value.primaryColorHover + "22"
}));
</script>

<template>
  <n-config-provider :theme="isDark ? darkTheme : undefined">
    <RobotGrid :style="cssVars" ... />
  </n-config-provider>
</template>
```

方式 B 的好处：完全跟随 `n-config-provider` 的主题切换（亮/暗/自定义 brand），无需写两套 CSS。

## 2. 单元格渲染 Naive 组件

```ts
import { h } from "vue";
import { NTag, NBadge, NButton, NEllipsis } from "naive-ui";
import { vueCellRenderer } from "@agile-team/mach-table-vue";

const columns = [
  {
    field: "status",
    headerName: "状态",
    width: 110,
    cellRenderer: vueCellRenderer({
      render: () => h(NTag, { type: "warning", size: "small", bordered: false }, () => "待机")
    })
  },
  {
    field: "desc",
    headerName: "描述",
    cellRenderer: vueCellRenderer({
      render: () => h(NEllipsis, { style: "max-width: 100%" }, { default: () => "很长的描述文本…" })
    })
  },
  {
    field: "op",
    headerName: "操作",
    cellRenderer: (params) => {
      // 操作列：原生按钮即可，或挂 NButton
      const btn = document.createElement("button");
      btn.className = "mach-context-menu-item";
      btn.textContent = "编辑";
      btn.onclick = () => openEdit(params.rowNode.id);
      return btn;
    }
  }
];
```

## 3. 富编辑器（n-select / n-date-picker）

```ts
import { createApp, h } from "vue";
import { NSelect, NDatePicker } from "naive-ui";

function naiveEditor(component: any, props: Record<string, any> = {}) {
  return (params: any) => {
    const host = document.createElement("div");
    host.style.width = "100%";
    let value: any = params.value;
    const app = createApp({
      render: () =>
        h(component, {
          ...props,
          value,
          "onUpdate:value": (v: any) => (value = v),
          size: "small",
          style: { width: "100%" }
        })
    });
    app.mount(host);
    setTimeout(() => host.querySelector("input")?.focus());
    return { el: host, getValue: () => value, destroy: () => app.unmount() };
  };
}

import { registerCellEditor } from "@agile-team/mach-table-vue";
registerCellEditor("n-select", naiveEditor(NSelect));
registerCellEditor("n-date", naiveEditor(NDatePicker, { type: "datetime" }));
```

## 4. 组件库级集成（给 @robot-admin/naive-ui-components 加表格能力）

你的组件库可以直接把 MachTable 作为新的渲染引擎集成，与现有 VTable 方案共存互补（VTable canvas 适合只读大屏可视化，MachTable DOM 适合强交互业务表格）。推荐路径：**新增 `C_Grid` 组件或给现有表格加 `renderType: "machTable"`，内部做一次列描述符映射**：

```ts
// 组件库内部：TableColumnDesc → MachTable ColDef 适配器
import { RobotGrid, vueCellRenderer, type ColDef } from "@agile-team/mach-table-vue";

function descToColDef(desc: TableColumnDesc): ColDef<any> {
  return {
    colId: desc.name,
    field: desc.name,
    headerName: desc.label,
    width: desc.width,
    minWidth: desc.minWidth,
    pinned: desc.fixed === "left" ? "left" : desc.fixed === "right" ? "right" : undefined,
    align: desc.align,
    editable: !!desc.editComponent,
    cellEditor: desc.editComponent ? wrapEditor(desc.editComponent) : undefined,
    valueFormatter: desc.formatter,
    cellStyle: desc.cellStyle,
    rowGroup: desc.rowGroup,
    aggFunc: desc.aggFunc,
    selectable: desc.selectable,
    hide: !desc.show,
    // cellRenderer: desc.renderType ? vueCellRenderer(resolve(desc.renderType)) : undefined
  };
}
```

映射后 `getSelection / setSelection / getVisibleSelection / deselectAll / setSortModel` 等语义在两侧一一对应，业务代码几乎无感切换。集成要点：

| 关注点 | 结论 |
| --- | --- |
| 主题 | `useThemeVars()` 直读 naive 令牌（见上文方式 B），或 CSS 变量桥接；`theme: "auto"` 可跟随系统 |
| 弹层 z-index | 组件库若有全局弹层管理，覆写 `--mach-z-popup/--mach-z-menu` 对齐层级 |
| 依赖 | core 零依赖、vue 包 peer vue≥3.2，不与组件库任何包冲突；构建体系同源（tsdown） |
| 渐进推广 | 新页面用 `C_Grid`，旧 VTable 表格不动；两套可同页共存 |

## 5. 与 @robot-admin/naive-ui-components 配合（定位说明）

- 只读大数据可视化大屏 → 组件库现有方案
- 强交互业务表格（编辑/校验/框选/明细）→ MachTable
- 组件库可新增 `C_Grid` 或给表格组件加 `renderType: "machTable"`，内部做一次描述符映射委托 MachTable 渲染，复用其 `TableColumnDesc` 体系

## 6. 边界说明

| 关注点 | 说明 |
| --- | --- |
| 样式作用域 | `.mach-root` 封闭，不影响 Naive 组件 |
| 暗色模式 | 跟随 `n-config-provider`（方式 B）或独立 `mach-theme-dark` 类 |
| 适配器上下文 | 在组件 `setup` 内调用适配器工厂会自动继承宿主 appContext（ConfigProvider 注入随单元格生效）；在模块顶层调用时可显式传 `{ appContext }` |
| 依赖 | 互不依赖，无版本冲突 |
