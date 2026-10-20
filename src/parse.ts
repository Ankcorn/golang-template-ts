import { lex } from "./lex.js";
// Parser for the Go text/template language. See LICENSE for upstream attribution.
export type Expr = { pos?: number } & (
  | { kind: "literal"; value: unknown; raw: string }
  | { kind: "path"; value: string }
  | { kind: "ident"; value: string }
  | { kind: "group"; pipe: Pipe; fields: string[] }
);
export interface Pipe {
  decl: string[];
  assign: boolean;
  commands: Expr[][];
}
export interface Node {
  kind: string;
  text?: string;
  pipe?: Pipe;
  body?: Node[];
  otherwise?: Node[];
  name?: string;
  pos: number;
  left?: string;
  right?: string;
}
export interface Tree {
  name: string;
  source: string;
  nodes: Node[];
  parseName?: string;
}
export interface Token {
  text: string;
  pos: number;
}
export function unquote(s: string): string {
  if (s[0] === "`") return s.slice(1, -1).replace(/\r/g, "");
  let out = "";
  const body = s.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    let c = body[i];
    if (c !== "\\") {
      out += c;
      continue;
    }
    c = body[++i];
    const simple: Record<string, string> = {
      a: "\x07",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      v: "\x0b",
      "\\": "\\",
      '"': '"',
      "'": "'",
    };
    if (c in simple) {
      out += simple[c];
      continue;
    }
    let count =
      c === "x" ? 2 : c === "u" ? 4 : c === "U" ? 8 : /[0-7]/.test(c) ? 3 : 0;
    if (!count) throw Error("invalid syntax");
    let digits =
      c === "x" || c === "u" || c === "U"
        ? body.slice(i + 1, i + 1 + count)
        : body.slice(i, i + count);
    const radix = /[0-7]/.test(c) ? 8 : 16;
    if (
      digits.length !== count ||
      !(radix === 8 ? /^[0-7]+$/ : /^[0-9a-f]+$/i).test(digits)
    )
      throw Error("invalid syntax");
    const n = parseInt(digits, radix);
    if (n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff))
      throw Error("invalid Unicode code point");
    out += String.fromCodePoint(n);
    i += count - (radix === 8 ? 1 : 0);
  }
  return out;
}
export interface NumberLiteral {
  goNumber: true;
  raw: string;
  value: number | bigint;
  imaginary?: number;
}
export function numberLiteral(raw: string): NumberLiteral {
  if (raw[0] === "'") {
    const s = unquote(raw);
    if ([...s].length !== 1) throw Error("malformed character constant");
    return { goNumber: true, raw, value: s.codePointAt(0)! };
  }
  let s = raw.replaceAll("_", "");
  if (s.endsWith("i")) {
    const m = s.slice(0, -1).match(/^(.+?)([+-](?:\d|\.).*)$/);
    const real = m ? Number(m[1]) : 0,
      imaginary = Number(m ? m[2] : s.slice(0, -1));
    if (!Number.isFinite(real) || !Number.isFinite(imaginary))
      throw Error("illegal number syntax");
    return { goNumber: true, raw, value: real, imaginary };
  }
  const neg = s[0] === "-";
  const unsigned = s.replace(/^[+-]/, "");
  if (/^0[xX][\da-fA-F]*\.?[\da-fA-F]+[pP][+-]?\d+$/.test(unsigned)) {
    const [mant, exp] = unsigned.slice(2).split(/[pP]/);
    const [a, b = ""] = mant.split(".");
    return {
      goNumber: true,
      raw,
      value:
        (neg ? -1 : 1) *
        (parseInt(a || "0", 16) + parseInt(b || "0", 16) / 16 ** b.length) *
        2 ** Number(exp),
    };
  }
  if (/^(?:0[xX][\da-fA-F]+|0[bB][01]+|0[oO][0-7]+|\d+)$/.test(unsigned)) {
    let str = unsigned;
    if (/^0[0-7]+$/.test(str)) str = "0o" + str.slice(1);
    else if (/^0\d+/.test(str)) throw Error("illegal number syntax");
    const n = BigInt(str) * (neg ? -1n : 1n);
    if (n < -(1n << 63n) || n > (1n << 64n) - 1n)
      throw Error("integer overflow");
    return { goNumber: true, raw, value: n };
  }
  if (
    !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(s) ||
    !Number.isFinite(Number(s))
  )
    throw Error("illegal number syntax");
  return { goNumber: true, raw, value: Number(s) };
}
export function tokenize(s: string, offset = 0): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < s.length) {
    if (/[ \t\r\n]/.test(s[i])) {
      i++;
      continue;
    }
    const start = i,
      c = s[i++];
    if ("(),|=".includes(c)) {
      out.push({ text: c, pos: start + offset });
      continue;
    }
    if (c === ":" && s[i] === "=") {
      i++;
      out.push({ text: ":=", pos: start + offset });
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let closed = false;
      while (i < s.length) {
        const q = s[i++];
        if (q === c) {
          closed = true;
          break;
        }
        if (q === "\\" && c !== "`") i++;
        if (q === "\n" && c !== "`") throw Error("unterminated quoted string");
      }
      if (!closed) throw Error("unterminated quoted string");
    } else {
      while (
        i < s.length &&
        !/[ \t\r\n(),|=]/.test(s[i]) &&
        !(s[i] === ":" && s[i + 1] === "=")
      )
        i++;
    }
    out.push({ text: s.slice(start, i), pos: start + offset });
  }
  return out;
}
const builtins = new Set(
  "and call html index slice js len not or print printf println urlquery eq ne lt le gt ge".split(
    " ",
  ),
);
class PipeParser {
  i = 0;
  constructor(
    public tokens: Token[],
    private funcs: Set<string>,
    private vars: Set<string>,
    private skip = false,
    private maxDepth = 10000,
  ) {}
  parse(stop = false, depth = 0): Pipe {
    let decl: string[] = [],
      assign = false;
    let commands: Expr[][] = [];
    const ts = this.tokens;
    if (ts[this.i]?.text.startsWith("$")) {
      let j = this.i;
      const names: string[] = [];
      while (ts[j]?.text.startsWith("$")) {
        names.push(ts[j++].text);
        if (ts[j]?.text !== ",") break;
        j++;
      }
      if (ts[j]?.text === ":=" || ts[j]?.text === "=") {
        decl = names;
        assign = ts[j].text === "=";
        this.i = j + 1;
        for (const name of decl) {
          if (!/^\$[\p{L}\p{N}_]*$/u.test(name))
            throw Error('unexpected \":=\" in operand');
          this.vars.add(name);
        }
      }
    }
    let cmd: Expr[] = [];
    while (this.i < ts.length) {
      let t = ts[this.i].text;
      const exprPos = ts[this.i].pos;
      const previous = ts[this.i - 1];
      if (
        previous &&
        previous.pos + previous.text.length === ts[this.i].pos &&
        (['\"', "'", "`"].includes(previous.text[0]) ||
          previous.text === ")") &&
        t !== ")" &&
        t !== "|" &&
        !(previous.text === ")" && t.startsWith(".") && t !== ".")
      )
        throw Error("unexpected . after term in operand");
      if (t === ")" && stop) break;
      this.i++;
      if (t === "|") {
        if (!cmd.length) throw Error('unexpected "|" in command');
        commands.push(cmd);
        cmd = [];
        continue;
      }
      if (t === "(") {
        if (ts[this.i]?.text === ")")
          throw Error("missing value for parenthesized pipeline");
        if (depth >= this.maxDepth)
          throw Error("max expression depth exceeded");
        const pipe = this.parse(true, depth + 1);
        if (ts[this.i++]?.text !== ")") throw Error("unclosed left paren");
        const fields: string[] = [];
        if (
          ts[this.i]?.text.startsWith(".") &&
          ts[this.i].text !== "." &&
          ts[this.i - 1].pos + 1 === ts[this.i].pos
        ) {
          fields.push(...ts[this.i++].text.slice(1).split("."));
        }
        cmd.push({ pos: exprPos, kind: "group", pipe, fields });
        continue;
      }
      if (t === ")" || t === "," || t === "=" || t === ":=")
        throw Error(`unexpected ${t} in operand`);
      if (t === "true" || t === "false" || t === "nil")
        cmd.push({
          pos: exprPos,
          kind: "literal",
          value: t === "nil" ? null : t === "true",
          raw: t,
        });
      else if (t[0] === '"' || t[0] === "`")
        cmd.push({ pos: exprPos, kind: "literal", value: unquote(t), raw: t });
      else if (t[0] === "'" || /^[+\-\d]/.test(t) || /^\.\d/.test(t))
        cmd.push({
          pos: exprPos,
          kind: "literal",
          value: numberLiteral(t),
          raw: t,
        });
      else if (t[0] === "." || t[0] === "$") {
        if (t[0] === "$" && !this.vars.has(t.split(".")[0]))
          throw Error(`undefined variable "${t.split(".")[0]}"`);
        if (t.includes("..")) throw Error("unexpected . after term");
        if (
          !/^(?:\$[\p{L}\p{N}_]*|\.)(?:[\p{L}\p{N}_]+)?(?:\.[\p{L}\p{N}_]+)*$/u.test(
            t,
          )
        )
          throw Error(`bad character in operand ${t}`);
        cmd.push({ pos: exprPos, kind: "path", value: t });
      } else {
        if (t.includes(".")) {
          if (/^(true|false|nil)\./.test(t))
            throw Error("unexpected . after term");
          const [head, ...fields] = t.split(".");
          if (!this.skip && !builtins.has(head) && !this.funcs.has(head))
            throw Error(`function \"${head}\" not defined`);
          cmd.push({
            pos: exprPos,
            kind: "group",
            pipe: {
              decl: [],
              assign: false,
              commands: [[{ kind: "ident", value: head }]],
            },
            fields,
          });
          continue;
        }
        if (!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(t))
          throw Error(`bad character in operand ${t}`);
        if (!this.skip && !builtins.has(t) && !this.funcs.has(t))
          throw Error(`function "${t}" not defined`);
        cmd.push({ pos: exprPos, kind: "ident", value: t });
      }
    }
    if (!cmd.length) throw Error("missing value for command");
    commands.push(cmd);
    for (let i = 1; i < commands.length; i++) {
      const head = commands[i][0];
      if (
        head.kind === "literal" ||
        (head.kind === "path" && head.value === ".")
      )
        throw Error("non executable command in pipeline");
    }
    return { decl, assign, commands };
  }
}
interface Segment {
  text: string;
  action: boolean;
  pos: number;
}
function segments(
  source: string,
  left: string,
  right: string,
  comments = false,
): Segment[] {
  let i = 0,
    trim = false;
  const out: Segment[] = [];
  while (i < source.length) {
    let start = source.indexOf(left, i);
    if (start < 0) start = source.length;
    let text = source.slice(i, start);
    if (trim) text = text.replace(/^[ \t\r\n]+/, "");
    let a = start + left.length;
    const trimLeft = source[a] === "-" && /[ \t\r\n]/.test(source[a + 1] || "");
    if (trimLeft) {
      text = text.replace(/[ \t\r\n]+$/, "");
      a += 2;
    }
    if (text) out.push({ text, action: false, pos: i });
    if (start === source.length) break;
    let end = a,
      quote = "",
      comment = source.slice(a, a + 2) === "/*";
    if (comment) {
      const close = source.indexOf("*/", a + 2);
      if (close < 0) throw Error("unclosed comment");
      end = close + 2;
      while (/[ \t\r\n]/.test(source[end] || "") && source[end]) end++;
      if (
        source[end] === "-" &&
        source.slice(end + 1, end + 1 + right.length) === right
      )
        end++;
      if (source.slice(end, end + right.length) !== right)
        throw Error("comment ends before closing delimiter");
    } else {
      for (; end < source.length; end++) {
        const c = source[end];
        if (quote) {
          if (c === "\\" && quote !== "`") {
            end++;
            continue;
          }
          if (c === quote) quote = "";
          continue;
        }
        if (source.startsWith(right, end)) break;
        if (c === '"' || c === "'" || c === "`") quote = c;
      }
      if (end >= source.length) throw Error("unclosed action");
    }
    let body = source.slice(a, end);
    trim = /[ \t\r\n]-$/.test(body);
    if (trim) body = body.slice(0, -2);
    if (!comment || comments) out.push({ text: body, action: true, pos: a });
    i = end + right.length;
  }
  return out;
}
export function parse(
  name: string,
  source: string,
  funcs: string[] = [],
  left = "{{",
  right = "}}",
  skip = false,
  maxDepth = 10000,
  comments = false,
): Map<string, Tree> {
  const items = lex(source, left, right);
  const failure = items.find((x) => x.type === "error");
  if (failure) {
    let message = failure.value;
    const line =
      message === "unclosed action" ? source.split("\n").length : failure.line;
    if (message === "unclosed action") {
      const action = items.filter((x) => x.type === "left delim").at(-1);
      if (action && action.line !== line)
        message += ` started at ${name}:${action.line}`;
    }
    throw Error(`${name}:${line}: ${message}`);
  }
  const ss = segments(source, left, right, comments),
    trees = new Map<string, Tree>();
  let i = 0;
  const fn = new Set(funcs);
  const vars = new Set(["$"]);
  function pipe(tokens: Token[], scope: Set<string>) {
    try {
      return new PipeParser(tokens, fn, scope, skip, maxDepth).parse();
    } catch (e) {
      const line = source.slice(0, tokens[0]?.pos ?? 0).split("\n").length;
      throw Error(`${name}:${line}: ${e instanceof Error ? e.message : e}`);
    }
  }
  function body(
    scope: Set<string>,
    rangeDepth: number,
    top = false,
  ): { nodes: Node[]; stop?: Token[] } {
    const nodes: Node[] = [];
    while (i < ss.length) {
      const seg = ss[i++];
      if (!seg.action) {
        nodes.push({ kind: "text", text: seg.text, pos: seg.pos });
        continue;
      }
      if (seg.text.startsWith("/*")) {
        nodes.push({ kind: "comment", text: seg.text, pos: seg.pos });
        continue;
      }
      const ts = tokenize(seg.text, seg.pos);
      if (!ts.length) throw Error("missing value for command");
      const keyword = ts[0].text;
      if (keyword === "end" || keyword === "else") {
        if (top) throw Error(`unexpected {{${keyword}}}`);
        if (keyword === "end" && ts.length > 1)
          throw Error("unexpected operand in end");
        return { nodes, stop: ts };
      }
      if (keyword === "define" || keyword === "block") {
        if (keyword === "define" && !top)
          throw Error("unexpected define in command");
        const str = ts[1]?.text;
        if (!str || !['"', "`"].includes(str[0]))
          throw Error("unexpected template name");
        const n = unquote(str);
        const p = keyword === "block" ? pipe(ts.slice(2), scope) : undefined;
        if (keyword === "define" && ts.length !== 2)
          throw Error("unexpected operand in define");
        const b = body(new Set(["$"]), 0);
        if (b.stop?.[0].text !== "end") throw Error("unexpected EOF");
        if (trees.has(n) && !isEmpty(trees.get(n)!.nodes) && !isEmpty(b.nodes))
          throw Error(`template: multiple definition of template "${n}"`);
        if (!trees.has(n) || !isEmpty(b.nodes))
          trees.set(n, { name: n, source, nodes: b.nodes });
        if (keyword === "block")
          nodes.push({ kind: "template", name: n, pipe: p, pos: seg.pos });
        continue;
      }
      if (keyword === "if" || keyword === "with" || keyword === "range") {
        nodes.push(branch(ts, scope, rangeDepth, seg.pos));
        continue;
      }
      if ((keyword === "break" || keyword === "continue") && !fn.has(keyword)) {
        if (ts.length !== 1) throw Error(`unexpected operand in ${keyword}`);
        if (!rangeDepth) throw Error(`{{${keyword}}} outside {{range}}`);
        nodes.push({ kind: keyword, pos: seg.pos });
        continue;
      }
      if (keyword === "template") {
        const t = ts[1]?.text;
        if (!t || !['"', "`"].includes(t[0]))
          throw Error("unexpected template name");
        nodes.push({
          kind: "template",
          name: unquote(t),
          pipe: ts.length > 2 ? pipe(ts.slice(2), scope) : undefined,
          pos: seg.pos,
        });
        continue;
      }
      const p = pipe(ts, scope);
      if (p.decl.length > 1) throw Error("too many declarations in command");
      nodes.push({ kind: "action", pipe: p, pos: seg.pos });
    }
    return { nodes };
  }
  function branch(
    ts: Token[],
    scope: Set<string>,
    depth: number,
    pos: number,
  ): Node {
    const kind = ts[0].text,
      inner = new Set(scope);
    if (kind === "range" && ts.some((t) => t.text === ",")) {
      const comma = ts.findIndex((t) => t.text === ",");
      if (!ts[comma + 1]) throw Error("missing value for range");
      if (!ts[comma + 1].text.startsWith("$"))
        throw Error("range can only initialize variables");
    }
    if (kind === "range" && [":=", "="].includes(ts.at(-1)?.text ?? ""))
      throw Error("missing value for range");
    const p = pipe(ts.slice(1), inner);
    if (p.decl.length > (kind === "range" ? 2 : 1))
      throw Error("too many declarations in command");
    const b = body(inner, depth + (kind === "range" ? 1 : 0));
    let otherwise: Node[] = [];
    if (!b.stop) throw Error("unexpected EOF");
    if (b.stop[0].text === "else") {
      if (b.stop.length > 1) {
        if (b.stop[1].text !== kind || kind === "range")
          throw Error("unexpected else clause");
        otherwise = [branch(b.stop.slice(1), inner, depth, pos)];
      } else {
        const e = body(new Set(inner), depth);
        if (e.stop?.[0].text !== "end") throw Error("unexpected EOF");
        otherwise = e.nodes;
      }
    }
    return { kind, pipe: p, body: b.nodes, otherwise, pos };
  }
  const root = body(vars, 0, true).nodes;
  if (!trees.has(name) || !isEmpty(root))
    trees.set(name, { name, source, nodes: root });
  for (const t of trees.values()) {
    t.parseName = name;
    const visit = (nodes: Node[]) => {
      for (const n of nodes) {
        n.left = left;
        n.right = right;
        if (n.body) visit(n.body);
        if (n.otherwise) visit(n.otherwise);
      }
    };
    visit(t.nodes);
  }
  return trees;
}
export function isEmpty(nodes: Node[]): boolean {
  return nodes.every(
    (n) => n.kind === "comment" || (n.kind === "text" && !n.text?.trim()),
  );
}
export function pipeString(p: Pipe): string {
  return (
    (p.decl.length ? p.decl.join(", ") + (p.assign ? " = " : " := ") : "") +
    p.commands
      .map((c) =>
        c
          .map((e) =>
            e.kind === "literal"
              ? e.raw
              : e.kind === "group"
                ? "(" +
                  pipeString(e.pipe) +
                  ")" +
                  e.fields.map((f) => "." + f).join("")
                : e.value,
          )
          .join(" "),
      )
      .join(" | ")
  );
}
export function treeString(nodes: Node[], quoteText = false): string {
  return nodes
    .map((n) => {
      const left = n.left ?? "{{",
        right = n.right ?? "}}";
      if (n.kind === "text") return quoteText ? JSON.stringify(n.text) : n.text;
      if (n.kind === "comment") return left + n.text + right;
      if (n.kind === "action") return left + pipeString(n.pipe!) + right;
      if (n.kind === "template")
        return (
          left +
          "template " +
          JSON.stringify(n.name) +
          (n.pipe ? " " + pipeString(n.pipe) : "") +
          right
        );
      if (n.kind === "break" || n.kind === "continue")
        return left + n.kind + right;
      return (
        left +
        n.kind +
        " " +
        pipeString(n.pipe!) +
        right +
        treeString(n.body!, quoteText) +
        (n.otherwise?.length
          ? left + "else" + right + treeString(n.otherwise, quoteText)
          : "") +
        left +
        "end" +
        right
      );
    })
    .join("");
}
export function errorContext(tree: Tree, node: Node): [string, string] {
  const prefix = tree.source.slice(0, node.pos);
  return [
    `${tree.parseName ?? tree.name}:${prefix.split("\n").length}:${Buffer.byteLength(prefix.slice(prefix.lastIndexOf("\n") + 1))}`,
    treeString([node]),
  ];
}

export interface NumberNode {
  Text: string;
  IsInt: boolean;
  IsUint: boolean;
  IsFloat: boolean;
  IsComplex: boolean;
  Int64: bigint;
  Uint64: bigint;
  Float64: number;
  Complex128: [number, number];
}
export function parseNumber(text: string): NumberNode {
  const parsed = numberLiteral(text),
    n = Number(parsed.value),
    isComplex = parsed.imaginary !== undefined,
    isFloat = !isComplex || parsed.imaginary === 0;
  const integer = isFloat && Number.isInteger(n);
  let isInt = integer && n >= -(2 ** 63) && n < 2 ** 63,
    isUint = integer && n >= 0 && n < 2 ** 64;
  if (typeof parsed.value === "bigint") {
    isInt = parsed.value >= -(1n << 63n) && parsed.value < 1n << 63n;
    isUint =
      parsed.value >= 0n &&
      parsed.value < 1n << 64n &&
      (!/^[+-]/.test(text) || parsed.value === 0n);
  }
  return {
    Text: text,
    IsInt: isInt,
    IsUint: isUint,
    IsFloat: isFloat,
    IsComplex: isComplex,
    Int64: isInt ? BigInt(parsed.value) : 0n,
    Uint64: isUint ? BigInt(parsed.value) : 0n,
    Float64: isFloat ? n : 0,
    Complex128: isComplex ? [n, parsed.imaginary!] : [0, 0],
  };
}
