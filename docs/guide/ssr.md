# SSR、Nuxt 与 Next.js

MachTable 的包可以在 SSR 工程中导入，但真正创建 Grid 必须发生在浏览器挂载阶段。Vue/React 官方适配器已经把 `createGrid` 放在挂载生命周期中；服务端不要直接调用原生 `createGrid()`。

## Nuxt 3

全局引入样式：

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  css: ["@agile-team/mach-table/styles/mach-table.css"]
});
```

页面使用客户端边界：

```vue
<script setup lang="ts">
import { MachTable } from "@agile-team/mach-table-vue";
import type { ColDef } from "@agile-team/mach-table";

interface Row { id: string; name: string }
const rows: Row[] = [{ id: "1", name: "MachTable" }];
const columns: ColDef<Row>[] = [{ field: "name", headerName: "名称", flex: 1 }];
</script>

<template>
  <ClientOnly>
    <div style="height: 520px">
      <MachTable :row-data="rows" :column-defs="columns" :get-row-id="({ data }) => data.id" />
    </div>
    <template #fallback>正在加载表格…</template>
  </ClientOnly>
</template>
```

如果表格初次挂载在隐藏 Tab 或弹窗中，在其可见后的 `nextTick` 调用 `api.refreshLayout()`。

## Next.js App Router

在根布局引入 CSS：

```tsx
// app/layout.tsx
import "@agile-team/mach-table/styles/mach-table.css";
import type { ReactNode } from "react";

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
```

Grid 组件必须是 Client Component：

```tsx
// components/OrdersGrid.tsx
"use client";

import { useMemo } from "react";
import { MachTable } from "@agile-team/mach-table-react";
import type { ColDef } from "@agile-team/mach-table";

interface Order { id: string; customer: string }

export function OrdersGrid({ rows }: { rows: Order[] }) {
  const columns = useMemo<ColDef<Order>[]>(() => [
    { field: "id", headerName: "订单号", width: 140 },
    { field: "customer", headerName: "客户", flex: 1 }
  ], []);

  return (
    <div style={{ height: 520 }}>
      <MachTable<Order>
        rowData={rows}
        columnDefs={columns}
        getRowId={({ data }) => data.id}
      />
    </div>
  );
}
```

Server Component 可以请求数据，再把可序列化的 `rows` 传给 Client Component。函数型列定义不能从 Server Component 跨边界传递，应在 Client Component 内声明。

## 原生 Core

需要自行保护 DOM 入口：

```ts
if (typeof window !== "undefined") {
  const { createGrid } = await import("@agile-team/mach-table");
  const api = createGrid(host, options);
  // 在所属框架或路由销毁时调用 api.destroy()。
}
```

## Hydration 与布局

- 服务端 fallback 与客户端表格不应共享同一个由 Core 管理的 DOM 节点。
- 容器高度应在首屏 CSS 中确定，避免 hydration 后页面跳动。
- 字体异步加载可能影响自动列宽；字体就绪后需要时调用 `autoSizeAllColumns()`。
- 不要在服务端序列化 `GridApi`、DOM、renderer 函数或 Feature 实例。
