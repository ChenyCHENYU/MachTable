import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

/** Only private or explicitly internal class members may be shortened; public/quoted/native keys are reserved. */
export function privatePropertyPattern(directory = new URL("../packages/core/src/", import.meta.url)) {
  const privateNames = new Set();
  const reserved = new Set();
  function visit(node, allowCandidates = true) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) reserved.add(node.text);
    const member = ts.isPropertyDeclaration(node) || ts.isMethodDeclaration(node) ||
      ts.isPropertySignature(node) || ts.isMethodSignature(node) || ts.isGetAccessor(node) ||
      ts.isSetAccessor(node) || ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node);
    if (member && node.name && ts.isIdentifier(node.name)) {
      // Internal service classes need TS-public methods for sibling services,
      // but never escape through package exports or renderer/editor params.
      const internalClass = ts.isClassDeclaration(node.parent) && ts.getJSDocTags(node.parent).some(tag => tag.tagName.text === "internal");
      const isPrivate = internalClass || node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.PrivateKeyword);
      if (isPrivate) { if (allowCandidates) privateNames.add(node.name.text); }
      else reserved.add(node.name.text);
    }
    // Parameter properties are never candidates, including those used in adapters.
    if (ts.isParameter(node) && node.modifiers && ts.isIdentifier(node.name)) reserved.add(node.name.text);
    ts.forEachChild(node, child => visit(child, allowCandidates));
  }
  function walk(folder, allowCandidates = true) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.name === "__tests__") continue;
      const file = new URL(entry.name + (entry.isDirectory() ? "/" : ""), folder);
      if (entry.isDirectory()) walk(file, allowCandidates);
      else if (/\.tsx?$/.test(entry.name)) {
        visit(ts.createSourceFile(fileURLToPath(file), readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true), allowCandidates);
      }
    }
  }
  walk(directory);
  // Adapter workflow contracts may pass objects into Core. Reserve their public
  // keys too, without turning adapter-private fields into Core candidates.
  for (const name of ["vue", "react", "xlsx"]) walk(new URL(`../packages/${name}/src/`, import.meta.url), false);
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
