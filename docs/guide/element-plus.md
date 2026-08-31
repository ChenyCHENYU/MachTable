# Element Plus 集成

MachTable 不依赖 Element Plus；Vue 包提供可选编辑器桥接，由宿主传入已经安装的 EP 组件。因此未使用 EP 的项目零额外体积，使用 EP 的项目可以继承 `ElConfigProvider` 的主题、尺寸与国际化上下文。

## 一次注册常用编辑器

```ts
// mach-table.config.ts
import { h } from "vue";
import {
  ElDatePicker,
  ElInput,
  ElInputNumber,
  ElOption,
  ElSelect
} from "element-plus";
import {
  defineMachTableConfig
} from "@agile-team/mach-table-vue";
import { createElementPlusEditors } from "@agile-team/mach-table-vue/editors";

const ep = createElementPlusEditors(
  {
    input: ElInput,
    inputNumber: ElInputNumber,
    select: ElSelect,
    datePicker: ElDatePicker
  },
  {
    select: {
      children: ({ params }) =>
        (params.colDef.cellEditorParams?.values ?? []).map((item: any) =>
          h(ElOption, {
            label: typeof item === "object" ? item.label : item,
            value: typeof item === "object" ? item.value : item
          })
        )
    },
    date: {
      props: { type: "date", valueFormat: "YYYY-MM-DD", teleported: true }
    }
  }
);

export default defineMachTableConfig({
  components: {
    cellEditors: {
      "ep-input": ep.input!,
      "ep-number": ep.number!,
      "ep-select": ep.select!,
      "ep-date": ep.date!
    }
  }
});
```

页面只声明编辑器名称，不再重复创建/销毁 Vue App：

```ts
const columns: ColDef<Order>[] = [
  { field: "customer", editable: true, cellEditor: "ep-input" },
  { field: "amount", editable: true, cellEditor: "ep-number" },
  {
    field: "status",
    editable: true,
    cellEditor: "ep-select",
    cellEditorParams: {
      values: [
        { label: "待处理", value: "pending" },
        { label: "已完成", value: "done" }
      ]
    }
  },
  { field: "deliveryDate", editable: true, cellEditor: "ep-date" }
];
```

编辑器桥接统一处理 `modelValue`、`update:modelValue`、初始聚焦、宽度和销毁。Enter/Escape/Tab 仍由表格编辑事务管理。配置文件在模块顶层执行时，编辑器使用独立 Vue 根；如需继承页面级 `ElConfigProvider` 注入，请在组件 `setup()` 中创建工厂，或通过编辑器选项显式传入 `appContext`。

## 任意 Vue 组件

非 Element Plus 组件使用同一个通用工厂：

```ts
import { vueCellEditor } from "@agile-team/mach-table-vue/editors";

const currencyEditor = vueCellEditor(CurrencyInput, {
  props: ({ data }) => ({ currency: data.currency }),
  focusSelector: "input",
  className: "order-currency-editor"
});
```

组件不是标准 `modelValue` 协议时可设置 `valueProp` 和 `updateEvent`。

## 渲染 EP 组件

```ts
import { h } from "vue";
import { ElTag } from "element-plus";
import { vueCellRenderer } from "@agile-team/mach-table-vue/adapters";

const StatusTag = {
  props: ["value"],
  setup: (props: any) => () =>
    h(ElTag, { type: props.value === "done" ? "success" : "warning", size: "small" }, () => props.value)
};

const statusColumn = {
  field: "status",
  cellRenderer: vueCellRenderer(StatusTag)
};
```

在组件 `setup()` 中创建适配器会自动捕获宿主 `appContext`；在模块顶层创建时可显式传 `{ appContext }`。

## 主题桥接

全局引入一次：

```css
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
}

html.dark .mach-root {
  --mach-border-color: var(--el-border-color-dark, #414243);
  --mach-header-bg: var(--el-fill-color-darker, #1d1d1d);
  --mach-body-fg: var(--el-text-color-primary, #e5eaf3);
  --mach-row-hover-bg: var(--el-fill-color-dark, #262727);
  color-scheme: dark;
}
```

EP `size="small"` 可对应表格 `size: "compact"`，默认对应 `normal`，大尺寸对应 `large`。

## Dialog / Drawer 中使用

隐藏容器变为可见后刷新一次布局：

```ts
watch(visible, async (value) => {
  if (!value) return;
  await nextTick();
  table.api.value?.view.refreshLayout();
});
```

## 保存闭环

EP 编辑器只负责输入，提交仍使用 MachTable 的事务 API：

```ts
const editing = useMachTableEditing(table.api, {
  save: (changes, { signal }) => orderApi.saveChanges(changes, { signal }),
  beforeUnload: true
});

await editing.save();
editing.rollback();
```

这样单元格编辑、整行编辑、异步校验、部分成功、并发保存和离页保护使用同一套规则，不会因 UI 库不同形成多套业务状态。
