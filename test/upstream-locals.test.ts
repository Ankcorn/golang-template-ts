import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { New, plain, IsTrue, JSEscapeString, func } from "../src/index.js";
import { decode } from "./fixtures.js";
const tables = JSON.parse(
  readFileSync(new URL("./fixtures/locals.json", import.meta.url), "utf8"),
);
for (const [name, rows] of Object.entries(tables))
  for (const [i, row] of (rows as any[]).entries())
    test(`upstream ${name} ${i}`, () => {
      const c = Object.fromEntries(
        Object.entries(row).map(([k, v]) => [
          k,
          ["data", "v", "value"].includes(k) ? decode(v) : plain(decode(v)),
        ]),
      );
      if (name === "TestJSEscaping") {
        assert.equal(JSEscapeString(c.in), c.exp);
        return;
      }
      if (name === "TestIsTrue") {
        assert.equal(IsTrue(c.v)[0], c.want);
        return;
      }
      if (name === "TestInterfaceValues") {
        const t = New("tmpl").Parse(c.text);
        const run = () =>
          t.Execute({
            PlusOne: func((n) => n + 1, ["int"]),
            Slice: [0, 1, 2, 3],
            One: 1,
            Two: 2,
            Nil: null,
            Zero: 0,
          });
        if (c.out.startsWith("ERROR:"))
          assert.throws(
            run,
            (e) =>
              e instanceof Error && e.message.includes(c.out.slice(6).trim()),
          );
        else assert.equal(run(), c.out);
        return;
      }
      if (name === "TestEvalFieldErrors") {
        const run = () => New("tmpl").Parse(c.src).Execute(c.value);
        if (c.want === "<nil>") assert.doesNotThrow(run);
        else
          assert.throws(
            run,
            (e) => e instanceof Error && e.message.endsWith(c.want),
          );
        return;
      }
      const t = New("t")
        .Funcs({
          doPanic: () => {
            throw Error("custom panic string");
          },
        })
        .Parse(c.input);
      assert.throws(
        () => t.Execute(c.data),
        (e) => e instanceof Error && e.message.includes(c.wantErr),
        c.wantErr,
      );
    });
