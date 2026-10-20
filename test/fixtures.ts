import { readFileSync } from "node:fs";
const pool = JSON.parse(
  readFileSync(new URL("./fixtures/data.json", import.meta.url), "utf8"),
);
// Go-specific fixture values and callbacks from upstream exec_test.go.
// This adapter supplies data, never template results.
import {
  func,
  value,
  int,
  plain,
  indirect,
  format,
  print,
  typeOf,
  printf,
  New,
  type GoValue,
  type FuncMap,
} from "../src/index.js";
export function decode(d: any, field = ""): any {
  if (d == null) return null;
  if (d.$fixture) return decode(pool[d.$fixture], field);
  if (d.kind === "interface")
    return d.nil
      ? d.type === "interface {}"
        ? null
        : value(d.type, "interface", undefined, { nil: true })
      : decode(d.value, field);
  let v: any;
  if (d.kind === "func") {
    const callbacks: Record<string, (...a: any[]) => any> = {
      BinaryFunc: (a, b) => `[${a}=${b}]`,
      VariadicFunc: (...s) => "<" + s.join("+") + ">",
      VariadicFuncInt: (a, ...s) => `${a}=<${s.join("+")}>`,
      NilOKFunc: (s) => s == null,
      ErrFunc: () => "bla",
      PanicFunc: () => {
        throw Error("test panic");
      },
      TooFewReturnCountFunc: () => {},
      TooManyReturnCountFunc: () => {},
      InvalidReturnTypeFunc: () => {},
    };
    return func(
      callbacks[field] ??
        (() => {
          throw Error(`Unimplemented fixture function ${field}`);
        }),
      d.args,
      {
        variadic: d.variadic,
        returns: d.returns,
        secondReturn: d.secondReturn,
      },
    );
  }
  if (d.kind === "ptr") v = decode(d.value, field);
  else if (d.kind === "struct")
    v = Object.fromEntries(
      Object.entries(d.value ?? {}).map(([k, x]) => [k, decode(x, k)]),
    );
  else if (["map", "iterator"].includes(d.kind))
    v = d.value?.map((pair: any[]) => pair.map((x) => decode(x)));
  else if (["array", "slice", "chan"].includes(d.kind))
    v = d.value?.map((x: any) => decode(x));
  else if (/^(u?int\d*|uintptr)$/.test(d.kind)) v = BigInt(d.value ?? 0);
  else v = d.value;
  const out: GoValue = { ...d, goValue: true, value: v };
  if (d.type === "template.V") out.string = "<" + format(v.j) + ">";
  if (d.type === "*template.V" && d.nil) out.string = "nilV";
  if (d.type === "template.W") out.string = "[" + format(v.k) + "]";
  if (d.type === "*template.W" && d.nil) out.string = "nilW";
  if (d.kind === "unsafe.Pointer" && !d.nil) out.value = 1;
  if (d.type === "*template.T" || d.type === "template.T") {
    const fields = d.kind === "ptr" ? v?.value : v;
    out.order = Object.keys(
      fields ?? { True: 0, I: 0, U16: 0, X: 0, S: 0, U: 0 },
    );
    out.methods = {
      Method0: func(() => "M0"),
      Method1: func((a) => a, ["int"]),
      Method2: func((a, b) => `Method2: ${a} ${b}`, ["uint16", "string"]),
      Method3: func((a) => "Method3: " + print([a]), ["any"], { raw: true }),
      Copy: func(() => out),
      GetU: func(() => {
        if (!fields)
          throw Error(
            "runtime error: invalid memory address or nil pointer dereference",
          );
        return fields.U;
      }),
      MAdd: func(
        (a, b) => b.map((x: any) => Number(plain(x)) + a),
        ["int", "[]int"],
      ),
      MyError: func(
        (b) => {
          if (b) throw Error("my error");
          return false;
        },
        ["bool"],
      ),
    };
  }
  if (d.type === "*template.U" || d.type === "template.U")
    out.methods = { TrueFalse: func((b) => (b ? "true" : ""), ["bool"]) };
  if (d.type === "template.S") out.methods = { Method0: func(() => "M0") };
  return out;
}
export const functions: FuncMap = {
  add: func((...n) => n.reduce((a, b) => a + b, 0), ["[]int"], {
    variadic: true,
  }),
  count: func(
    (n) =>
      value(
        "chan string",
        "chan",
        Array.from({ length: n }, (_, i) => String.fromCharCode(97 + i)),
      ),
    ["int"],
  ),
  dddArg: func((a, ...s) => `${a} [${s.join(" ")}]\n`, ["int", "[]string"], {
    variadic: true,
  }),
  die: func(() => {
    throw Error("die");
  }),
  echo: func((a) => a, ["any"], { raw: true }),
  makemap: func(
    (...a) => {
      if (a.length % 2) throw Error("bad makemap");
      return Object.fromEntries(
        Array.from({ length: a.length / 2 }, (_, i) => [
          a[i * 2],
          a[i * 2 + 1],
        ]),
      );
    },
    ["[]string"],
    { variadic: true },
  ),
  mapOfThree: func(() => ({ three: 3 })),
  oneArg: func((a) => "oneArg=" + a, ["string"]),
  returnInt: func(() => int(7)),
  stringer: func((a) => format(a), ["fmt.Stringer"], { raw: true }),
  twoArgs: func((a, b) => "twoArgs=" + a + b, ["string", "string"]),
  typeOf: func((a) => typeOf(a), ["any"], { raw: true }),
  valueString: func(() => "value is ignored", ["string"]),
  vfunc: func(() => "vfunc", ["template.V", "*template.V"]),
  zeroArgs: func(() => "zeroArgs"),
};
