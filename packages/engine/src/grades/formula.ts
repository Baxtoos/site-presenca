import { fromDecimal, type Rational } from "./rational";

export type Expr =
  | { type: "num"; value: string }
  | { type: "ref"; name: string }
  | { type: "neg"; arg: Expr }
  | { type: "bin"; op: "+" | "-" | "*" | "/"; left: Expr; right: Expr }
  | { type: "call"; fn: "max" | "min" | "media"; args: Expr[] };

export class FormulaError extends Error {
  override name = "FormulaError";
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(message);
  }
}

const FUNCTIONS = new Set(["max", "min", "media"]);
const MAX_LENGTH = 500;
const MAX_DEPTH = 40;

type Token =
  | { kind: "num"; text: string; pos: number }
  | { kind: "id"; text: string; pos: number }
  | { kind: "op"; text: string; pos: number }
  | { kind: "end"; pos: number };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const num = /^\d+(?:[.,]\d+)?/.exec(src.slice(i));
    if (num) {
      tokens.push({ kind: "num", text: num[0].replace(",", "."), pos: i });
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_À-ÿ][A-Za-z0-9_À-ÿ]*/.exec(src.slice(i));
    if (id) {
      tokens.push({ kind: "id", text: id[0], pos: i });
      i += id[0].length;
      continue;
    }
    if ("+-*/(),;".includes(c)) {
      tokens.push({ kind: "op", text: c === ";" ? "," : c, pos: i });
      i++;
      continue;
    }
    throw new FormulaError(`Caractere não permitido: "${c}"`, i);
  }
  tokens.push({ kind: "end", pos: src.length });
  return tokens;
}

export function parseFormula(src: string): Expr {
  if (src.length > MAX_LENGTH) throw new FormulaError("Fórmula longa demais.", MAX_LENGTH);
  const tokens = tokenize(src);
  let i = 0;
  const peek = () => tokens[i]!;
  const isOp = (t: Token, op: string) => t.kind === "op" && t.text === op;
  const expectOp = (op: string) => {
    const t = peek();
    if (!isOp(t, op)) throw new FormulaError(`Esperava "${op}"`, t.pos);
    i++;
  };

  function expr(depth: number): Expr {
    if (depth > MAX_DEPTH) throw new FormulaError("Fórmula aninhada demais.", peek().pos);
    let left = term(depth);
    while (isOp(peek(), "+") || isOp(peek(), "-")) {
      const op = (tokens[i++] as { text: "+" | "-" }).text;
      left = { type: "bin", op, left, right: term(depth) };
    }
    return left;
  }
  function term(depth: number): Expr {
    let left = unary(depth);
    while (isOp(peek(), "*") || isOp(peek(), "/")) {
      const op = (tokens[i++] as { text: "*" | "/" }).text;
      left = { type: "bin", op, left, right: unary(depth) };
    }
    return left;
  }
  function unary(depth: number): Expr {
    if (isOp(peek(), "-")) {
      i++;
      return { type: "neg", arg: unary(depth + 1) };
    }
    if (isOp(peek(), "+")) {
      i++;
      return unary(depth + 1);
    }
    return primary(depth);
  }
  function primary(depth: number): Expr {
    const t = peek();
    if (t.kind === "num") {
      i++;
      return { type: "num", value: t.text };
    }
    if (t.kind === "id") {
      i++;
      const lower = t.text.toLowerCase();
      if (isOp(peek(), "(")) {
        if (!FUNCTIONS.has(lower)) {
          throw new FormulaError(`Função desconhecida: ${t.text} (use max, min ou media)`, t.pos);
        }
        i++;
        const args: Expr[] = [];
        if (!isOp(peek(), ")")) {
          args.push(expr(depth + 1));
          while (isOp(peek(), ",")) {
            i++;
            args.push(expr(depth + 1));
          }
        }
        expectOp(")");
        if (args.length === 0) throw new FormulaError(`${t.text}() precisa de valores`, t.pos);
        return { type: "call", fn: lower as "max" | "min" | "media", args };
      }
      return { type: "ref", name: t.text };
    }
    if (isOp(t, "(")) {
      i++;
      const inner = expr(depth + 1);
      expectOp(")");
      return inner;
    }
    throw new FormulaError(
      t.kind === "end" ? "A fórmula terminou antes da hora." : `Não esperava "${t.text}"`,
      t.pos,
    );
  }

  const tree = expr(0);
  if (peek().kind !== "end") throw new FormulaError("Sobrou texto no fim da fórmula.", peek().pos);
  return tree;
}

export function formulaRefs(e: Expr, out = new Set<string>()): Set<string> {
  switch (e.type) {
    case "ref":
      out.add(e.name);
      break;
    case "neg":
      formulaRefs(e.arg, out);
      break;
    case "bin":
      formulaRefs(e.left, out);
      formulaRefs(e.right, out);
      break;
    case "call":
      e.args.forEach((a) => formulaRefs(a, out));
      break;
  }
  return out;
}

export function evaluate(e: Expr, env: (name: string) => Rational, ops: Ops): Rational {
  switch (e.type) {
    case "num":
      return fromDecimal(e.value);
    case "ref":
      return env(e.name);
    case "neg":
      return ops.sub(ops.zero, evaluate(e.arg, env, ops));
    case "bin": {
      const l = evaluate(e.left, env, ops);
      const r = evaluate(e.right, env, ops);
      return e.op === "+"
        ? ops.add(l, r)
        : e.op === "-"
          ? ops.sub(l, r)
          : e.op === "*"
            ? ops.mul(l, r)
            : ops.div(l, r);
    }
    case "call": {
      const vals = e.args.map((a) => evaluate(a, env, ops));
      if (e.fn === "max") return vals.reduce((a, b) => ops.max(a, b));
      if (e.fn === "min") return vals.reduce((a, b) => ops.min(a, b));
      return ops.div(
        vals.reduce((a, b) => ops.add(a, b)),
        ops.int(vals.length),
      );
    }
  }
}

export interface Ops {
  zero: Rational;
  int: (n: number) => Rational;
  add: (a: Rational, b: Rational) => Rational;
  sub: (a: Rational, b: Rational) => Rational;
  mul: (a: Rational, b: Rational) => Rational;
  div: (a: Rational, b: Rational) => Rational;
  min: (a: Rational, b: Rational) => Rational;
  max: (a: Rational, b: Rational) => Rational;
}
