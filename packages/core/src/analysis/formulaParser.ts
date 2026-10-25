export type FormulaErrorCode = "SYNTAX" | "LIMIT" | "UNKNOWN_FIELD" | "NON_NUMERIC" | "DIV_ZERO" | "CYCLE" | "NON_FINITE";
export class FormulaFailure extends Error {
  constructor(public code: FormulaErrorCode, message: string) { super(message); }
}
export type Expression =
  | { kind: "number"; value: number }
  | { kind: "field"; name: string }
  | { kind: "unary"; operator: string; operand: Expression }
  | { kind: "binary"; operator: string; left: Expression; right: Expression }
  | { kind: "call"; name: string; args: Expression[] };
interface Token { kind: "number" | "field" | "name" | "symbol"; value: string }
const PRECEDENCE: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2, "^": 3 };
const FUNCTIONS = new Set(["SUM", "MIN", "MAX", "AVG"]);

function tokens(source: string): Token[] {
  if (source.length > 4096) throw new FormulaFailure("LIMIT", "Formula exceeds 4096 characters");
  const output: Token[] = [];
  let position = source.startsWith("=") ? 1 : 0;
  while (position < source.length) {
    if (/\s/.test(source[position])) { position++; continue; }
    const token = readToken(source.slice(position));
    output.push(token);
    position += token.kind === "field" ? token.value.length + 2 : token.value.length;
    if (output.length > 256) throw new FormulaFailure("LIMIT", "Formula exceeds 256 tokens");
  }
  return output;
}

function readToken(source: string): Token {
  const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i.exec(source);
  if (number) return { kind: "number", value: number[0] };
  const field = /^\[([^\]\r\n]+)\]/.exec(source);
  if (field) return { kind: "field", value: field[1] };
  const name = /^[A-Za-z_\u4e00-\u9fff][\w.\u4e00-\u9fff]*/.exec(source);
  if (name) return { kind: "name", value: name[0] };
  if ("+-*/%^(),".includes(source[0])) return { kind: "symbol", value: source[0] };
  throw new FormulaFailure("SYNTAX", `Unexpected token: ${source.slice(0, 12)}`);
}

/** Bounded Pratt parser; property access, assignments and executable JavaScript are not grammar. */
export function parseFormula(source: string): Expression {
  const input = tokens(source);
  let position = 0;
  const expect = (value: string): void => {
    if (input[position++]?.value !== value) throw new FormulaFailure("SYNTAX", `Expected ${value}`);
  };
  const expression = (minimum: number, depth: number): Expression => {
    if (depth > 32) throw new FormulaFailure("LIMIT", "Formula exceeds 32 nesting levels");
    let left = atom(depth);
    while (position < input.length) {
      const operator = input[position].value;
      const precedence = Object.prototype.hasOwnProperty.call(PRECEDENCE, operator) ? PRECEDENCE[operator] : undefined;
      if (precedence == null || precedence < minimum) break;
      position++;
      const right = expression(precedence + (operator === "^" ? 0 : 1), depth + 1);
      left = { kind: "binary", operator, left, right };
    }
    return left;
  };
  const call = (name: string, depth: number): Expression => {
    const upper = name.toUpperCase();
    if (!FUNCTIONS.has(upper)) throw new FormulaFailure("SYNTAX", `Unsupported function: ${name}`);
    expect("(");
    const args: Expression[] = [];
    if (input[position]?.value !== ")") {
      do { args.push(expression(0, depth + 1)); } while (input[position]?.value === "," && ++position);
    }
    expect(")");
    if (!args.length && upper !== "SUM") throw new FormulaFailure("SYNTAX", `${upper} requires arguments`);
    return { kind: "call", name: upper, args };
  };
  const atom = (depth: number): Expression => {
    const token = input[position++];
    if (!token) throw new FormulaFailure("SYNTAX", "Expected a value");
    if (token.kind === "number") return { kind: "number", value: Number(token.value) };
    if (token.kind === "field") return { kind: "field", name: token.value };
    if (token.kind === "name") return input[position]?.value === "(" ? call(token.value, depth) : { kind: "field", name: token.value };
    if (token.value === "+" || token.value === "-") return { kind: "unary", operator: token.value, operand: expression(3, depth + 1) };
    if (token.value === "(") { const result = expression(0, depth + 1); expect(")"); return result; }
    throw new FormulaFailure("SYNTAX", `Unexpected token: ${token.value}`);
  };
  const result = expression(0, 0);
  if (position !== input.length) throw new FormulaFailure("SYNTAX", "Unexpected trailing tokens");
  return result;
}

export function finite(value: number): number {
  if (!Number.isFinite(value)) throw new FormulaFailure("NON_FINITE", "Formula result is not a finite number");
  return value;
}

function binary(operator: string, left: number, right: number): number {
  if ((operator === "/" || operator === "%") && right === 0) throw new FormulaFailure("DIV_ZERO", "Division by zero");
  if (operator === "+") return left + right;
  if (operator === "-") return left - right;
  if (operator === "*") return left * right;
  if (operator === "/") return left / right;
  return operator === "%" ? left % right : left ** right;
}

export function evaluateExpression(node: Expression, field: (name: string) => number): number {
  if (node.kind === "number") return finite(node.value);
  if (node.kind === "field") return field(node.name);
  if (node.kind === "unary") return finite((node.operator === "-" ? -1 : 1) * evaluateExpression(node.operand, field));
  if (node.kind === "binary") return finite(binary(node.operator, evaluateExpression(node.left, field), evaluateExpression(node.right, field)));
  const values = node.args.map((argument) => evaluateExpression(argument, field));
  if (node.name === "MIN") return Math.min(...values);
  if (node.name === "MAX") return Math.max(...values);
  const sum = values.reduce((total, value) => total + value, 0);
  return finite(node.name === "AVG" ? sum / values.length : sum);
}
