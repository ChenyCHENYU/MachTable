# 列工作台

0.13 将原来的简易列显隐面板升级为内置列工作台：搜索、显隐、左右固定、同组排序、自动列宽与重置均使用同一份列状态，不需要业务页面再维护一套字段数组。

## 打开内置工作台

```ts
api.columns.openWorkbench(buttonEl);
api.columns.closeWorkbench();
```

不传锚点时，工作台自动定位在表格右上角。

## 自定义业务工作台

如果产品需要把列配置放进自己的 `ElDrawer`、`Dialog` 或设置中心，可读取统一的 headless 数据：

```ts
const columns = api.columns.getWorkbenchItems();
// [{ colId, label, visible, pinned, width, movable, hideable }]

api.columns.setVisible("amount", false);
api.columns.setPinned("orderNo", "left");
api.columns.move("status", 2);
api.columns.autoSizeAll();
api.columns.resetState();
```

`hideable: false` 表示选择列等结构性列不应被用户隐藏；`movable: false` 表示业务锁定列。自定义 UI 应遵守这两个标记。

## 持久化

在具体表格设置列区段持久化后，工作台的显隐、顺序、固定和宽度会自动保存：

```ts
const tableOptions = {
  persistence: { key: "tenant:user:orders:v3", sections: ["columns"] }
};
```

`persistence` 含用户/页面身份，必须留在当前表格，配置中心会拒绝它。应用级配置只统一 `enableColumnResize`、`columnMenu` 等无身份默认值。

多租户应用应按 `${appId}:${tenantId}:${userId}:${route}:v${schemaVersion}` 生成隔离的 `persistence.key`。列 ID 或结构发生破坏性变化时提升 `schemaVersion`，不要继续回放不兼容状态。

## 设计边界

- 工作台只管理列视图，不保存查询条件或业务表单；完整工作区恢复使用 `GridState`。
- 分组列只在所属组内移动，固定区列只在相同固定区内移动，避免配置后表头结构失真。
- 搜索只过滤工作台列表，不改变表格数据和列状态。
- 列状态变化仍通过标准事件与持久化链路执行，自定义工作台与内置工作台不会产生两套行为。
