import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

/** Only unambiguous TS-private members may be shortened; public/quoted keys are reserved. */
export function privatePropertyPattern(directory = new URL("../packages/core/src/", import.meta.url)) {
  const privateNames = new Set();
  const reserved = new Set();
  function visit(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) reserved.add(node.text);
    const member = ts.isPropertyDeclaration(node) || ts.isMethodDeclaration(node) ||
      ts.isPropertySignature(node) || ts.isMethodSignature(node) || ts.isGetAccessor(node) ||
      ts.isSetAccessor(node) || ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node);
    if (member && node.name && ts.isIdentifier(node.name)) {
      const isPrivate = node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.PrivateKeyword);
      (isPrivate ? privateNames : reserved).add(node.name.text);
    }
    // Parameter properties are never candidates, including those used in adapters.
    if (ts.isParameter(node) && node.modifiers && ts.isIdentifier(node.name)) reserved.add(node.name.text);
    ts.forEachChild(node, visit);
  }
  function walk(folder) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.name === "__tests__") continue;
      const file = new URL(entry.name + (entry.isDirectory() ? "/" : ""), folder);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith(".ts")) {
        visit(ts.createSourceFile(fileURLToPath(file), readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true));
      }
    }
  }
  walk(directory);
  // A private method can share a name with Array/DOM members (e.g. push).
  // Esbuild matches property names globally, so the platform API is reserved too.
  const libDirectory = dirname(ts.getDefaultLibFilePath({}));
  for (const file of readdirSync(libDirectory)) {
    if (!/^lib.*\.d\.ts$/.test(file)) continue;
    const path = join(libDirectory, file);
    visit(ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true));
  }
  const names = [...privateNames].filter(name => !reserved.has(name)).sort();
  const escape = name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^(?:${names.map(escape).join("|")})$`);
}
