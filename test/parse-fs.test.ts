import assert from "node:assert/strict";
import test from "node:test";
import { New, ParseFS } from "../src/index.js";

test("ParseFS selects the first matched basename and preserves pattern order", () => {
  const fs = { "dir/b.tmpl": "B", "dir/a.tmpl": "A" };
  const t = ParseFS(fs, "dir/*.tmpl");
  assert.equal(t.Name(), "a.tmpl");
  assert.equal(t.Execute(), "A");
  assert.equal(t.ExecuteTemplate("b.tmpl"), "B");
  assert.equal(ParseFS(fs, "dir/b.tmpl", "dir/a.tmpl").Execute(), "B");
  assert.equal(
    ParseFS({ "hello.tmpl": "hello" }, "hello.tmpl").Execute(),
    "hello",
  );
});

test("ParseFS preserves an existing receiver and handles duplicate basenames", () => {
  const root = New("root").Parse("root");
  assert.equal(root.ParseFS({ "a.tmpl": "A" }, "*.tmpl"), root);
  assert.equal(root.Execute(), "root");
  assert.equal(root.ExecuteTemplate("a.tmpl"), "A");
  assert.equal(
    New("a.tmpl").ParseFS({ "a.tmpl": "A" }, "*.tmpl").Execute(),
    "A",
  );
  assert.equal(
    ParseFS({ "one/a": "first", "two/a": "last" }, "one/a", "two/a").Execute(),
    "last",
  );
});

const files = {
  "a.tmpl": "a",
  "b.tmpl": "b",
  "c.tmpl": "c",
  "-.tmpl": "-",
  "].tmpl": "]",
  "*.tmpl": "*",
  "é.tmpl": "é",
  "😀.tmpl": "😀",
  "nested/a.tmpl": "nested",
};
const patterns: [string, string[]][] = [
  ["[ab].tmpl", ["a", "b"]],
  ["[a-b].tmpl", ["a", "b"]],
  ["[^a-c].tmpl", ["*", "-", "]", "é", "😀"]],
  ["[\\-\\]].tmpl", ["-", "]"]],
  ["\\*.tmpl", ["*"]],
  ["[é😀].tmpl", ["é", "😀"]],
  ["?.tmpl", ["*", "-", "]", "a", "b", "c", "é", "😀"]],
  ["*.tmpl", ["*", "-", "]", "a", "b", "c", "é", "😀"]],
  ["nested/[a-c].tmpl", ["nested"]],
  ["[z-aa].tmpl", ["a"]],
];
for (const [pattern, expected] of patterns) {
  test(`ParseFS Go glob syntax: ${pattern}`, () => {
    const t = ParseFS(files, pattern);
    assert.equal(t.Execute(), expected[0]);
    assert.deepEqual(
      t
        .Templates()
        .map((t) => t.Execute())
        .sort(),
      [...expected].sort(),
    );
  });
}

for (const pattern of [
  "[",
  "[]",
  "[^]",
  "[a-]",
  "[-a]",
  "[a",
  "\\",
  "missing*[",
]) {
  test(`ParseFS rejects malformed pattern ${pattern}`, () => {
    assert.throws(() => ParseFS(files, pattern), /syntax error in pattern/);
    assert.throws(() => ParseFS({}, pattern), /syntax error in pattern/);
  });
}

test("ParseFS validates patterns before parsing files and rejects empty lists", () => {
  const t = New("root").Parse("root");
  assert.throws(
    () => t.ParseFS(files, "a.tmpl", "missing"),
    /matches no files/,
  );
  assert.equal(t.Lookup("a.tmpl"), undefined);
  assert.throws(() => ParseFS(files), /no files named/);
  assert.throws(() => t.ParseFS(files), /no files named/);
  assert.throws(() => ParseFS(files, "[z-a].tmpl"), /matches no files/);
  assert.throws(() => ParseFS({ "a\n": "newline" }, "a"), /matches no files/);
});

test("ParseFS calls custom glob once per pattern and retains its order", () => {
  const calls: string[] = [];
  const t = ParseFS(
    {
      glob(pattern: string) {
        calls.push(pattern);
        return ["dir/b", "dir/a"];
      },
      readFile(name: string) {
        return name;
      },
    },
    "*",
  );
  assert.deepEqual(calls, ["*"]);
  assert.equal(t.Name(), "b");
  assert.equal(t.Execute(), "dir/b");
});
