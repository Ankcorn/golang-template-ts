import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const manifest = JSON.parse(
  readFileSync(
    new URL("../test/upstream-manifest.json", import.meta.url),
    "utf8",
  ),
);
const root = new URL("../test/upstream/", import.meta.url),
  discovered = [];
for (const file of readdirSync(root, { recursive: true }).filter((f) =>
  f.endsWith("_test.go"),
)) {
  const text = readFileSync(new URL(file, root), "utf8");
  assert.equal(
    createHash("sha256").update(text).digest("hex"),
    manifest.sources[file],
    `Upstream source changed: ${file}`,
  );
  for (const match of text.matchAll(/^func ((?:Test|Example)\w*)\(/gm))
    discovered.push(`${file}:${match[1]}`);
}
assert.deepEqual(
  Object.keys(manifest.tests).sort(),
  discovered.sort(),
  "Every upstream test must have an explicit disposition",
);
for (const [id, mapping] of Object.entries(manifest.tests)) {
  if (mapping.status === "go-only") {
    assert.equal(id, "link_test.go:TestLinkerGC");
    continue;
  }
  assert.equal(mapping.status, "adapted");
  const test = readFileSync(
    new URL("../" + mapping.file, import.meta.url),
    "utf8",
  );
  assert.ok(
    test.includes(mapping.marker),
    `${id}: missing test marker ${mapping.marker}`,
  );
}
const adapted = Object.values(manifest.tests).filter(
  (t) => t.status === "adapted",
).length;
console.log(
  `Go ${manifest.goVersion}: ${adapted}/${discovered.length} upstream test/example functions have TypeScript behavioral adapters. 1 Go-linker-only test remains explicitly classified; it runs only in test:go.`,
);
