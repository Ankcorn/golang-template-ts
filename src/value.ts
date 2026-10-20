import type { NumberLiteral } from "./parse.js";
export interface GoValue {
  goValue: true;
  type: string;
  kind: string;
  value?: any;
  nil?: boolean;
  cap?: number;
  keyType?: string;
  elemType?: string;
  order?: string[];
  embedded?: string[];
  string?: string;
  methods?: Record<string, GoFunction | ((...args: any[]) => unknown)>;
}
export interface GoFunction {
  goFunction: true;
  fn: (...args: any[]) => unknown;
  args: string[];
  variadic?: boolean;
  returns?: number;
  secondReturn?: string;
  raw?: boolean;
}
export const value = (
  type: string,
  kind: string,
  data?: unknown,
  extra: Partial<GoValue> = {},
): GoValue => ({ goValue: true, type, kind, value: data, ...extra });
export const int = (n: number | bigint | string, type = "int") =>
  value(type, type, BigInt(n));
export const uint = (n: number | bigint | string, type = "uint") =>
  int(n, type);
export const float = (n: number, type = "float64") => value(type, type, n);
export const complex = (real: number, imaginary: number) =>
  value("complex128", "complex128", [real, imaginary]);
export const pointer = (v: unknown, type = "*any") =>
  value(type, "ptr", v, { nil: v == null });
export const typedNil = (type: string, kind = "ptr") =>
  value(type, kind, undefined, { nil: true });
export const struct = (
  type: string,
  fields: Record<string, unknown>,
  methods: GoValue["methods"] = {},
  embedded: string[] = [],
) =>
  value(type, "struct", fields, {
    order: Object.keys(fields),
    methods,
    embedded,
  });
export function func(
  fn: GoFunction["fn"],
  args: string[] = [],
  options: Partial<GoFunction> = {},
): GoFunction {
  return { goFunction: true, fn, args, ...options };
}
export function isValue(v: any): v is GoValue {
  return !!v && v.goValue === true;
}
export function isNumber(v: any): v is NumberLiteral {
  return !!v && v.goNumber === true;
}
export function isFunc(v: any): v is GoFunction {
  return !!v && v.goFunction === true;
}
export function indirect(v: any): any {
  while (isValue(v) && (v.kind === "ptr" || v.kind === "interface")) {
    if (v.nil) return null;
    v = v.value;
  }
  return v;
}
export function plain(v: any): any {
  v = indirect(v);
  if (isNumber(v))
    return v.imaginary !== undefined ? [Number(v.value), v.imaginary] : v.value;
  if (isValue(v)) return v.nil ? null : v.value;
  return v;
}
export function typeOf(v: any): string {
  if (isNumber(v))
    return v.imaginary !== undefined
      ? "complex128"
      : v.raw[0] !== "'" &&
          /[.eEpP]/.test(v.raw) &&
          !/^[-+]?0[xX][\da-fA-F_]+$/.test(v.raw)
        ? "float64"
        : "int";
  if (isValue(v)) return v.type;
  if (v == null) return "<nil>";
  if (typeof v === "bigint") return "int";
  if (typeof v === "number") return Number.isInteger(v) ? "int" : "float64";
  if (typeof v === "boolean") return "bool";
  if (typeof v === "string") return "string";
  if (Array.isArray(v)) return "[]interface {}";
  if (v instanceof Map) return "map[interface {}]interface {}";
  if (typeof v === "function" || isFunc(v)) return "func";
  return "map[string]interface {}";
}
export function kindOf(v: any): string {
  v = indirect(v);
  if (isValue(v)) return v.kind;
  if (isNumber(v)) return v.imaginary !== undefined ? "complex128" : typeOf(v);
  if (Array.isArray(v)) return "slice";
  if (v instanceof Map || (v !== null && typeof v === "object" && !isFunc(v)))
    return "map";
  return typeof v === "number"
    ? Number.isInteger(v)
      ? "int"
      : "float64"
    : typeof v === "bigint"
      ? "int"
      : typeof v === "boolean"
        ? "bool"
        : typeof v;
}
export function truth(v: any): boolean {
  if (isValue(v) && v.kind === "ptr") return !v.nil;
  v = indirect(v);
  if (v == null) return false;
  if (isValue(v)) {
    if (v.nil) return false;
    if (v.kind === "struct") return true;
    if (v.kind === "chan" || v.kind === "func") return true;
    if (v.kind.startsWith("complex"))
      return v.value[0] !== 0 || v.value[1] !== 0;
    v = v.value;
  }
  if (isNumber(v)) return Number(v.value) !== 0 || (v.imaginary ?? 0) !== 0;
  if (Array.isArray(v) || typeof v === "string") return v.length > 0;
  if (v instanceof Map) return v.size > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return !!v;
}
export function compareKeys(a: any, b: any): number {
  const ka = kindOf(a),
    kb = kindOf(b);
  if (ka !== kb) return ka < kb ? -1 : 1;
  const x = plain(a),
    y = plain(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
export function entries(v: any): [any, any][] {
  v = indirect(v);
  const k = kindOf(v),
    p = plain(v);
  if (p == null) return [];
  if (k === "iterator")
    return p.map((e: any[]) => (e.length === 2 ? e : [undefined, e[0]]));
  if (k === "chan" && isValue(v) && v.type.startsWith("chan<-"))
    throw Error("range over send-only channel");
  if (k === "chan") return p.map((x: any, i: number) => [i, x]);
  if (k === "slice" || k === "array")
    return p.map((x: any, i: number) => [i, x]);
  if (k === "map") {
    const es = isValue(v)
      ? p
      : p instanceof Map
        ? [...p.entries()]
        : Object.entries(p);
    return [...es].sort((a, b) => compareKeys(a[0], b[0]));
  }
  if (/^(u?int\d*|uintptr)$/.test(k)) {
    const n = Number(p);
    return Array.from({ length: Math.max(0, n) }, (_, i) => [
      isValue(v) ? int(i, v.type) : i,
      isValue(v) ? int(i, v.type) : i,
    ]);
  }
  throw Error(`range can't iterate over ${format(v)}`);
}
export function zero(type = "any"): any {
  if (type === "string") return "";
  if (type === "bool") return false;
  if (/^(u?int\d*|uintptr)$/.test(type)) return int(0, type);
  if (type.startsWith("float")) return float(0, type);
  return null;
}
export function format(v: any, verbose = false): string {
  if (v == null) return "<no value>";
  if (isNumber(v)) {
    if (v.imaginary !== undefined)
      return "(" + v.value + (v.imaginary >= 0 ? "+" : "") + v.imaginary + "i)";
    return String(v.value);
  }
  if (isValue(v)) {
    if (v.string !== undefined) return v.string;
    if (v.nil) {
      if (v.kind === "interface") return "<no value>";
      if (v.kind === "map") return "map[]";
      if (v.kind === "slice") return "[]";
      return "<nil>";
    }
    if (v.kind === "ptr" || v.kind === "interface")
      return format(v.value, verbose);
    if (v.kind === "struct")
      return (
        "{" +
        (v.order ?? Object.keys(v.value))
          .map((k) => (verbose ? k + ":" : "") + format(v.value[k], verbose))
          .join(" ") +
        "}"
      );
    if (v.kind === "map")
      return (
        "map[" +
        entries(v)
          .map(([k, x]) => format(k) + ":" + format(x, verbose))
          .join(" ") +
        "]"
      );
    if (v.kind === "slice" || v.kind === "array")
      return "[" + v.value.map((x: any) => format(x, verbose)).join(" ") + "]";
    if (v.kind.startsWith("complex"))
      return (
        "(" + v.value[0] + (v.value[1] >= 0 ? "+" : "") + v.value[1] + "i)"
      );
    return String(v.value);
  }
  if (Array.isArray(v))
    return "[" + v.map((x) => format(x, verbose)).join(" ") + "]";
  if (v instanceof Map || (typeof v === "object" && !isFunc(v)))
    return (
      "map[" +
      entries(v)
        .map(([k, x]) => format(k) + ":" + format(x, verbose))
        .join(" ") +
      "]"
    );
  if (typeof v === "function" || isFunc(v)) throw Error("can't print function");
  return String(v);
}
export function print(args: any[], spaces = false): string {
  let out = "";
  for (let i = 0; i < args.length; i++) {
    if (
      i &&
      (spaces ||
        (kindOf(args[i - 1]) !== "string" && kindOf(args[i]) !== "string"))
    )
      out += " ";
    out += args[i] == null ? "<nil>" : format(args[i]);
  }
  return out;
}
export function invoke(fn: any, args: any[]): any {
  if (typeof fn === "function") return fn(...args.map(plain));
  if (!isFunc(fn)) throw Error("non-function");
  const min = fn.args.length - (fn.variadic ? 1 : 0);
  if (args.length < min || (!fn.variadic && args.length !== min))
    throw Error(`wrong number of args: want ${min} got ${args.length}`);
  if (
    fn.returns !== undefined &&
    (fn.returns < 1 ||
      fn.returns > 2 ||
      (fn.returns === 2 && fn.secondReturn !== "error"))
  )
    throw Error("invalid function signature");
  const converted = args.map((arg, i) => {
    const t =
      i < min ? fn.args[i] : fn.args[fn.args.length - 1]?.replace(/^\[\]/, "");
    if (!t || t === "any" || t === "interface {}" || t === "reflect.Value")
      return fn.raw ? arg : plain(arg);
    if (arg == null || (isValue(arg) && arg.nil)) {
      if (
        t[0] === "*" ||
        t.startsWith("[]") ||
        t.startsWith("map[") ||
        t.startsWith("func") ||
        t === "fmt.Stringer"
      )
        return fn.raw ? arg : null;
      throw Error(`cannot assign nil to ${t}`);
    }
    let a = indirect(arg);
    const k = kindOf(a);
    if (/^(u?int\d*|uintptr)$/.test(t)) {
      if (!/^(u?int\d*|uintptr)$/.test(k) && !isNumber(a))
        throw Error(`wrong type for value; expected ${t}`);
      const n = Number(plain(a));
      if (!Number.isInteger(n)) throw Error(`expected integer; found ${n}`);
      const bits = Number(t.match(/\d+/)?.[0] ?? 64);
      const b = BigInt(plain(a));
      if (
        b < (t[0] === "u" ? 0n : -(1n << BigInt(bits - 1))) ||
        b >
          (t[0] === "u"
            ? (1n << BigInt(bits)) - 1n
            : (1n << BigInt(bits - 1)) - 1n)
      )
        throw Error(`value overflows ${t}`);
      return fn.raw ? int(b, t) : Number(b);
    }
    if ((t === "string" && k !== "string") || (t === "bool" && k !== "bool"))
      throw Error(`wrong type for value; expected ${t}`);
    if (t.startsWith("[]") && !["slice", "array"].includes(k))
      throw Error(`wrong type for value; expected ${t}`);
    if (t === "fmt.Stringer" && !(isValue(arg) && arg.string !== undefined))
      throw Error("expected fmt.Stringer");
    return fn.raw ? arg : plain(a);
  });
  return fn.fn(...converted);
}
