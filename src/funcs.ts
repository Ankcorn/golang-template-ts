import {
  plain,
  format,
  print,
  kindOf,
  typeOf,
  isValue,
  isNumber,
  indirect,
  entries,
  zero,
  truth,
  invoke,
  compareKeys,
  value,
  int,
} from "./value.js";
export function HTMLEscapeString(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&#34;", "'": "&#39;" })[
        c
      ]!,
  );
}
export function JSEscapeString(s: string): string {
  return s.replace(/[\\'"<>&=\x00-\x1f\u2028\u2029\uFFFE\uFFFF]/g, (c) =>
    c === "\\"
      ? "\\\\"
      : c === "'"
        ? "\\'"
        : c === '"'
          ? '\\"'
          : "\\u" + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0"),
  );
}
export const HTMLEscaper = (...args: any[]) =>
  HTMLEscapeString(
    args.length === 1 && args[0] == null ? "<no value>" : print(args),
  );
export const JSEscaper = (...args: any[]) => JSEscapeString(print(args));
export const URLQueryEscaper = (...args: any[]) =>
  encodeURIComponent(print(args))
    .replace(
      /[!'()*]/g,
      (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
    )
    .replace(/%20/g, "+");
export function printf(formatValue: any, ...args: any[]): string {
  const fmt = plain(formatValue);
  if (typeof fmt !== "string") throw Error("expected string");
  let cursor = 0;
  const used = new Set<number>();
  let result = fmt.replace(
    /%(%|(?:\[(\d+)\])?([+# 0-]*)(\d+|\*)?(?:\.(\d+|\*))?([vTtbcdoOxXUeEfFgGspq]))/g,
    (whole, all, index, flags, width, precision, verb) => {
      if (all === "%") return "%";
      if (index) cursor = Number(index) - 1;
      if (width === "*") {
        used.add(cursor);
        width = String(Number(plain(args[cursor++])));
      }
      if (precision === "*") {
        used.add(cursor);
        precision = String(Number(plain(args[cursor++])));
      }
      if (cursor >= args.length) return `%!${verb}(MISSING)`;
      used.add(cursor);
      const arg = args[cursor++],
        p = plain(arg),
        type = typeOf(arg);
      if (arg == null && !["v", "T"].includes(verb)) return `%!${verb}(<nil>)`;
      const integer = /^(u?int\d*|uintptr)$/.test(type);
      const bad = () => {
        let display = format(arg);
        if (integer && precision !== undefined) {
          const negative = display.startsWith("-");
          display =
            (negative ? "-" : "") +
            (negative ? display.slice(1) : display).padStart(
              Number(precision),
              "0",
            );
        }
        return `%!${verb}(${type}=${display})`;
      };
      let out = "";
      const numeric = typeof p === "number" || typeof p === "bigint";
      switch (verb) {
        case "T":
          out = type;
          break;
        case "v":
          out = arg == null ? "<nil>" : format(arg, flags.includes("+"));
          if (flags.includes("#") && typeof p === "string")
            out = JSON.stringify(p);
          break;
        case "s":
          out =
            typeof p === "string"
              ? p
              : Array.isArray(p)
                ? String.fromCharCode(...p.map(Number))
                : `%!s(${type}=${format(arg)})`;
          if (precision) out = [...out].slice(0, Number(precision)).join("");
          break;
        case "q":
          out =
            typeof p === "string"
              ? flags.includes("#") && !/[`\x00-\x1f]/.test(p)
                ? "`" + p + "`"
                : JSON.stringify(p)
              : integer
                ? quoteRune(Number(p))
                : `%!q(${type}=${format(arg)})`;
          break;
        case "t":
          out =
            typeof p === "boolean" ? String(p) : `%!t(${type}=${format(arg)})`;
          break;
        case "c":
          out = integer ? rune(Number(p)) : `%!c(${type}=${format(arg)})`;
          break;
        case "d":
        case "b":
        case "o":
        case "O":
        case "x":
        case "X":
        case "U": {
          if (typeof p === "string" && (verb === "x" || verb === "X")) {
            out = Buffer.from(p).toString("hex");
            if (verb === "X") out = out.toUpperCase();
            break;
          }
          if (type.startsWith("float") && (verb === "x" || verb === "X")) {
            const n = Number(p),
              exponent = n === 0 ? 0 : Math.floor(Math.log2(Math.abs(n))),
              mantissa =
                n === 0 ? "0" : (Math.abs(n) / 2 ** exponent).toString(16);
            out =
              (n < 0 ? "-" : "") +
              "0x" +
              mantissa +
              "p" +
              (exponent < 0 ? "-" : "+") +
              String(Math.abs(exponent)).padStart(2, "0");
            if (verb === "X") out = out.toUpperCase();
            break;
          }
          if (!integer) {
            out = bad();
            break;
          }
          const base =
            verb === "b"
              ? 2
              : verb === "o" || verb === "O"
                ? 8
                : verb === "x" || verb === "X" || verb === "U"
                  ? 16
                  : 10;
          out = BigInt(p).toString(base);
          if (precision) out = out.padStart(Number(precision), "0");
          if (verb === "X" || verb === "U") out = out.toUpperCase();
          if (verb === "U") out = "U+" + out.padStart(4, "0");
          else if (verb === "O") out = "0o" + out;
          else if (flags.includes("#"))
            out =
              (verb === "x"
                ? "0x"
                : verb === "X"
                  ? "0X"
                  : verb === "o"
                    ? "0"
                    : verb === "b"
                      ? "0b"
                      : "") + out;
          break;
        }
        case "f":
        case "F":
        case "e":
        case "E":
        case "g":
        case "G":
          if (type.startsWith("complex")) {
            out = format(arg);
            break;
          }
          if (!type.startsWith("float")) {
            out = bad();
            break;
          }
          const n = Number(p),
            prec = precision === undefined ? 6 : Number(precision);
          out =
            verb.toLowerCase() === "f"
              ? n.toFixed(prec)
              : verb.toLowerCase() === "e"
                ? n.toExponential(prec)
                : precision === undefined
                  ? String(n)
                  : n.toPrecision(prec);
          out = out.replace(/e([+-])(\d)$/, "e$10$2");
          if (verb === verb.toUpperCase()) out = out.toUpperCase();
          break;
        default:
          out = `%!${verb}(${type}=${format(arg)})`;
      }
      if (
        numeric &&
        Number(p) >= 0 &&
        verb !== "v" &&
        verb !== "T" &&
        !out.startsWith("%!")
      ) {
        if (flags.includes("+")) out = "+" + out;
        else if (flags.includes(" ")) out = " " + out;
      }
      if (width && !out.startsWith("%!")) {
        const w = Number(width);
        out =
          flags.includes("-") || w < 0
            ? out.padEnd(Math.abs(w), " ")
            : flags.includes("0") && out.startsWith("-")
              ? "-" + out.slice(1).padStart(w - 1, "0")
              : out.padStart(w, flags.includes("0") ? "0" : " ");
      }
      return out;
    },
  );
  const extra = args.filter((_, i) => !used.has(i));
  if (extra.length)
    result +=
      "%!(EXTRA " +
      extra.map((a) => typeOf(a) + "=" + format(a)).join(", ") +
      ")";
  return result;
}
function comparison(op: string, args: any[]): boolean {
  if (args.length < 2 || (op !== "eq" && args.length !== 2))
    throw Error("wrong number of args");
  const a = args[0];
  return args.slice(1).some((b) => {
    const ka = isValue(a) && a.kind === "ptr" ? "ptr" : kindOf(a),
      kb = isValue(b) && b.kind === "ptr" ? "ptr" : kindOf(b),
      x = plain(a),
      y = plain(b);
    const num = (k: string) => /^(u?int\d*|uintptr)$/.test(k);
    let equal: boolean;
    if (x == null || y == null) {
      if (op !== "eq" && op !== "ne")
        throw Error("invalid type for comparison");
      if (a != null && b != null) {
        const nullable = ["ptr", "map", "slice", "func", "chan", "interface"];
        if (
          (x != null && !nullable.includes(ka)) ||
          (y != null && !nullable.includes(kb))
        )
          throw Error("invalid type for comparison");
      }
      equal = x == null && y == null;
    } else {
      if (
        ka !== kb &&
        !(num(ka) && num(kb)) &&
        !(ka.startsWith("float") && kb.startsWith("float")) &&
        !(ka.startsWith("complex") && kb.startsWith("complex"))
      )
        throw Error("incompatible types for comparison");
      if (["map", "slice", "func"].includes(ka))
        throw Error("non-comparable type");
      equal =
        ka === "struct"
          ? JSON.stringify(a, (_, v) =>
              typeof v === "bigint" ? v.toString() : v,
            ) ===
            JSON.stringify(b, (_, v) =>
              typeof v === "bigint" ? v.toString() : v,
            )
          : ka === "ptr"
            ? a === b
            : num(ka) && num(kb)
              ? BigInt(x) === BigInt(y)
              : ka.startsWith("complex")
                ? x[0] === y[0] && x[1] === y[1]
                : x === y;
    }
    if (op === "eq") return equal;
    if (op === "ne") return !equal;
    if (!num(ka) && !ka.startsWith("float") && ka !== "string")
      throw Error("invalid type for comparison");
    return op === "lt"
      ? x < y
      : op === "le"
        ? x <= y
        : op === "gt"
          ? x > y
          : x >= y;
  });
}

export function index(item: any, ...indices: any[]): any {
  let current = item;
  for (const idx of indices) {
    const v = indirect(current),
      p = plain(v),
      k = kindOf(v),
      key = plain(idx);
    if (p == null) throw Error("index of untyped nil");
    if (k === "map") {
      if (isValue(v)) {
        if (
          v.keyType &&
          v.keyType !== "interface {}" &&
          kindOf(idx) !== v.keyType &&
          !(typeof key === "string" && v.keyType === "string") &&
          !(
            /^(u?int\d*|uintptr)$/.test(v.keyType) &&
            /^(u?int\d*|uintptr)$/.test(kindOf(idx))
          )
        )
          throw Error("wrong type for index");
        const pair = entries(v).find(([a]) => plain(a) == key);
        current = pair ? pair[1] : zero(v.elemType);
      } else {
        if (!(p instanceof Map) && typeof key !== "string")
          throw Error(`value has type ${typeOf(idx)}; should be string`);
        current =
          p instanceof Map ? p.get(key) : Object.hasOwn(p, key) ? p[key] : null;
      }
    } else if (k === "slice" || k === "array" || k === "string") {
      if (!/^(u?int\d*|uintptr)$/.test(kindOf(idx)))
        throw Error("cannot index with non-integer");
      const n = Number(key),
        data = k === "string" ? Buffer.from(p) : p;
      if (n < 0 || n >= data.length) throw Error(`index out of range: ${n}`);
      current = data[n];
    } else throw Error(`can't index item of type ${typeOf(v)}`);
  }
  return current;
}
export function slice(item: any, ...indices: any[]): any {
  if (indices.length > 3) throw Error("too many slice indexes");
  const v = indirect(item),
    p = plain(v),
    k = kindOf(v);
  if (!["slice", "array", "string"].includes(k)) throw Error("cannot slice");
  if (k === "string" && indices.length === 3)
    throw Error("cannot 3-index slice a string");
  const data = k === "string" ? Buffer.from(p) : (p ?? []),
    cap = isValue(v) ? (v.cap ?? data.length) : data.length;
  const bounds = indices.map((x) => {
    if (!/^(u?int\d*|uintptr)$/.test(kindOf(x)))
      throw Error("invalid slice index");
    return Number(plain(x));
  });
  const [lo = 0, hi = data.length, max = cap] = bounds;
  if (lo < 0 || hi < lo || max < hi || max > cap)
    throw Error("slice index out of bounds");
  const result = data.slice(lo, hi);
  if (k === "string") return result.toString();
  while (result.length < hi - lo)
    result.push(isValue(v) ? zero(v.type.replace(/^\[.*?\]/, "")) : 0);
  return isValue(v)
    ? value(v.type.replace(/^\[\d+\]/, "[]"), "slice", result, {
        cap: max - lo,
      })
    : result;
}
export const builtins: Record<string, (...args: any[]) => any> = {
  html: HTMLEscaper,
  js: JSEscaper,
  urlquery: URLQueryEscaper,
  print: (...a) => print(a),
  println: (...a) => print(a, true) + "\n",
  printf,
  index,
  slice,
  call: (f, ...a) => invoke(f, a),
  len: (v) => {
    const k = kindOf(v),
      p = plain(v);
    if (!["map", "slice", "array", "string", "chan"].includes(k))
      throw Error("len of invalid type");
    return k === "map"
      ? entries(v).length
      : k === "string"
        ? Buffer.byteLength(p)
        : (p?.length ?? 0);
  },
  not: (v) => !truth(v),
  ...Object.fromEntries(
    ["eq", "ne", "lt", "le", "gt", "ge"].map((k) => [
      k,
      (...args: any[]) => comparison(k, args),
    ]),
  ),
};
export const arity: Record<string, [number, number]> = {
  len: [1, 1],
  not: [1, 1],
  index: [1, Infinity],
  slice: [1, 4],
  call: [1, Infinity],
  printf: [1, Infinity],
  eq: [2, Infinity],
  ne: [2, 2],
  lt: [2, 2],
  le: [2, 2],
  gt: [2, 2],
  ge: [2, 2],
  and: [1, Infinity],
  or: [1, Infinity],
};

export function HTMLEscape(
  writer: { write(s: string): unknown },
  bytes: Uint8Array,
): void {
  writer.write(HTMLEscapeString(Buffer.from(bytes).toString()));
}
export function JSEscape(
  writer: { write(s: string): unknown },
  bytes: Uint8Array,
): void {
  writer.write(JSEscapeString(Buffer.from(bytes).toString()));
}

function rune(n: number): string {
  return String.fromCodePoint(
    n < 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff) ? 0xfffd : n,
  );
}
function quoteRune(n: number): string {
  const c = rune(n);
  const escapes: Record<string, string> = {
    "\x07": "\\a",
    "\b": "\\b",
    "\f": "\\f",
    "\n": "\\n",
    "\r": "\\r",
    "\t": "\\t",
    "\x0b": "\\v",
    "'": "\\'",
    "\\": "\\\\",
  };
  return (
    "'" +
    (escapes[c] ??
      ((n >= 0 && n < 32) || n === 127
        ? "\\x" + n.toString(16).padStart(2, "0")
        : c)) +
    "'"
  );
}
