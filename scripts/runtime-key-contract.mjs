import ts from "typescript";

/** Include quoted/mapped/indexed contracts and public constructor properties. */
export function declaredRuntimeKeys(source) {
  const keys = [];
  const visit = node => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) keys.push(node.text);
    const member = ts.isPropertyDeclaration(node) || ts.isMethodDeclaration(node) || ts.isPropertySignature(node)
      || ts.isMethodSignature(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node)
      || ts.isParameter(node) && ts.isParameterPropertyDeclaration(node, node.parent);
    const privateMember = node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.PrivateKeyword);
    if (member && !privateMember && node.name && ts.isIdentifier(node.name)) keys.push(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return keys;
}
