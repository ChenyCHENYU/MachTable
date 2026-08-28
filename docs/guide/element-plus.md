# Element Plus 集成

MachTable 与 Element Plus **不冲突**：表格内核独立，EP 负责页面其余组件；通过主题令牌桥接 + 适配器即可浑然一体。适合"用 el-table 卡在数据量/交互上限，但不想换技术栈"的团队。

## 1. 主题桥接（一次配置，全局统一）

EP 的 CSS 变量挂在 `html` 上，直接映射到 `.mach-root`：

```css
/* mach-table-el-bridge.css —— 全局引入一次即可 */
.mach-root {
  --mach-primary: var(--el-color-primary, #409eff);
  --mach-primary-weak: var(--el-color-primary-light-9, #ecf5ff);
  --mach-border-color: var(--el-border-color-lighter, #e4e7ed);
  --mach-row-border-color: var(--el-border-color-extra-light, #f2f6fc);
  --mach-header-bg: var(--el-fill-color-light, #f5f7fa);
  --mach-header-fg: var(--el-text-color-regular, #606266);
  --mach-body-fg: var(--el-text-color-primary, #303133);
  --mach-row-hover-bg: var(--el-fill-color-light, #f5f7fa);
  --mach-row-selected-bg: var(--el-color-primary-light-9, #ecf5ff);
  --mach-zebra-bg: var(--el-fill-color-lighter, #fafafa);
  --mach-scrollbar-thumb: var(--el-border-color, #dcdfe6);
}

/* EP 暗色模式自动同步 */
html.dark .mach-root {
  --mach-border-color: var(--el-border-color-dark, #414243);
  --mach-header-bg: var(--el-fill-color-darker, #1d1d1d);
  --mach-body-bg: transparent;
  --mach-row-hover-bg: var(--el-fill-color-dark, #262727);
  --mach-header-fg: var(--el-text-color-regular, #cfd3dc);
  --mach-body-fg: var(--el-text-color-primary, #e5eaf3);
  color-scheme: dark;
}
```

密度对齐 EP 的 `size`：`size="small"` 表格用 `size: "compact"`、默认用 `"normal"`、large 用 `"large"`。

## 2. 单元格渲染 EP 组件

```ts
import { h } from "vue";
import { ElTag, ElProgress, ElRate } from "element-plus";
import { vueCellRenderer } from "@agile-team/mach-table-vue";

const columns = [
  {
    field: "status",
    headerName: "状态",
    width: 110,
    cellRenderer: vueCellRenderer({
      render: () => h(ElTag, { type: "danger", size: "small", effect: "light" }, () => "故障")
    })
  },
  {
    field: "progress",
    headerName: "进度",
    cellRenderer: vueCellRenderer({
      render: () => h(ElProgress, { percentage: 66, strokeWidth: 8 })
    })
  }
];
```

动态值版本（每次渲染读取最新 params）：

```ts
cellRenderer: (params) => {
  const tagType = params.value === "故障" ? "danger" : "success";
  const host = document.createElement("div");
  createApp({ render: () => h(ElTag, { type: tagType, size: "small" }, () => params.value) }).mount(host);
  return { el: host, destroy: () => setTimeout(() => host.__vue_app__?.unmount(), 0) };
}
```

更简洁的方式：把通用样式注册成渲染器（可序列化，见[渲染器注册表](/recipes/editing)）。

## 3. 富编辑器（el-select / el-date-picker / el-input-number）

```ts
import { createApp, h } from "vue";
import { ElSelect, ElOption, ElDatePicker, ElInputNumber } from "element-plus";

function epEditor(component: any, props: Record<string, any> = {}) {
  return (params: any) => {
    const host = document.createElement("div");
    host.style.width = "100%";
    let value: any = params.value;
    const app = createApp({
      render: () =>
        h(component, {
          ...props,
          modelValue: value,
          "onUpdate:modelValue": (v: any) => (value = v),
          style: { width: "100%" }
        })
    });
    app.mount(host);
    setTimeout(() => host.querySelector("input")?.focus());
    return {
      el: host,
      getValue: () => value,
      destroy: () => app.unmount()
    };
  };
}

// 使用 / 注册
import { registerCellEditor } from "@agile-team/mach-table-vue";
registerCellEditor("ep-select", epEditor(ElSelect));
registerCellEditor("ep-date", epEditor(ElDatePicker, { type: "datetime", valueFormat: "YYYY-MM-DD HH:mm:ss" }));
registerCellEditor("el-input-number" as any, epEditor(ElInputNumber, { min: 0, precision: 2 }));

columnDefs: [
  { field: "level", editable: true, cellEditor: "ep-select" },
  { field: "createdAt", editable: true, cellEditor: "ep-date" }
]
```

::: tip
Enter/Escape/Tab 由 MachTable 统一接管（保存/取消/跳格），EP 组件自身的键盘冲突已被编辑器容器屏蔽。
:::

## 4. 与 el-dialog / el-drawer 共用

```ts
const visible = ref(false);
watch(visible, async (v) => {
  if (v) {
    await nextTick();
    api?.refreshLayout();   // 容器从隐藏变可见后刷新尺寸
  }
});
```

## 5. 混用策略（渐进迁移）

同页面可并存：旧 `el-table` 列表页不动，新需求/数据量超 1 千行的页面用 `RobotGrid`。列描述符映射助手：

```ts
// el-table column → MachTable ColDef
function fromElColumn(c: { prop: string; label: string; width?: number; fixed?: string }) {
  return {
    field: c.prop,
    headerName: c.label,
    width: c.width,
    pinned: c.fixed === "left" ? ("left" as const) : c.fixed === "right" ? ("right" as const) : undefined
  };
}
```

## 6. 不冲突的边界

| 关注点 | 说明 |
| --- | --- |
| 样式作用域 | MachTable 全部样式限定在 `.mach-root` 内，EP 全局变量不受影响 |
| 事件系统 | MachTable 事件仅在表格根元素内，不冒泡污染页面 |
| 暗色模式 | EP 用 `html.dark`，表格桥接 CSS 同步；也可独立加 `mach-theme-dark` 类 |
| 依赖 | core 零依赖，不与 EP 共享任何包版本约束 |
| 适配器上下文 | 在组件 `setup` 内调用适配器工厂会自动继承宿主 appContext（ElConfigProvider 注入随单元格生效）；模块顶层调用可用第二参数 `{ appContext }` 显式指定 |
