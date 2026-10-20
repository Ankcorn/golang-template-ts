import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { New } from "../src/index.js";
import { decode, functions } from "./fixtures.js";
const cases = JSON.parse(
  readFileSync(new URL("./fixtures/exec.json", import.meta.url), "utf8"),
);
for (const [i, c] of cases.entries())
  test(`upstream exec ${i}: ${c.name}`, () => {
    const run = () =>
      New(c.name).Funcs(functions).Parse(c.input).Execute(decode(c.data));
    if (c.ok) assert.equal(run(), c.output);
    else assert.throws(run);
  });
