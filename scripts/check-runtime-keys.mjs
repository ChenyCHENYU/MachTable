import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { privatePropertyPattern } from "./private-property-mangling.mjs";

// The generated declarations are the consumer contract, including Column and
// other objects passed to custom renderers. Internal service compression must
// never rename one of these public or protected members.
const pattern = privatePropertyPattern();
const failures = new Set();
let checked = 0;
for (const name of ["core", "vue", "react", "xlsx"]) {
  const directory = join("packages", name, "dist");
  for (const file of readdirSync(directory).filter(file => /\.d\.(?:ts|cts)$/.test(file))) {
    const path = join(directory, file);
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = node => {
      const member = ts.isPropertyDeclaration(node) || ts.isMethodDeclaration(node) || ts.isPropertySignature(node)
        || ts.isMethodSignature(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node);
      const privateMember = node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.PrivateKeyword);
      if (member && !privateMember && node.name && ts.isIdentifier(node.name)) {
        checked++;
        if (pattern.test(node.name.text)) failures.add(`${path}: ${node.name.text}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
}
if (failures.size) {
  console.error(`Public runtime keys must not be compressed:\n${[...failures].join("\n")}`);
  process.exitCode = 1;
} else console.log(`OK   ${checked} declared runtime keys retain their public names`);
