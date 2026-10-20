import { parseNumber } from "../src/parse.js";
import { lex } from "../src/lex.js";
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  parse,
  treeString,
  New,
  struct,
  int,
  typedNil,
  pointer,
  value,
} from "../src/index.js";
import { decode, functions } from "./fixtures.js";
const fixtures = JSON.parse(
  readFileSync(new URL("./fixtures/parse.json", import.meta.url), "utf8"),
);
for (const [i, c] of fixtures.parse.entries())
  test(`upstream parse ${i}: ${c.name}`, () => {
    const run = () =>
      parse(c.name, c.input, ["printf", "contains"], "{{", "}}", false, 3).get(
        c.name,
      )!;
    if (!c.ok) assert.throws(run);
    else {
      const t = run();
      assert.equal(treeString(t.nodes, true), c.result);
      assert.equal(treeString(structuredClone(t.nodes), true), c.result);
    }
  });
const comparisons = JSON.parse(
  readFileSync(new URL("./fixtures/comparison.json", import.meta.url), "utf8"),
);
const cmp = struct("cmpStruct", {
  Uthree: int(3, "uint"),
  Ufour: int(4, "uint"),
  NegOne: int(-1),
  Three: int(3),
  Ptr: pointer(int(0), "*int"),
  NilPtr: typedNil("*int"),
  NonNilMap: value("map[int]int", "map", [], {
    keyType: "int",
    elemType: "int",
  }),
  Map: typedNil("map[int]int", "map"),
  V1: struct("template.V", { j: int(0) }),
  V2: struct("template.V", { j: int(0) }),
  Iface1: pointer(struct("strings.Builder", {}), "*strings.Builder"),
  NilIface: null,
});
for (const [i, c] of comparisons.entries())
  test(`upstream comparison ${i}: ${c.expr}`, () => {
    const run = () =>
      New("empty")
        .Parse(`{{if ${c.expr}}}true{{else}}false{{end}}`)
        .Execute(cmp);
    if (c.ok) assert.equal(run(), c.truth);
    else assert.throws(run);
  });
const multi = JSON.parse(
  readFileSync(new URL("./fixtures/multi.json", import.meta.url), "utf8"),
);
for (const [i, c] of multi.exec.entries())
  test(`upstream multi execute ${i}: ${c.name}`, () => {
    const root = New("root").Funcs(functions);
    for (const source of multi.sources) root.Parse(source);
    const run = () => root.New(c.name).Parse(c.input).Execute(decode(c.data));
    if (c.ok) assert.equal(run(), c.output);
    else assert.throws(run);
  });
for (const [i, c] of multi.parse.entries())
  test(`upstream multi parse ${i}: ${c.name}`, () => {
    const run = () => New("root").Parse(c.input);
    if (!c.ok) assert.throws(run);
    else {
      const root = run();
      assert.equal(root.Templates().length, (c.names ?? []).length + 1);
      for (const [j, name] of (c.names ?? []).entries())
        assert.equal(treeString(root.Lookup(name)!.Tree!.nodes), c.results[j]);
    }
  });
for (const table of ["lex", "delims", "positions"])
  for (const [i, c] of fixtures[table].entries())
    test(`upstream ${table} ${i}: ${c.name}`, () => {
      const result = lex(
        c.input,
        table === "delims" ? "$$" : "{{",
        table === "delims" ? "@@" : "}}",
      );
      const clean = (items: any[]) =>
        table === "positions"
          ? items
          : items.map(({ type, value }) => ({ type, value }));
      assert.deepEqual(clean(result), clean(c.items));
    });
for (const [i, c] of fixtures.errors.entries())
  test(`upstream error ${i}: ${c.name}`, () => {
    assert.throws(
      () => parse(c.name, c.input),
      (e) => e instanceof Error && e.message.includes(c.result),
      c.result,
    );
  });

for (const [i, c] of fixtures.numbers.entries())
  test(`upstream number ${i}: ${c.text}`, () => {
    if (!c.isInt && !c.isUint && !c.isFloat && !c.isComplex) {
      assert.throws(() => parseNumber(c.text));
      return;
    }
    const n = parseNumber(c.text);
    assert.deepEqual(
      [n.IsInt, n.IsUint, n.IsFloat, n.IsComplex],
      [c.isInt, c.isUint, c.isFloat, c.isComplex],
    );
    if (c.isInt) assert.equal(n.Int64, BigInt(c.int));
    if (c.isUint) assert.equal(n.Uint64, BigInt(c.uint));
    if (c.isFloat) assert.equal(n.Float64, c.float);
    if (c.isComplex) assert.deepEqual(n.Complex128, c.complex);
  });
test("parse.TestDelimsAlphaNumeric", () =>
  assert.deepEqual(
    lex("{{hub .host hub}}", "{{hub", "hub}}").map(({ type, value }) => [
      type,
      value,
    ]),
    [
      ["left delim", "{{hub"],
      ["space", " "],
      ["field", ".host"],
      ["space", " "],
      ["right delim", "hub}}"],
      ["EOF", ""],
    ],
  ));
test("parse.TestDelimsAndMarkers", () =>
  assert.deepEqual(
    lex("{{- .x -}} {{- - .x - -}}", "{{- ", " -}}").map(({ type, value }) => [
      type,
      value,
    ]),
    [
      ["left delim", "{{- "],
      ["field", ".x"],
      ["right delim", " -}}"],
      ["left delim", "{{- "],
      ["field", ".x"],
      ["right delim", " -}}"],
      ["EOF", ""],
    ],
  ));
