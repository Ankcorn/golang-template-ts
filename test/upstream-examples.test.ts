import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { New, ParseGlob, float, func } from "../src/index.js";
function files(data: Record<string, string>, run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "golang-template-ts-"));
  try {
    for (const [name, content] of Object.entries(data))
      writeFileSync(join(dir, name), content);
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
test("ExampleTemplate", () => {
  const t = New("letter").Parse(`
Dear {{.Name}},
{{if .Attended}}
It was a pleasure to see you at the wedding.
{{- else}}
It is a shame you couldn't make it to the wedding.
{{- end}}
{{with .Gift -}}
Thank you for the lovely {{.}}.
{{end}}
Best wishes,
Josie
`);
  const result = [
    { Name: "Aunt Mildred", Gift: "bone china tea set", Attended: true },
    { Name: "Uncle John", Gift: "moleskin pants", Attended: false },
    { Name: "Cousin Rodney", Gift: "", Attended: false },
  ]
    .map((v) => t.Execute(v))
    .join("")
    .trim();
  assert.equal(
    result,
    `Dear Aunt Mildred,

It was a pleasure to see you at the wedding.
Thank you for the lovely bone china tea set.

Best wishes,
Josie

Dear Uncle John,

It is a shame you couldn't make it to the wedding.
Thank you for the lovely moleskin pants.

Best wishes,
Josie

Dear Cousin Rodney,

It is a shame you couldn't make it to the wedding.

Best wishes,
Josie`,
  );
});
test("ExampleTemplate_block", () => {
  const names = ["Gamora", "Groot", "Nebula", "Rocket", "Star-Lord"],
    t = New("master")
      .Funcs({ join: (a, b) => a.join(b) })
      .Parse(
        'Names:{{block "list" .}}{{"\\n"}}{{range .}}{{println "-" .}}{{end}}{{end}}',
      ),
    overlay = t.Clone().Parse('{{define "list"}} {{join . ", "}}{{end}} ');
  assert.equal(
    t.Execute(names) + overlay.Execute(names),
    "Names:\n- Gamora\n- Groot\n- Nebula\n- Rocket\n- Star-Lord\nNames: Gamora, Groot, Nebula, Rocket, Star-Lord",
  );
});
test("ExampleTemplate_func", () => {
  const t = New("titleTest")
    .Funcs({ title: (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase()) })
    .Parse(
      '\nInput: {{printf "%q" .}}\nOutput 0: {{title .}}\nOutput 1: {{title . | printf "%q"}}\nOutput 2: {{printf "%q" . | title}}\n',
    );
  assert.equal(
    t.Execute("the go programming language").trim(),
    'Input: "the go programming language"\nOutput 0: The Go Programming Language\nOutput 1: "The Go Programming Language"\nOutput 2: "The Go Programming Language"',
  );
});
test("ExampleTemplate_funcs", () => {
  const t = New("t")
    .Funcs({
      lower: (s: string) => s.toLowerCase(),
      repeat: (s: string) => s.repeat(2),
    })
    .Parse("{{ . | lower | repeat }}");
  assert.equal(t.Execute("ABC\n"), "abc\nabc\n");
  t.Funcs({ repeat: (s: string) => s.repeat(3) });
  assert.equal(t.Execute("DEF\n"), "def\ndef\ndef\n");
});
test("ExampleTemplate_if", () =>
  assert.equal(
    New("book")
      .Parse(
        '{{ if (gt .Stars 4.0) }}"{{.Name }}" is a great book.{{ else }}"{{.Name}}" is not a great book.{{ end }}',
      )
      .Execute({ Stars: float(4.9, "float32"), Name: "Good Night, Gopher" }),
    '"Good Night, Gopher" is a great book.',
  ));
test("ExampleTemplate_glob", () =>
  files(
    {
      "T0.tmpl": 'T0 invokes T1: ({{template "T1"}})',
      "T1.tmpl": '{{define "T1"}}T1 invokes T2: ({{template "T2"}}){{end}}',
      "T2.tmpl": '{{define "T2"}}This is T2{{end}}',
    },
    (dir) =>
      assert.equal(
        ParseGlob(join(dir, "*.tmpl")).Execute(null),
        "T0 invokes T1: (T1 invokes T2: (This is T2))",
      ),
  ));
test("ExampleTemplate_helpers", () =>
  files(
    {
      "T1.tmpl": '{{define "T1"}}T1 invokes T2: ({{template "T2"}}){{end}}',
      "T2.tmpl": '{{define "T2"}}This is T2{{end}}',
    },
    (dir) => {
      const t = ParseGlob(join(dir, "*.tmpl"))
        .Parse(
          "{{define `driver1`}}Driver 1 calls T1: ({{template `T1`}})\n{{end}}",
        )
        .Parse(
          "{{define `driver2`}}Driver 2 calls T2: ({{template `T2`}})\n{{end}}",
        );
      assert.equal(
        t.ExecuteTemplate("driver1", null) + t.ExecuteTemplate("driver2", null),
        "Driver 1 calls T1: (T1 invokes T2: (This is T2))\nDriver 2 calls T2: (This is T2)\n",
      );
    },
  ));
test("ExampleTemplate_share", () =>
  files(
    {
      "T0.tmpl": "T0 ({{.}} version) invokes T1: ({{template `T1`}})\n",
      "T1.tmpl": '{{define "T1"}}T1 invokes T2: ({{template "T2"}}){{end}}',
    },
    (dir) => {
      const drivers = ParseGlob(join(dir, "*.tmpl")),
        first = drivers.Clone().Parse("{{define `T2`}}T2, version A{{end}}"),
        second = drivers.Clone().Parse("{{define `T2`}}T2, version B{{end}}");
      assert.equal(
        second.ExecuteTemplate("T0.tmpl", "second") +
          first.ExecuteTemplate("T0.tmpl", "first"),
        "T0 (second version) invokes T1: (T1 invokes T2: (T2, version B))\nT0 (first version) invokes T1: (T1 invokes T2: (T2, version A))\n",
      );
    },
  ));
