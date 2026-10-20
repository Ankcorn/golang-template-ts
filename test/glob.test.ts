import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { compileMatch, memoryGlob } from "../src/fs.js";
import { ParseFS } from "../src/index.js";

// Cases from Go 1.27.3 src/path/match_test.go (Go Authors, BSD-3-Clause).
const cases = JSON.parse(
  readFileSync(new URL("./fixtures/path-match.json", import.meta.url), "utf8"),
) as { pattern: string; name: string; match: boolean; error: boolean }[];
for (const [i, c] of cases.entries())
  test(`Go path.Match case ${i}: ${c.pattern}`, () => {
    if (c.error)
      assert.throws(
        () => compileMatch(c.pattern)(c.name),
        /syntax error in pattern/,
      );
    else assert.equal(compileMatch(c.pattern)(c.name), c.match);
  });
const files = {
  "a.tmpl": "A",
  ".hidden": "H",
  "dir/b.tmpl": "B",
  "dir/deep/c.tmpl": "C",
};
test("in-memory globs traverse directories and include dotfiles", () => {
  assert.deepEqual(memoryGlob(files, "*"), [".hidden", "a.tmpl", "dir"]);
  assert.deepEqual(memoryGlob(files, "dir/*"), ["dir/b.tmpl", "dir/deep"]);
  assert.deepEqual(memoryGlob(files, "*/*/*.tmpl"), ["dir/deep/c.tmpl"]);
  assert.equal(ParseFS(files, "*/*.tmpl").Execute(), "B");
});
test("in-memory ** matches one directory level, not a recursive glob", () => {
  assert.deepEqual(memoryGlob(files, "**/*.tmpl"), ["dir/b.tmpl"]);
});
test("in-memory glob resolves the root dot directory and rejects invalid paths", () => {
  assert.deepEqual(memoryGlob(files, "./*.tmpl"), ["a.tmpl"]);
  for (const p of [
    "/a.tmpl",
    "../*.tmpl",
    "dir//*.tmpl",
    "dir/../*.tmpl",
    "dir/",
  ])
    assert.deepEqual(memoryGlob(files, p), []);
});
test("directories match globs but cannot be parsed as template files", () => {
  assert.deepEqual(memoryGlob(files, "dir"), ["dir"]);
  assert.throws(() => ParseFS(files, "dir"), /cannot read file: dir/);
  assert.throws(() => ParseFS(files, "*"), /cannot read file: dir/);
});
test("in-memory glob metacharacters follow Go syntax", () => {
  const names = { a: "", b: "", "!": "", "{a,b}": "" };
  assert.deepEqual(memoryGlob(names, "{a,b}"), ["{a,b}"]);
  assert.deepEqual(memoryGlob(names, "[!a]"), ["!", "a"]);
  assert.deepEqual(memoryGlob(names, "[z-a]"), []);
});
test("many wildcard groups avoid exponential regular-expression backtracking", () => {
  assert.equal(compileMatch("*a".repeat(100) + "b")("a".repeat(200)), false);
});
