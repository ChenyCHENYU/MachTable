# 场景与配置覆盖

Vue 和 React 的 `<MachTable>` 从 0.40 起默认使用 `list`。普通页面只传列和数据，不需要配置文件，也不用再声明 `preset="list"`。同页的小明细表选择 `detail`：

```vue
<!-- 主列表：默认 list -->
<MachTable :column-defs="orderColumns" :row-data="orders" row-key="id" />

<!-- 多张明细表可并排组合，不重复配置表头、分页和高度 -->
<MachTable preset="detail" :column-defs="materialColumns" :row-data="basketA" row-key="id" />
<MachTable preset="detail" :column-defs="materialColumns" :row-data="basketB" row-key="id" />
```

## 两种内置场景

| 场景 | 默认行为 | 页面负责 |
| --- | --- | --- |
| `list` | 序号、分页、列筛选、列设置和列宽调整；排序沿用 Core 默认值 | 明确主表容器高度、业务列和数据 |
| `detail` | 保留序号，默认纯文字表头、只读，无分页/列设置/列宽调整/状态条/右键菜单；按内容收起，表体最多 330px，超过后虚拟滚动 | 业务列和数据，必要时单独覆盖高度或编辑能力 |

`list` 不自动加入复选框、状态条或右键菜单。`detail` 不改写已有排序、筛选和选择状态，也不移除业务显式声明的列。需要编辑的单列仍可设置 `editable: true`；需要业务选择时显式传入 `rowSelection`。只读默认是交互约定，不是权限校验。

场景按用途选择，不根据返回行数自动切换。查询暂时返回空数组、异步加载或记录增减都不会改变场景。`theme`、`size`、斑马纹、边框和 `columnLayout` 与场景分开，同一页面的大表、小表可以共享视觉约定。

## 有统一约定时再配置一次

```ts
// src/config/mach-table.config.ts
import { createMachTablePreset, defineMachTableConfig } from "@agile-team/mach-table-vue";

export default defineMachTableConfig({
  defaults: { theme: "auto", size: "compact", stripedRows: true },
  presets: {
    detail: createMachTablePreset("detail", { maxBodyHeight: 240 })
  }
});
```

React 使用相同 API，只需将包名改为 `@agile-team/mach-table-react`。配置文件只存项目统一差异，不要求为两种场景各写一套完整配置。

**已有同名自定义 preset 完整优先**，不会自动叠加新内置行为。例如 `presets: { list: { stripedRows: true } }` 仍是一份自定义预设。想保留内置能力再改一两项时，明确使用 `createMachTablePreset("list", overrides)` 或 `createMachTablePreset("detail", overrides)`。

需要更多业务组合时继续使用同一机制：

```ts
const config = defineMachTableConfig({
  presets: {
    crud: createMachTablePreset("list", {
      rowSelection: "multiple",
      editType: "fullRow"
    }),
    picker: createMachTablePreset("detail", { rowSelection: "multiple" })
  }
});
```

序号可通过单表 `rowNumber: false` 关闭；分页可通过 `pagination: false` 关闭。列自身的显式配置优先于 `defaultColDef`。

## 安装与局部覆盖

Vue 全局注册可以不传任何配置：

```ts
import { MachTablePlugin } from "@agile-team/mach-table-vue";

app.use(MachTablePlugin);
// 有统一约定时：app.use(MachTablePlugin, machTableConfig);
```

React 直接导入组件即可。需要统一约定时再增加 Provider：

```tsx
<MachTableProvider config={machTableConfig}>
  <App />
</MachTableProvider>
```

个别表格直接覆盖差异：

```vue
<MachTable preset="detail" :max-body-height="180" :column-defs="columns" :row-data="rows" />
```

如果业务确有较多实例选项，用一份 `MachTableVueProps<Row>` 对象通过 Vue 原生 `v-bind` 传入即可，不需要另封装 `AppTable` 或新增配置协议。`rowData`、`columnDefs` 和实例 ref 保持显式，更容易看清数据来源。

## 覆盖优先级

从低到高：

1. 适配器原生基底。
2. 应用与路由/布局合并后的 `defaults`。
3. 选中的 preset：项目同名自定义存在时使用自定义，否则使用内置场景；数组按从左到右合并。
4. 当前表格显式 props。

例如公共 `defaults.columnMenu: true` 会被内置 `detail` 的 `false` 覆盖，单表 `columnMenu: true` 又可覆盖它。主题与密度不在场景里强制指定，继续继承公共 defaults。

`undefined` 表示继承；`false` 是明确关闭。数值仍受各选项的合法范围约束。数组整体替换；`defaultColDef`、`locale`、`components`、`columnTypes`、`pagination`、`statusBar` 和 `watermark` 复用各自的对象合并规则。

## 退出或切换场景

```ts
// 全局退出默认 list，保留应用 defaults。
defineMachTableConfig({ defaultPreset: false });
```

```vue
<!-- 仅当前表格退出，也可用 :preset="[]" -->
<MachTable :preset="false" :column-defs="columns" :row-data="rows" />

<!-- 组合已有业务预设 -->
<MachTable :preset="['list', 'editable']" :column-defs="columns" :row-data="rows" />
```

`detail → list` 或退出场景时，高度、表头工具、分页等场景字段会明确回退，不会遗留上一种场景的开关。切换不会额外清空业务排序、筛选或选择。配置更新仍遵循已有编辑器生命周期：改变 `defaultColDef` 等列结构配置会重建列并取消未提交的编辑草稿；需要切换业务用途时，应先完成业务自己的保存或放弃流程。

未知 preset 会被忽略并触发 `onConfigWarning`，不会被当作内置场景，也不会因名称碰到原型属性而误用其他对象。

## 配置范围与严格检查

`rowData`、`columnDefs`、`datasource`、`loading`、`error`、`initialState` 和 `persistence` 属于每张表，不能放入全局 defaults/preset。共享 `components`、`columnTypes` 使用配置对象顶层专用字段。

默认 `strict: true`，越界配置会抛出带字段名的错误，避免共享业务数据、请求状态或用户偏好身份。需要兼容外部配置时，可设 `strict: false` 并用 `onConfigWarning` 记录被丢弃的字段。`dataProcessor` 在公共配置中必须是每表工厂，不能共享同一个 Worker owner。

路由/布局继续使用已有注入机制：

```ts
provideMachTableConfig(() => ({
  defaults: { theme: tenantStore.dark ? "dark" : "light" }
}));
```

React 对应嵌套 `MachTableProvider`。父级预设的局部定制会保留，不会被子级未声明的内置场景重新覆盖。

## 配置来源诊断

```ts
tableRef.value?.getResolvedConfig();
tableRef.value?.explainOption("maxBodyHeight");
// { source: "built-in preset:detail", value: 330, layers: [...] }
```

自定义预设来源为 `preset:名称`，单表覆盖来源为 `table props`。诊断只用于开发工具和排错，不驱动业务逻辑。

## Core 原生接入

裸 `createGrid()` 保留底层原有默认值，不自动选择适配器场景。希望显式使用同一场景时：

```ts
import { createGrid, createMachTablePreset } from "@agile-team/mach-table";

const api = createGrid<Order>(host, createMachTablePreset<Order>("list", {
  columnDefs: columns,
  rowData: rows,
  rowKey: "id"
}));
```

远程请求与字典加载不放进场景。请求使用现有 `/workflows` 的 [useMachTableQuery](/recipes/remote-query)，HTTP 客户端、接口字段转换及字典生命周期继续由项目管理。
