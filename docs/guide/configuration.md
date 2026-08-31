# 配置中心与覆盖规则

大型 B 端项目应把稳定的表格约定放在一个专用配置文件中。应用入口只负责安装；页面只描述当前业务数据、列和实例身份。

```text
src/
├─ config/
│  └─ mach-table.config.ts
├─ main.ts
└─ views/
```

## 推荐配置

```ts
// src/config/mach-table.config.ts
import {
  createBusinessColumnTypes,
  defineMachTableConfig,
  defineMachTablePreset
} from "@agile-team/mach-table-vue";

export default defineMachTableConfig({
  /** 稳定、无实例身份的应用约定。 */
  defaults: {
    size: "compact",
    theme: "auto",
    columnLayout: "fit",
    enableColumnResize: true,
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

  defaultPreset: "list",

  presets: {
    list: defineMachTablePreset({ contextMenu: true }),
    crud: defineMachTablePreset({
      rowSelection: "multiple",
      editType: "fullRow",
      enableRangeSelection: true,
      statusBar: true
    }),
    picker: defineMachTablePreset({
      rowSelection: "multiple",
      pagination: { pageSize: 10, pageSizeOptions: [10, 20, 50] }
    }),
    tree: defineMachTablePreset({ treeData: true, defaultExpandAll: false })
  },

  /** 使用 colDef.type: "money" 等语义名称。 */
  columnTypes: createBusinessColumnTypes({
    locale: "zh-CN",
    currency: "CNY",
    timeZone: "Asia/Shanghai"
  }),

  /** 应用级 renderer/editor 名称，可被单表 components 覆盖。 */
  components: {
    statusTag: StatusTagRenderer
  },

  onConfigWarning: (warning) => telemetry.captureMessage(warning.message)
});
```

## 哪些内容不能放进 defaults/preset

配置中心默认 `strict: true`。以下实例级字段放入 `defaults` 或 `presets` 会直接抛出带字段名的错误：

- `rowData`、`columnDefs`、`datasource`
- `loading`、`error`
- `initialState`、`persistence`
- `components`、`columnTypes`（应使用配置对象的顶层专用字段）

这样能防止跨页面数据、请求状态、用户偏好 key 或组件注册被意外共享。只有兼容外部低代码配置时才考虑 `strict: false`；此时非法字段会被丢弃并通过 `onConfigWarning` 上报，绝不会静默进入表格。

```ts
defineMachTableConfig({
  strict: false,
  onConfigWarning: reportConfigWarning,
  defaults: externalDefaults
});
```

## 安装

Vue：

```ts
import { MachTablePlugin } from "@agile-team/mach-table-vue";
import machTableConfig from "@/config/mach-table.config";

app.use(MachTablePlugin, machTableConfig);
```

React：

```tsx
import { MachTableProvider } from "@agile-team/mach-table-react";
import machTableConfig from "@/config/mach-table.config";

root.render(
  <MachTableProvider config={machTableConfig}>
    <App />
  </MachTableProvider>
);
```

页面保持业务化：

```vue
<MachTable
  preset="crud"
  :column-defs="columns"
  :row-data="rows"
  row-key="orderId"
  :persistence="{ key: `${tenantId}:${userId}:orders` }"
/>
```

## 覆盖优先级

从低到高：

1. MachTable 内置默认值。
2. 应用 `defaults`。
3. 路由/布局 scoped 配置。
4. 选中的命名 `preset`（数组按从左到右合并）。
5. 当前 `<MachTable>` 显式 props。

`undefined` 表示继承；`false`、`0` 和空字符串是有效覆盖值。数组整体替换；`defaultColDef`、`locale`、`components`、`columnTypes`、`pagination`、`statusBar` 和 `watermark` 采用各自的对象合并规则。

```vue
<!-- editable 覆盖 list 中的同名字段 -->
<MachTable :preset="['list', 'editable']" />

<!-- 不使用 defaultPreset，但仍继承应用 defaults -->
<MachTable :preset="false" />
```

未知 preset 会被忽略并触发 `onConfigWarning`，不会让生产页面白屏。

## Vue 路由/布局响应式配置

```ts
provideMachTableConfig(() => ({
  defaults: {
    theme: tenantStore.dark ? "dark" : "light",
    pagination: { pageSize: route.meta.tablePageSize ?? 20 }
  }
}));
```

该配置与父级合并，来源变化后适配器原子更新表格。只有一套 `provideMachTableConfig()`，不再维护重复的 defaults 注入 API。

## React 路由配置

按路由再嵌套一层 Provider：

```tsx
const routeConfig = useMemo(() => ({
  defaults: { theme: dark ? "dark" : "light" }
}), [dark]);

<MachTableProvider config={routeConfig}>
  <OrdersPage />
</MachTableProvider>
```

## 配置来源诊断

Vue 组件实例可解释任意配置来自哪一层：

```ts
tableRef.value?.getResolvedConfig();
tableRef.value?.explainOption("pagination");
// { source: "preset:crud", layers: [...], value: ... }
```

Core/React 可通过已解析配置和 `api.getOption()` 查看当前值。配置解释只用于开发工具和排错，不应驱动业务逻辑。

远程请求不要放进配置中心；使用适配包 `/workflows` 的 [`useMachTableQuery`](/recipes/remote-query)，让查询参数、请求取消和页面状态保持在业务路由内。
