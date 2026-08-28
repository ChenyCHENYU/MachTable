# 版本升级指南

## 版本策略

MachTable 当前处于 `0.x`。三个包固定版本联动：

- patch：兼容性修复和文档改进；
- minor：新能力，也可能包含经过说明的破坏性调整；
- `1.0.0`：公共 API 和兼容策略稳定后再发布。

从 `0.4.1` 起，Vue/React 适配器会自动安装匹配版本的 Core；框架项目只需升级自己的适配包。

```bash
pnpm up @agile-team/mach-table-vue@^0.9.0
```

如果框架项目没有直接使用 Core 包路径，升级后可以移除原来的显式依赖：

```bash
pnpm remove @agile-team/mach-table
```

原有 Core import 和 CSS 路径继续兼容；新代码推荐统一从适配包导入 API、类型及 `styles.css`，从而保持真正的单包接入。

## 0.5 → 0.9

0.9 保留既有 API，并把 `MachTable` 设为规范组件名。`RobotGrid` 和对应 Props 类型仍可用，但已标注 deprecated，建议在 1.0 前完成替换。

新增能力均为 opt-in 或兼容默认值：

- Vue 插件支持 `defaults`，并新增 `provideMachTableDefaults`；异步插件支持加载/错误组件、超时和重试回调。
- React 新增 `MachTableProvider`；默认组件导出仍支持 `React.lazy`。
- `validate` 可返回 Promise；命令式调用可改为 `await api.stopEditingAsync()`。
- 新增 `GridState`、脏数据/保存/回滚、异步事务、数据源重试、诊断快照和稳定错误码。
- Tree/group 角色现在使用 `treegrid`；若 E2E 写死 `getByRole("grid")`，请按实际模式改成 `grid` 或 `treegrid`。

`onGridError` 载荷新增必填 `code` 字段，不影响只解构旧字段的代码。监控聚合建议从易变的 `source` 迁移到稳定 `code`。

## 0.4 → 0.5

`0.5.0` 新增加载能力，不会破坏已有局部导入：

- Vue 可选 `MachTablePlugin` 全局同步注入。
- Vue 可从 `@agile-team/mach-table-vue/async` 使用全局异步注入和 `preloadMachTable()`。
- React 根入口新增默认组件导出，可直接交给 `React.lazy`。
- 局部 `import { MachTable }`、原 Core API 和既有样式路径继续兼容。

## 标准升级流程

1. 阅读 Core 与适配器的 `CHANGELOG.md`。
2. 在独立分支升级并提交 lockfile。
3. 执行类型检查、单元测试和表格业务 E2E。
4. 验证选择、编辑、导出、列状态、弹窗布局和服务端数据源。
5. 灰度发布；保留上一 lockfile/制品作为回滚点。

## 0.3 → 0.4

### 包名迁移

| 旧名称 | 0.4 正式名称 |
| --- | --- |
| `@mach-table/core` | `@agile-team/mach-table` |
| `@mach-table/vue` | `@agile-team/mach-table-vue` |
| `@mach-table/react` | `@agile-team/mach-table-react` |

替换依赖和 import，并重新生成 lockfile。

### Overlay 安全默认值

自定义 Overlay 的字符串现在按纯文本渲染：

```ts
overlayNoRowsTemplate: "<strong>暂无数据</strong>" // 显示为文本，不再解释 HTML
```

推荐改为 DOM 工厂：

```ts
overlayNoRowsTemplate: () => {
  const message = document.createElement("strong");
  message.textContent = "暂无数据";
  return message;
}
```

只有完全可信的静态 HTML 才可临时设置 `allowUnsafeOverlayHtml: true`。

### 适配器更新

- Vue/React 现在同步全部 GridOptions，运行时变化不再遗漏数据源、列默认值、树形、Feature 等选项。
- `gridClassName` 会响应式更新内部 `.mach-root`。
- Vue `useMachTable` 和 React `useMachGrid` 在卸载后正确清空 API 状态。
- 同一批次同时更新数据源与结构选项只触发一次数据加载。

### 扩展机制

新增实例级 `components` 和 `features`。业务扩展应优先使用 `GridFeature` 组合，不要继承内部 Service 或修改 `GridCore`。

## 列状态迁移

如果升级同时改变了 `colId`、固定列或分组结构，应升级 `columnStateKey` 的版本后缀：

```ts
columnStateKey: "orders-v2"
```

这比尝试兼容所有旧状态更可靠。

## 回滚

回滚必须同时回滚三个包和 lockfile。若新版本已经写入新的列状态 key，旧版本继续使用旧 key，不要复用不兼容状态。
