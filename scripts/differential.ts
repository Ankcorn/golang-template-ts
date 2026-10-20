import { spawnSync } from "node:child_process";
import { New } from "../src/index.js";
const cases: { Source: string; Data: unknown }[] = [];
const add = (Source: string, Data: unknown = null) =>
  cases.push({ Source, Data });
const atoms = [
  "nil",
  "true",
  "false",
  "0",
  "1",
  "-1",
  "2",
  "1.5",
  "2.0",
  '""',
  '"x"',
  '"é"',
];
for (const op of ["eq", "ne", "lt", "le", "gt", "ge", "and", "or"])
  for (const a of atoms) for (const b of atoms) add(`{{${op} ${a} ${b}}}`);
for (const atom of atoms)
  for (const format of [
    "%v",
    "%+v",
    "%#v",
    "%T",
    "%s",
    "%q",
    "%d",
    "%04x",
    "%g",
    "%.2f",
  ])
    add(`{{printf ${JSON.stringify(format)} ${atom}}}`);
for (const data of [null, {}, [], [0, 1, 2], { b: 2, a: 1 }, 0, 1, 4, "é"])
  for (const source of [
    "{{.}}",
    "{{if .}}yes{{else}}no{{end}}",
    "{{with .}}{{.}}{{else}}empty{{end}}",
    "{{range .}}{{.}};{{else}}empty{{end}}",
    "{{len .}}",
    "{{index . 0}}",
    "{{slice . 0 1}}",
    "{{.absent}}",
  ])
    add(source, data);
const go = process.env.GOROOT ? `${process.env.GOROOT}/bin/go` : "go";
const run = spawnSync(go, ["run", "scripts/oracle.go"], {
  input: cases.map((c) => JSON.stringify(c)).join("\n") + "\n",
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
});
if (run.status !== 0) throw Error(run.stderr || run.error?.message);
const refs = run.stdout
  .trim()
  .split("\n")
  .map((s) => JSON.parse(s));
let failures = 0;
for (let i = 0; i < cases.length; i++) {
  const c = cases[i],
    r = refs[i];
  let output = "",
    error: unknown;
  try {
    output = New("differential").Parse(c.Source).Execute(c.Data);
  } catch (e) {
    error = e;
  }
  if (r.ok !== !error || (r.ok && r.output !== output)) {
    failures++;
    if (failures <= 30)
      console.error(
        JSON.stringify({
          source: c.Source,
          data: c.Data,
          go: r,
          typescript: error ? String(error) : output,
        }),
      );
  }
}
console.log(
  `${cases.length - failures}/${cases.length} differential cases passed; ${failures} failed.`,
);
process.exitCode = failures ? 1 : 0;
