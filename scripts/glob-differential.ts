import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { memoryGlob } from "../src/fs.js";

const files = Object.fromEntries(
  [
    "a.tmpl",
    "b.tmpl",
    ".hidden",
    "é.tmpl",
    "😀.tmpl",
    "-.tmpl",
    "].tmpl",
    "*.tmpl",
    "?.tmpl",
    "{a,b}.tmpl",
    "dir/a.tmpl",
    "dir/.hidden",
    "dir/deep/b.tmpl",
    "dír/c.tmpl",
    "dir2/a.tmpl",
    "dir2/z.txt",
    "a\n",
  ].map((name) => [name, name]),
);
const atoms = [
  "*",
  "**",
  "?",
  "a",
  "dir",
  "dir*",
  "[ab]",
  "[a-z]",
  "[^a]",
  "[!a]",
  "[z-a]",
  "[é😀]",
  "\\*",
  "\\?",
  "[\\-\\]]",
  "{a,b}",
  ".*",
  "",
  ".",
  "..",
  "[",
  "[]",
  "\\",
];
const patterns = new Set<string>([
  "./*.tmpl",
  "dir/../*.tmpl",
  "dir//*.tmpl",
  "dir/",
  "*/",
  "[/]",
  "[^/]",
  "a\n",
  "a",
  "missing/[]",
  "dir/**/b.tmpl",
]);
for (const a of atoms) {
  patterns.add(a);
  patterns.add(a + ".tmpl");
  for (const b of atoms) {
    patterns.add(a + "/" + b);
    patterns.add(a + "/" + b + ".tmpl");
  }
}
const ordered = [...patterns];
const output = execFileSync(
  process.env.GOROOT ? join(process.env.GOROOT, "bin/go") : "go",
  ["run", "scripts/glob-oracle.go"],
  {
    input: JSON.stringify({ Files: files, Patterns: ordered }),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  },
)
  .trim()
  .split("\n");
assert.equal(output.length, ordered.length);
ordered.forEach((pattern, i) => {
  const expected = JSON.parse(output[i]) as {
    names: string[] | null;
    error: string;
  };
  let names: string[] = [],
    error = "";
  try {
    names = memoryGlob(files, pattern);
  } catch (e) {
    error = (e as Error).message;
  }
  assert.deepEqual(
    { names, error },
    { names: expected.names ?? [], error: expected.error },
    JSON.stringify(pattern),
  );
});
console.log(`${ordered.length} in-memory glob comparisons against Go passed.`);
