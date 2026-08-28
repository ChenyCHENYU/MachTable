# Contributing to MachTable

感谢你帮助 MachTable 变得更可靠。提交前请先搜索已有 Issue；较大的 API 或架构变化建议先创建讨论，避免实现方向与项目边界冲突。

## 开发环境

- Node.js `>= 22.22.2`
- pnpm `11.8.0`

```bash
pnpm install
pnpm verify
pnpm exec playwright install chromium firefox webkit
pnpm test:e2e
```

## 架构约束

- Core 保持零运行时依赖。
- 新 GridOptions 必须登记到 `GRID_OPTION_META`，保证 Core、Vue、React 同步。
- 状态型能力使用带 `destroy` 的 Service；纯算法放入 `lib/` 或独立状态模型。
- 可选业务能力优先实现为 `GridFeature`，不要通过继承修改 `GridCore`。
- DOM、全局监听器、定时器、框架 root 和异步请求必须有清理路径。
- 用户输入不得直接写入 `innerHTML`；安全默认值不能为了兼容而静默放宽。

详细设计见 [`docs/advanced/architecture.md`](./docs/advanced/architecture.md)。

## 测试要求

- 修复缺陷必须先补能复现问题的回归测试。
- 纯逻辑优先单元测试；DOM 生命周期使用 jsdom；框架行为放在对应适配器测试。
- 影响真实集成、焦点或浏览器兼容性的变化应更新 Playwright 用例。
- 不允许通过降低覆盖率阈值、扩大体积预算或增加盲目重试掩盖回归。

## 提交与变更记录

提交信息建议使用 Conventional Commits，例如：

```text
fix(core): clean row drag listeners after pointer up
feat(vue): expose reactive grid lifecycle composable
docs: add enterprise integration guide
```

影响发布包的变更需要 Changeset：

```bash
pnpm changeset
```

三个发布包采用 fixed 版本联动。`0.x` 阶段破坏性变化使用 minor，并必须提供升级说明。

## Pull Request 清单

- [ ] 改动范围单一且说明了原因
- [ ] 新行为有测试
- [ ] `pnpm verify` 通过
- [ ] 必要时 `pnpm test:e2e` 通过
- [ ] 公共 API、文档、示例和 Changeset 已同步
- [ ] 未提交 token、凭证、内部地址或业务数据
