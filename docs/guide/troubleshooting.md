# 排错手册

## 快速诊断表

| 现象 | 常见原因 | 处理 |
| --- | --- | --- |
| 页面空白，没有报错 | 容器或父级高度为 0 | 给容器明确 `height/min-height`，检查 flex 链路 |
| 有结构但没有样式 | 未引入 Core CSS | 全局引入 `@agile-team/mach-table/styles/mach-table.css` |
| 弹窗首次打开列宽为 0 | 隐藏状态下完成初次测量 | 弹窗可见后的 nextTick/effect 调 `api.refreshLayout()` |
| `pnpm add` 返回 404 | registry 不正确或企业镜像未同步 scope | 检查 `pnpm config get registry` 与 `.npmrc` scope 配置 |
| Vue prop 不生效 | 模板未使用 kebab-case 或名称错误 | `stripedRows` 对应 `striped-rows`，查 GridOptions |
| 更新数据后选择丢失 | 没有稳定 `getRowId` | 使用数据库主键/业务唯一键 |
| 行重复或事务异常 | `getRowId` 返回重复值 | 保持全数据集唯一，开发环境不要抑制警告 |
| React 频繁重建或更新 | 每次 render 创建新列/对象配置 | 用 `useMemo` 稳定引用 |
| 富单元格滚动后内存增加 | 自定义 renderer 未清理框架实例 | 返回 `{ el, destroy }`，在 destroy 中 unmount |
| 无限加载重复/竞态 | HTTP 请求未使用传入的 `signal` | 将 `AbortSignal` 传给 fetch/axios |
| 复制粘贴没有反应 | 浏览器权限、非安全上下文或 `suppressClipboard` | 使用 HTTPS/localhost 并检查配置与权限 |
| Safari E2E 偶发超时 | 多个重型浏览器实例并发过高 | 降低 Playwright workers，保留真实超时而非盲目重试 |
| 暗色主题没有切换 | 宿主覆盖 CSS 变量或 class 作用位置错误 | 用 `theme="dark"`，内部类使用 `gridClassName` |

## 安装与版本

确认实际解析到的版本：

```bash
pnpm why @agile-team/mach-table
pnpm list @agile-team/mach-table @agile-team/mach-table-vue
```

Core 与适配器应保持同一 minor。删除 lockfile 不是常规修复手段；先检查重复版本和 workspace override。

## 获取 GridApi

Vue：

```ts
const grid = useMachTable<Row>();
grid.api.value?.refreshLayout();
```

React：

```ts
const grid = useMachGrid<Row>();
grid.api?.refreshLayout();
```

挂载前 API 为 `null` 是正常状态。不要在组件 render/setup 同步阶段强制解引用。

## 开启错误观测

```ts
onGridError: ({ error, source, context }) => {
  console.error("[MachTable]", source, error, context);
}
```

排查时不要开启 `suppressWarnings`。问题报告至少包含：MachTable/Core/框架版本、浏览器、最小列定义、数据规模、是否在弹窗/SSR，以及 `gridError` 的 source/context。

## 样式冲突

MachTable 样式限定在 `.mach-root` 下。若宿主仍覆盖表格：

1. 在 DevTools 查看命中的全局 `button/input/div` 规则；
2. 避免使用高优先级通配样式或 `!important`；
3. 通过 CSS 变量做主题，不要复制整份内置 CSS；
4. 检查 CSS 是否被构建工具错误 tree-shake。

## 最小复现

从以下配置开始逐项加回业务能力：

```ts
const options = {
  columnDefs: [{ field: "name", headerName: "Name" }],
  rowData: [{ id: "1", name: "Test" }],
  getRowId: ({ data }: { data: { id: string } }) => data.id
};
```

如果最小配置正常，问题通常位于自定义 renderer/editor、容器布局或业务数据源。仍无法定位时提交 [GitHub Issue](https://github.com/ChenyCHENYU/MachTable/issues)。
