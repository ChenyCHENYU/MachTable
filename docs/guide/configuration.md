# 配置中心与覆盖规则

大型 B 端项目应把稳定的表格约定放在一个配置文件中。应用入口只负责安装插件，页面只描述当前业务数据和列，避免在 `main.ts` 或数百个页面中重复默认值。

## 推荐目录

```text
src/
├─ config/
│  └─ mach-table.config.ts   # 唯一表格配置中心
├─ main.ts                   # 一行安装
└─ views/                    # 页面按需覆盖
```

## 完整配置文件

```ts
// src/config/mach-table.config.ts
import {
  defineMachTableConfig,
  defineMachTablePreset
} from "@agile-team/mach-table-vue";

export default defineMachTableConfig({
  /** 每张表都继承的稳定约定；不要放 rowData、columnDefs 等页面状态。 */
  defaults: {
    size: "compact",
    theme: "auto",
    stripedRows: true,
    columnMenu: true,
    pagination: {
      pageSize: 20,
      pageSizeOptions: [20, 50, 100, 200],
      showTotal: true,
      showPageSizeSelector: true
    },
    defaultColDef: {
      minWidth: 100,
      sortable: true,
      resizable: true,
      movable: true,
      filter: true
    },
    onGridError: ({ code, error, source }) => {
      telemetry.captureException(error, { tags: { code, source } });
    }
  },

  /** 未传 preset 的表默认采用 list。传 preset=false 可对单表禁用。 */
  defaultPreset: "list",

  /** 预设只表达表格行为，主题、语言、密度仍放在 defaults。 */
  presets: {
    list: defineMachTablePreset({
      rowSelection: "none",
      contextMenu: true
    }),
    crud: defineMachTablePreset({
      rowSelection: "multiple",
      editType: "fullRow",
      editableIndicator: "hover",
      enableRangeSelection: true,
      statusBar: true
    }),
    picker: defineMachTablePreset({
      rowSelection: "multiple",
      pagination: { pageSize: 10, pageSizeOptions: [10, 20, 50] }
    }),
    tree: defineMachTablePreset({
      treeData: true,
      defaultExpandAll: false
    })
  },

  /** 页面通过 type: "money" 使用，列本身仍可覆盖其中任何字段。 */
  columnTypes: {
    money: {
      align: "right",
      filter: "number",
      cellEditor: "number",
      valueFormatter: ({ value }) =>
        value == null ? "" : `¥${Number(value).toLocaleString()}`
    },
    status: {
      filter: "set",
      cellRenderer: "statusTag"
    },
    readonly: { editable: false }
  },

  /** 未知 preset 等非致命配置错误可统一进入监控。 */
  onConfigWarning: (warning) => telemetry.captureMessage(warning.message)
});
```

应用入口保持清爽：

```ts
import { createApp } from "vue";
import AsyncMachTablePlugin from "@agile-team/mach-table-vue/async";
import "@agile-team/mach-table-vue/styles.css";
import App from "./App.vue";
import machTableConfig from "@/config/mach-table.config";

createApp(App).use(AsyncMachTablePlugin, machTableConfig).mount("#app");
```

页面只保留业务信息：

```vue
<MachTable
  preset="crud"
  :column-defs="columns"
  :row-data="rows"
  :get-row-id="({ data }) => data.orderId"
/>
```

## 覆盖优先级

从低到高依次为：

1. MachTable 内置默认值。
2. `app.use()` 应用配置。
3. `provideMachTableConfig()` 路由或布局配置。
4. 当前表选择的命名 `preset`。
5. 当前 `<MachTable>` 的显式 props。

`undefined` 表示继承；`false`、`0` 和空字符串都是有效覆盖值。数组整体替换。`defaultColDef`、`locale`、`components`、`columnTypes`、`pagination`、`statusBar` 和 `watermark` 使用各自明确的对象合并规则。全局和路由事件处理器会依次执行。

## 路由和租户级动态配置

配置源可以是对象、ref 或 getter。getter 中读取的 Vue 状态变化后，后代表格会原子更新：

```ts
const tenantTheme = computed(() => tenantStore.dark ? "dark" : "light");

provideMachTableConfig(() => ({
  defaults: {
    theme: tenantTheme.value,
    pagination: { pageSize: route.meta.tablePageSize ?? 20 }
  }
}));
```

只需要默认值时仍可使用兼容 API：

```ts
provideMachTableDefaults(() => ({ size: compact.value ? "compact" : "normal" }));
```

## 多预设组合与禁用

```vue
<!-- 从左到右合并，editable 覆盖 list 的同名字段 -->
<MachTable :preset="['list', 'editable']" />

<!-- 不使用 defaultPreset，但仍继承应用 defaults -->
<MachTable :preset="false" />
```

未知预设不会让生产页面白屏，而是忽略该预设并触发 `onConfigWarning`。

## 配置来源诊断

组件实例暴露最终输入配置和来源解释，适合开发工具和排错：

```ts
tableRef.value?.getResolvedConfig();
tableRef.value?.explainOption("pagination");
// { source: "preset:crud", layers: [...], value: ... }
```

这能回答“为什么这张表是 50 条一页”“是谁关闭了过滤”等企业项目中很常见的问题。
