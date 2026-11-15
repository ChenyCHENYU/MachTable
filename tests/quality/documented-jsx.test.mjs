import assert from "node:assert/strict";
import { test } from "node:test";
import { checkDocumentedJsx } from "../../scripts/quality/documented-jsx.mjs";

test("文档门禁拒绝 Vue 绑定混入 TSX，并返回 Markdown 原始位置", () => {
  const result = checkDocumentedJsx("# 配方\n\n```tsx\n<MachTable :persistence=\"{}\" />\n```\n", "recipe.md");
  assert.equal(result.blocks, 1);
  assert.ok(result.failures.length > 0);
  assert.ok(result.failures.some(message => message.startsWith("recipe.md:4:")));
});

test("多表 JSX 必须有共同父节点，正确 fragment 和 TSX 泛型可以通过", () => {
  const invalid = checkDocumentedJsx("```jsx\n<A /><B />\n```\n", "invalid.md");
  assert.ok(invalid.failures.length > 0);
  const valid = checkDocumentedJsx("```tsx\nconst view = <><MachTable<Order> persistence={{ key: 'orders' }} /><MachTable preset=\"detail\" /></>;\n```\n\n```jsx\nconst view = <><A /><B /></>;\n```\n", "valid.md");
  assert.equal(valid.blocks, 2);
  assert.deepEqual(valid.failures, []);
});
