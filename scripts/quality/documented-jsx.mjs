import ts from "typescript";

/** 只验证 JSX/TSX 语法；片段可省略业务变量，不伪装成完整类型或运行验证。 */
export function checkDocumentedJsx(markdown, label) {
  const failures = [];
  let blocks = 0;
  for (const block of markdown.matchAll(/^```(tsx|jsx)[^\n]*\n([\s\S]*?)^```/gm)) {
    const parsed = ts.createSourceFile(label, block[2], ts.ScriptTarget.Latest, true,
      block[1] === "tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.JSX);
    blocks++;
    const startLine = markdown.slice(0, block.index).split("\n").length;
    for (const diagnostic of parsed.parseDiagnostics) {
      const position = parsed.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
      failures.push(`${label}:${startLine + position.line + 1}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
    }
  }
  return { blocks, failures };
}
