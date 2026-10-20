import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const dir = new URL("../test/fixtures/", import.meta.url);
const pool = {};
function canonical(v) {
  if (!v || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(canonical);
  const out = Object.fromEntries(
    Object.keys(v)
      .sort()
      .map((k) => [k, canonical(v[k])]),
  );
  if (out.kind === "map" && out.value)
    out.value.sort((a, b) =>
      JSON.stringify(a[0]).localeCompare(JSON.stringify(b[0])),
    );
  return out;
}
function intern(v) {
  if (v == null) return null;
  const c = canonical(v),
    id = createHash("sha256")
      .update(JSON.stringify(c))
      .digest("hex")
      .slice(0, 16);
  pool[id] = c;
  return { $fixture: id };
}
for (const file of ["exec.json", "multi.json", "locals.json"]) {
  const data = JSON.parse(readFileSync(new URL(file, dir), "utf8"));
  if (file === "exec.json") for (const c of data) c.data = intern(c.data);
  if (file === "multi.json") for (const c of data.exec) c.data = intern(c.data);
  if (file === "locals.json")
    for (const rows of Object.values(data))
      for (const c of rows)
        for (const key of ["data", "value", "v"])
          if (key in c) c[key] = intern(c[key]);
  writeFileSync(new URL(file, dir), JSON.stringify(data, null, 2) + "\n");
}
writeFileSync(new URL("data.json", dir), JSON.stringify(pool, null, 2) + "\n");
