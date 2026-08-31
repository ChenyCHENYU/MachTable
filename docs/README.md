---
home: true
title: MachTable 马赫表格
hero:
  name: MachTable
  text: 超音速渲染的数据表格
  tagline: 高性能 · 零依赖 · 跨框架 —— 行/列双虚拟化，10 万行 × 100 列流畅滚动
  image:
    src: /mach-table-mark.svg
    alt: MachTable logo
  actions:
    - theme: brand
      text: 快速开始 →
      link: /guide/getting-started
    - theme: alt
      text: 概述与场景
      link: /guide/overview
    - theme: alt
      text: API 参考
      link: /api/grid-options
features:
  - icon: ⚡
    title: 极致性能
    details: 行/列双虚拟化、行池复用、前缀和变高定位、rAF 合帧滚动、异步事务合批。内核零运行时依赖，并有 10 万行 × 100 列性能门禁。
  - icon: 🧩
    title: 全能交互
    details: 选择、异步校验编辑、脏数据保存回滚、框选复制粘贴填充、分组聚合、树形、主从明细、可恢复无限滚动。
  - icon: 🎨
    title: 精致视觉
    details: CSS 变量主题（浅/深色）、三档密度、斑马纹、tabular-nums 数字对齐，两行代码桥接 Element Plus / Naive UI。
  - icon: 🛠
    title: 工程化
    details: TypeScript 字段路径类型、版本化状态、稳定错误码与诊断、i18n、Schema、CSV 防注入、消费端契约与 CI 发布流。
footer: Source-available · Prior written authorization required | MachTable v0.24.0
---

## 30 秒上手

```ts
import "@agile-team/mach-table/styles/mach-table.css";
import { createGrid } from "@agile-team/mach-table";

const api = createGrid(document.getElementById("grid")!, {
  columnDefs: [
    { colId: "sel", headerName: "", width: 46, checkboxSelection: true },
    { field: "name", headerName: "名称", editable: true, filter: "text" },
    { field: "amount", headerName: "金额", aggFunc: "sum", type: "rightAligned" }
  ],
  rowData,
  rowSelection: "multiple",
  rowKey: "id"
});
```

## 文档导航

| 板块 | 内容 |
| --- | --- |
| [指南](/guide/overview) | 概述、快速开始、React / Vue、EP / Naive 集成 |
| [API 参考](/api/grid-options) | GridOptions、ColDef、事件、8 个领域 API 与 0.x 平面兼容接口 |
| [场景配方](/recipes/controller-toolbar) | 21 个高频业务场景的可复制代码 |
| [进阶](/advanced/theming) | 主题定制、性能调优、i18n、架构、路线图 |
