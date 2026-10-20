import { readFileSync, globSync } from "node:fs";
import { basename } from "node:path";
import {
  parse,
  isEmpty,
  treeString,
  pipeString,
  type Tree,
  type Node,
  type Pipe,
  type Expr,
} from "./parse.js";
import {
  isValue,
  isNumber,
  isFunc,
  indirect,
  plain,
  format,
  truth,
  invoke,
  entries,
  kindOf,
  zero,
  typeOf,
} from "./value.js";
import { builtins, arity } from "./funcs.js";
export * from "./value.js";
export * from "./funcs.js";
export {
  parse,
  treeString,
  pipeString,
  numberLiteral,
  tokenize,
  type Tree,
  type Node,
  type Pipe,
} from "./parse.js";
export type FuncMap = Record<
  string,
  ((...args: any[]) => unknown) | import("./value.js").GoFunction
>;
export interface Writer {
  write(chunk: string): unknown;
}
export class ExecError extends Error {
  constructor(
    public templateName: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ExecError";
  }
  Unwrap() {
    return this.cause;
  }
}
class WriteFailure {
  constructor(public error: unknown) {}
}
class EvaluationFailure extends Error {
  constructor(
    public cause: unknown,
    public expression: string,
    public pos: number,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
  }
}
class Scope {
  values = new Map<string, any>();
  constructor(public parent?: Scope) {}
  get(name: string): any {
    if (this.values.has(name)) return this.values.get(name);
    if (this.parent) return this.parent.get(name);
    throw Error(`undefined variable: ${name}`);
  }
  set(name: string, v: any, assign = false): void {
    if (!assign || this.values.has(name)) {
      this.values.set(name, v);
      return;
    }
    if (this.parent) {
      this.parent.set(name, v, true);
      return;
    }
    throw Error(`undefined variable: ${name}`);
  }
}
const BREAK = Symbol("break"),
  CONTINUE = Symbol("continue");
interface State {
  dot: any;
  scope: Scope;
  depth: number;
  write: (s: string) => void;
  template: Template;
  node?: Node;
}
export class Template {
  Tree?: Tree;
  private templates: Map<string, Template>;
  private functions: FuncMap = {};
  private left = "{{";
  private right = "}}";
  private missing = "invalid";
  constructor(
    private name = "",
    associated?: Map<string, Template>,
  ) {
    this.templates = associated ?? new Map();
  }
  Name() {
    return this.name;
  }
  New(name: string): Template {
    const t = new Template(name, this.templates);
    t.functions = this.functions;
    t.left = this.left;
    t.right = this.right;
    t.missing = this.missing;
    return t;
  }
  Funcs(funcs: FuncMap): this {
    for (const [key, fn] of Object.entries(funcs)) {
      if (!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(key))
        throw Error(`function name "${key}" is not a valid identifier`);
      if (typeof fn !== "function" && !isFunc(fn))
        throw Error(`value for ${key} not a function`);
      if (
        isFunc(fn) &&
        fn.returns !== undefined &&
        (fn.returns < 1 ||
          fn.returns > 2 ||
          (fn.returns === 2 && fn.secondReturn !== "error"))
      )
        throw Error(`invalid function signature for ${key}`);
      this.functions[key] = fn;
    }
    return this;
  }
  Delims(left: string, right: string): this {
    this.left = left || "{{";
    this.right = right || "}}";
    return this;
  }
  Option(...options: string[]): this {
    for (const o of options) {
      const [key, val] = o.split("=");
      if (
        key !== "missingkey" ||
        !["default", "invalid", "zero", "error"].includes(val)
      )
        throw Error(`unrecognized option: ${o}`);
      this.missing = val;
      for (const t of this.templates.values()) t.missing = val;
    }
    return this;
  }
  Parse(source: string): this {
    let trees: Map<string, Tree>;
    try {
      trees = parse(
        this.name,
        source,
        Object.keys(this.functions),
        this.left,
        this.right,
      );
    } catch (e) {
      throw Error(
        `template: ${this.name}: ${e instanceof Error ? e.message : e}`,
        { cause: e },
      );
    }
    for (const [name, tree] of trees) {
      const existing = this.templates.get(name);
      if (
        existing?.Tree &&
        !isEmpty(existing.Tree.nodes) &&
        isEmpty(tree.nodes) &&
        (name !== this.name || existing === this)
      )
        continue;
      const target = name === this.name ? this : (existing ?? this.New(name));
      target.Tree = tree;
      this.templates.set(name, target);
    }
    return this;
  }
  AddParseTree(name: string, tree: Tree): Template {
    const target =
      name === this.name ? this : (this.templates.get(name) ?? this.New(name));
    if (!target.Tree || !isEmpty(tree.nodes)) target.Tree = tree;
    this.templates.set(name, target);
    return target;
  }
  Lookup(name: string): Template | undefined {
    return this.templates.get(name);
  }
  Templates(): Template[] {
    return [...this.templates.values()];
  }
  DefinedTemplates(): string {
    const names = this.Templates()
      .filter((t) => t.Tree)
      .map((t) => JSON.stringify(t.Name()));
    return names.length ? "; defined templates are: " + names.join(", ") : "";
  }
  Clone(): Template {
    const t = new Template(this.name);
    t.functions = { ...this.functions };
    t.left = this.left;
    t.right = this.right;
    t.missing = this.missing;
    for (const old of this.Templates()) {
      const next = old.name === this.name ? t : t.New(old.name);
      next.Tree = old.Tree;
      t.templates.set(old.name, next);
    }
    t.Tree = this.Tree;
    return t;
  }
  Execute(data?: unknown): string;
  Execute(writer: Writer | null, data: unknown): void;
  Execute(a?: unknown, b?: unknown): string | void {
    const writer = arguments.length >= 2 ? (a as Writer | null) : undefined,
      data = arguments.length >= 2 ? b : a;
    let out = "";
    const write = writer
      ? (s: string) => {
          try {
            writer.write(s);
          } catch (e) {
            throw new WriteFailure(e);
          }
        }
      : (s: string) => {
          out += s;
        };
    const scope = new Scope();
    scope.set("$", data);
    try {
      this.run({ dot: data, scope, depth: 0, write, template: this });
    } catch (e) {
      if (e instanceof WriteFailure) throw e.error;
      throw e;
    }
    if (arguments.length < 2) return out;
  }
  ExecuteTemplate(name: string, data?: unknown): string;
  ExecuteTemplate(writer: Writer | null, name: string, data: unknown): void;
  ExecuteTemplate(a: any, b?: any, c?: any): string | void {
    const hasWriter = arguments.length === 3,
      name = hasWriter ? b : a,
      data = hasWriter ? c : b;
    const tmpl = this.Lookup(name);
    if (!tmpl)
      throw Error(
        `template: no template "${name}" associated with template "${this.name}"`,
      );
    return hasWriter ? tmpl.Execute(a, data) : tmpl.Execute(data);
  }
  ParseFiles(...files: string[]): this {
    if (!files.length) throw Error("no files named in call to ParseFiles");
    for (const file of files) {
      const name = basename(file),
        target =
          name === this.name ? this : (this.Lookup(name) ?? this.New(name));
      target.Parse(readFileSync(file, "utf8"));
    }
    return this;
  }
  ParseGlob(pattern: string): this {
    const files = [...globSync(pattern)].sort();
    if (!files.length) throw Error(`pattern matches no files: ${pattern}`);
    return this.ParseFiles(...files);
  }
  ParseFS(
    fs:
      | Record<string, string>
      | { readFile(name: string): string; glob(pattern: string): string[] },
    ...patterns: string[]
  ): this {
    for (const pattern of patterns) {
      let names: string[];
      if ("glob" in fs && typeof fs.glob === "function")
        names = fs.glob(pattern);
      else {
        const re = new RegExp(
          "^" +
            pattern
              .replace(/[.+^${}()|[\]\\]/g, "\\$&")
              .replaceAll("*", "[^/]*")
              .replaceAll("?", "[^/]") +
            "$",
        );
        names = Object.keys(fs)
          .filter((n) => re.test(n))
          .sort();
      }
      if (!names.length) throw Error(`pattern matches no files: ${pattern}`);
      for (const name of names) {
        const text =
          "readFile" in fs && typeof fs.readFile === "function"
            ? fs.readFile(name)
            : (fs as Record<string, string>)[name];
        const base = basename(name);
        (base === this.name
          ? this
          : (this.Lookup(base) ?? this.New(base))
        ).Parse(text);
      }
    }
    return this;
  }
  private run(s: State): void {
    if (!this.Tree)
      throw new ExecError(
        this.name,
        `template: ${this.name}: "${this.name}" is an incomplete or empty template`,
      );
    if (s.depth > 1000) throw Error("exceeded maximum template depth");
    this.walk(this.Tree.nodes, s);
  }
  private walk(nodes: Node[], s: State): void {
    for (const n of nodes) {
      s.node = n;
      try {
        switch (n.kind) {
          case "text":
            s.write(n.text!);
            break;
          case "break":
            throw BREAK;
          case "continue":
            throw CONTINUE;
          case "action": {
            const v = this.evalPipe(n.pipe!, s);
            if (!n.pipe!.decl.length) {
              if (
                isFunc(v) ||
                typeof v === "function" ||
                (isValue(v) && v.kind === "func")
              )
                throw Error("can't print function");
              s.write(format(v));
            }
            break;
          }
          case "if":
          case "with": {
            const inner = { ...s, scope: new Scope(s.scope) };
            const v = this.evalPipe(n.pipe!, inner);
            this.walk(truth(v) ? n.body! : n.otherwise!, {
              ...inner,
              dot: n.kind === "with" && truth(v) ? v : s.dot,
            });
            break;
          }
          case "range": {
            const inner = { ...s, scope: new Scope(s.scope) };
            const v = this.evalPipe(n.pipe!, inner);
            if (
              n.pipe!.decl.length === 2 &&
              /^(u?int\d*|uintptr)$/.test(kindOf(v))
            )
              throw Error("range over integer permits only one variable");
            if (
              n.pipe!.decl.length === 2 &&
              isValue(v) &&
              v.kind === "iterator" &&
              !v.type.startsWith("iter.Seq2")
            )
              throw Error("range over iter.Seq permits only one variable");
            const es = entries(v);
            if (!es.length) this.walk(n.otherwise!, inner);
            else
              for (const [key, val] of es) {
                const iter = {
                  ...inner,
                  dot: val,
                  scope: new Scope(inner.scope),
                };
                const decl = n.pipe!.decl;
                if (decl.length === 2) {
                  inner.scope.set(decl[0], key, true);
                  inner.scope.set(decl[1], val, true);
                } else if (decl.length)
                  inner.scope.set(
                    decl[0],
                    isValue(v) &&
                      v.kind === "iterator" &&
                      v.type.startsWith("iter.Seq2")
                      ? key
                      : val,
                    true,
                  );
                try {
                  this.walk(n.body!, iter);
                } catch (e) {
                  if (e === BREAK) break;
                  if (e !== CONTINUE) throw e;
                }
              }
            break;
          }
          case "template": {
            const t = this.Lookup(n.name!);
            if (!t) throw Error(`template "${n.name}" not defined`);
            const v = n.pipe ? this.evalPipe(n.pipe, s) : null,
              scope = new Scope();
            scope.set("$", v);
            t.run({ ...s, scope, dot: v, depth: s.depth + 1, template: t });
            break;
          }
        }
      } catch (e) {
        if (
          e === BREAK ||
          e === CONTINUE ||
          e instanceof ExecError ||
          e instanceof WriteFailure
        )
          throw e;
        const failure = e instanceof EvaluationFailure ? e : undefined;
        const source = this.Tree!.source.slice(0, failure?.pos ?? n.pos),
          line = source.split("\n").length,
          col = Buffer.byteLength(source.slice(source.lastIndexOf("\n") + 1));
        throw new ExecError(
          this.name,
          `template: ${this.Tree!.parseName ?? this.Tree!.name}:${line}:${col}: executing "${this.name}" at <${failure?.expression ?? (n.pipe ? pipeString(n.pipe) : (n.name ?? n.kind))}>: ${e instanceof Error ? e.message : String(e)}`,
          { cause: failure?.cause ?? e },
        );
      }
    }
  }
  private evalPipe(p: Pipe, s: State): any {
    let result: any;
    for (let i = 0; i < p.commands.length; i++)
      result = this.command(p.commands[i], s, i > 0, result);
    for (const d of p.decl) s.scope.set(d, result, p.assign);
    return result;
  }
  private command(cmd: Expr[], s: State, hasFinal = false, final?: any): any {
    try {
      return this.commandInner(cmd, s, hasFinal, final);
    } catch (e) {
      if (e instanceof EvaluationFailure) throw e;
      throw new EvaluationFailure(
        e,
        pipeString({ decl: [], assign: false, commands: [cmd] }),
        cmd[0].pos ?? s.node?.pos ?? 0,
      );
    }
  }
  private commandInner(
    cmd: Expr[],
    s: State,
    hasFinal = false,
    final?: any,
  ): any {
    const first = cmd[0];
    if (
      first.kind === "ident" &&
      (first.value === "and" || first.value === "or") &&
      !this.functions[first.value]
    ) {
      if (cmd.length === 1 && !hasFinal) throw Error("wrong number of args");
      let v: any;
      for (const e of cmd.slice(1)) {
        v = this.eval(e, s);
        if (truth(v) === (first.value === "or")) return v;
      }
      return hasFinal ? final : v;
    }
    const args = cmd.slice(1).map((e) => this.eval(e, s));
    if (hasFinal) args.push(final);
    if (first.kind === "ident") {
      const custom = this.functions[first.value];
      if (custom) {
        try {
          return invoke(custom, args);
        } catch (e) {
          throw new Error(
            `error calling ${first.value}: ${e instanceof Error ? e.message : e}`,
            { cause: e },
          );
        }
      }
      const fn = builtins[first.value];
      if (!fn) throw Error(`function ${first.value} not defined`);
      const bounds = arity[first.value];
      if (bounds && (args.length < bounds[0] || args.length > bounds[1]))
        throw Error(
          `wrong number of args for ${first.value}: want ${bounds[0] === bounds[1] ? "" : "at least "}${bounds[0]} got ${args.length}`,
        );
      try {
        if (first.value === "call") return this.call(args, cmd.slice(1));
        return fn(...args);
      } catch (e) {
        throw Error(
          `error calling ${first.value}: ${e instanceof Error ? e.message : e}`,
          { cause: e },
        );
      }
    }
    if (first.kind === "path") {
      try {
        return this.path(first.value, s, args);
      } catch (e) {
        throw new EvaluationFailure(
          e,
          first.value,
          (first.pos ?? 0) + Math.max(0, first.value.lastIndexOf(".")),
        );
      }
    }
    if (first.kind === "group") {
      let v = this.evalPipe(first.pipe, s);
      for (let i = 0; i < first.fields.length; i++)
        v = this.field(
          v,
          first.fields[i],
          i === first.fields.length - 1 ? args : [],
        );
      if (!first.fields.length && args.length)
        throw Error("cannot give argument to non-function");
      return v;
    }
    if (args.length) throw Error("non-function in command");
    if (first.value === null) throw Error("nil is not a command");
    return this.eval(first, s);
  }
  private eval(e: Expr, s: State): any {
    if (e.kind === "literal") {
      if (
        isNumber(e.value) &&
        typeof e.value.value === "bigint" &&
        e.value.value > (1n << 63n) - 1n
      )
        throw Error("overflows int");
      return e.value;
    }
    if (e.kind === "ident") return this.command([e], s);
    if (e.kind === "path") {
      try {
        return this.path(e.value, s, []);
      } catch (error) {
        throw new EvaluationFailure(
          error,
          e.value,
          (e.pos ?? 0) + Math.max(0, e.value.lastIndexOf(".")),
        );
      }
    }
    let v = this.evalPipe(e.pipe, s);
    for (const f of e.fields) v = this.field(v, f, []);
    return v;
  }
  private path(path: string, s: State, args: any[]): any {
    if (path === ".") {
      if (args.length) throw Error("cannot give argument to non-function .");
      return s.dot;
    }
    const parts = path.split(".");
    let v = path[0] === "$" ? s.scope.get(parts.shift()!) : s.dot;
    if (path[0] === ".") parts.shift();
    if (!parts.length) {
      if (args.length) throw Error("cannot give argument to non-function");
      return v;
    }
    for (let i = 0; i < parts.length; i++)
      v = this.field(v, parts[i], i === parts.length - 1 ? args : []);
    return v;
  }
  private method(fn: any, name: string, args: any[]): any {
    try {
      return invoke(fn, args);
    } catch (e) {
      throw Error(
        `error calling ${name}: ${e instanceof Error ? e.message : e}`,
        { cause: e },
      );
    }
  }
  private call(args: any[], expressions: Expr[]): any {
    const [fn, ...rest] = args;
    const e = expressions[0];
    const name = e
      ? e.kind === "group"
        ? pipeString(e.pipe)
        : pipeString({ decl: [], assign: false, commands: [[e]] })
      : "call";
    if (fn == null) throw Error("call of nil");
    if (typeof fn !== "function" && !isFunc(fn))
      throw Error(`non-function ${name} of type ${typeOf(fn)}`);
    if (isFunc(fn)) {
      const min = fn.args.length - (fn.variadic ? 1 : 0);
      if (rest.length < min || (!fn.variadic && rest.length !== min))
        throw Error(
          `wrong number of args for ${name}: got ${rest.length} want ${fn.variadic ? "at least " : ""}${min}`,
        );
      if (fn.returns !== undefined) {
        if (fn.returns < 1 || fn.returns > 2)
          throw Error(
            `function ${name} has ${fn.returns} return values; should be 1 or 2`,
          );
        if (fn.returns === 2 && fn.secondReturn !== "error")
          throw Error(
            `invalid function signature for ${name}: second return value should be error; is ${fn.secondReturn}`,
          );
      }
    }
    return invoke(fn, rest);
  }

  private field(receiver: any, name: string, args: any[]): any {
    if (isValue(receiver) && receiver.methods?.[name])
      return this.method(receiver.methods[name], name, args);
    const v = indirect(receiver);
    if (v == null) {
      if (
        isValue(receiver) &&
        receiver.kind === "ptr" &&
        receiver.order &&
        !receiver.order.includes(name)
      )
        throw Error(`can't evaluate field ${name} in type ${typeOf(receiver)}`);
      if (receiver != null || this.missing === "error")
        throw Error(`nil pointer evaluating ${typeOf(receiver)}.${name}`);
      return null;
    }
    if (isValue(v) && v.methods?.[name])
      return this.method(v.methods[name], name, args);
    const p = plain(v),
      k = kindOf(v);
    let result: any;
    if (k === "struct") {
      if (!/^\p{Lu}/u.test(name)) throw Error(`${name} is an unexported field`);
      if (!Object.hasOwn(p, name)) {
        for (const embedded of (isValue(v) ? v.embedded : []) ?? []) {
          if (plain(p[embedded]) == null)
            throw Error(
              `reflect: indirection through nil pointer to embedded struct field ${embedded}`,
            );
          try {
            return this.field(p[embedded], name, args);
          } catch (e) {
            if (
              !(e instanceof Error) ||
              !e.message.includes("can't evaluate field")
            )
              throw e;
          }
        }
        throw Error(`can't evaluate field ${name} in type ${typeOf(receiver)}`);
      }
      result = p[name];
    } else if (k === "map") {
      if (isValue(v)) {
        if (v.keyType !== "string" && v.keyType !== "interface {}")
          throw Error(`can't evaluate field ${name}`);
        result = entries(v).find(([key]) => plain(key) === name)?.[1];
      } else
        result =
          p instanceof Map
            ? p.get(name)
            : Object.hasOwn(p, name)
              ? p[name]
              : undefined;
      if (result === undefined) {
        if (this.missing === "error")
          throw Error(`map has no entry for key "${name}"`);
        return this.missing === "zero"
          ? zero(isValue(v) ? v.elemType : undefined)
          : null;
      }
    } else {
      const proto = Object.getPrototypeOf(Object(p));
      if (
        proto &&
        Object.hasOwn(proto, name) &&
        typeof proto[name] === "function"
      )
        return invoke(proto[name].bind(p), args);
      throw Error(`can't evaluate field ${name} in type ${typeOf(receiver)}`);
    }
    if (args.length)
      throw Error(`${name} has arguments but cannot be invoked as function`);
    return result;
  }
}
export const New = (name: string) => new Template(name);
export const Must = (template: Template) => template;
export const IsTrue = (v: any): [boolean, boolean] => [truth(v), true];
export function ParseFiles(...files: string[]): Template {
  if (!files.length) throw Error("no files named in call to ParseFiles");
  return New(basename(files[0])).ParseFiles(...files);
}
export function ParseGlob(pattern: string): Template {
  const names = [...globSync(pattern)].sort();
  if (!names.length) throw Error("pattern matches no files");
  return ParseFiles(...names);
}
export function ParseFS(
  fs: Parameters<Template["ParseFS"]>[0],
  ...patterns: string[]
): Template {
  return New("").ParseFS(fs, ...patterns);
}
export const render = (source: string, data?: unknown, funcs: FuncMap = {}) =>
  New("template").Funcs(funcs).Parse(source).Execute(data);
