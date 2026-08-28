# 撤销 / 重做

所有写操作（含批量）自动入栈，默认深度 100。

## 自动入栈的操作

| 操作 | 撤销粒度 |
| --- | --- |
| 单元格编辑（Enter/失焦确认） | 单格 |
| 粘贴（Ctrl+V / 菜单） | **整个粘贴一次回滚** |
| 剪切（Ctrl+X） | 整个清除范围 |
| Delete 批量清除 | 整个清除范围 |
| 填充柄拖拽 | 整个填充区域 |

## API

```ts
api.undo();       // 回滚上一单元，返回是否成功
api.redo();
api.canUndo();    // 栈非空
api.canRedo();

// 配置
createGrid(host, { undoStackSize: 200 });   // 默认 100
createGrid(host, { undoStackSize: 0 });     // 关闭
```

建议在工具栏挂按钮（配合禁用态）：

```ts
toolbar.render(() => [
  button("撤销").disabled(!api.canUndo()).onClick(() => api.undo()),
  button("重做").disabled(!api.canRedo()).onClick(() => api.redo())
]);
```

## 行为语义

| 场景 | 行为 |
| --- | --- |
| undo 后编辑新值 | 历史分叉，redo 分支丢弃（标准编辑器语义） |
| undo/redo 的值写回 | 走 `valueSetter`（与编辑同链路），并触发 `cellValueChanged`（oldValue/newValue 对调） |
| 视图刷新 | undo 自动刷新受影响行、合计行、状态栏 |
| `setRowData` 全量替换 | **清空撤销栈**（历史指向的行已不存在） |
| 行删除（applyTransaction remove） | 不自动入栈（当前版本仅追踪单元格值变更） |

## 监听撤销产生的变更

```ts
api.addEventListener("cellValueChanged", (e) => {
  // 无法直接区分"用户编辑"与"undo 回放"；
  // 需要区分时在 undo() 前后设置标记位
  audit(e.rowNode.id, e.colDef.field, e.oldValue, e.newValue);
});
```

## 与持久化的关系

撤销只回滚**内存中的数据对象**；是否落库由你的 `cellValueChanged` 处理器决定（如防抖提交）。undo 后同样触发事件——保存逻辑无需感知撤销。
