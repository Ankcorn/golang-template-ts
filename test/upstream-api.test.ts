// Behavioral translations of the upstream standalone tests. Table fixtures remain verbatim.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  New,
  Template,
  ParseFiles,
  ParseGlob,
  ParseFS,
  ExecError,
  parse,
  treeString,
  struct,
  int,
  pointer,
  typedNil,
  value,
  func,
} from "../src/index.js";
import { isEmpty, errorContext } from "../src/parse.js";
import { decode, functions } from "./fixtures.js";
const dir = fileURLToPath(new URL("./upstream/testdata/", import.meta.url));
const fs = Object.fromEntries(
  readdirSync(dir).map((n) => [n, readFileSync(dir + n, "utf8")]),
);
const multi = JSON.parse(
  readFileSync(new URL("./fixtures/multi.json", import.meta.url), "utf8"),
);
const exec = JSON.parse(
  readFileSync(new URL("./fixtures/exec.json", import.meta.url), "utf8"),
);
const tVal = () => decode(exec.find((c: any) => c.name === ".X").data);
for (const [left, right] of [
  ["", ""],
  ["{{", "}}"],
  ["<<", ">>"],
  ["|", "|"],
  ["(日)", "(本)"],
])
  test(`TestDelims ${left}`, () => {
    const l = left || "{{",
      r = right || "}}",
      action = l + ".Str" + r,
      strAction = l + JSON.stringify(l) + r;
    const t = New("delims")
      .Delims(left, right)
      .Parse(action + l + "/*comment*/" + r + strAction);
    assert.equal(treeString(t.Tree!.nodes), action + strAction);
    assert.equal(t.Execute({ Str: "Hello, world" }), "Hello, world" + l);
  });
test("TestExecuteError", () =>
  assert.throws(
    () => New("error").Parse("{{.MyError true}}").Execute(tVal()),
    /my error/,
  ));
test("TestExecError", () => {
  const input = `line 1
line 2
line 3
{{template "one" .}}
{{define "one"}}{{template "two" .}}{{end}}
{{define "two"}}{{template "three" .}}{{end}}
{{define "three"}}{{index "hi" $}}{{end}}`;
  assert.throws(() => New("top").Parse(input).Execute(5), {
    message:
      'template: top:7:20: executing "three" at <index "hi" $>: error calling index: index out of range: 5',
  });
});
test("TestExecError_CustomError", () => {
  const original = new Error("heyo !");
  try {
    New("top")
      .Funcs({
        err: () => {
          throw original;
        },
      })
      .Parse("{{ err }}")
      .Execute();
    assert.fail();
  } catch (e) {
    let x: any = e;
    while (x && x !== original) x = x.cause;
    assert.equal(x, original);
  }
});
test("TestTree", () => {
  const t = New("root").Delims("(", ")").Parse(`
 (- define "tree" -) [ (- .Val -) (- with .Left -) (template "tree" . -) (- end -) (- with .Right -) (- template "tree" . -) (- end -) ] (- end -)`);
  const node = (Val: number, Left: any = null, Right: any = null) => ({
    Val,
    Left,
    Right,
  });
  const data = node(
    1,
    node(2, node(3, node(4)), node(5, node(6))),
    node(7, node(8, node(9)), node(10, node(11))),
  );
  assert.equal(
    t.Lookup("tree")!.Execute(data),
    "[1[2[3[4]][5[6]]][7[8[9]][10[11]]]]",
  );
  assert.equal(
    t.ExecuteTemplate("tree", data),
    "[1[2[3[4]][5[6]]][7[8[9]][10[11]]]]",
  );
});
test("TestExecuteOnNewTemplate", () => {
  assert.deepEqual(New("Name").Templates(), []);
  assert.deepEqual(new Template().Templates(), []);
  new Template().Parse("");
  new Template().New("abc").Parse("");
  assert.throws(() => new Template().Execute(null));
  assert.throws(() => new Template().ExecuteTemplate("XXX", null));
});
test("TestMessageForExecuteEmpty", () => {
  const t = New("empty");
  assert.throws(() => t.Execute(0), {
    message: 'template: empty: "empty" is an incomplete or empty template',
  });
  const s = New("").Parse(
    '{{define "one"}}one{{end}}{{define "two"}}two{{end}}',
  );
  t.AddParseTree("secondary", s.Tree!);
  assert.throws(() => t.Execute(0), {
    message: 'template: empty: "empty" is an incomplete or empty template',
  });
  assert.equal(t.ExecuteTemplate("secondary", 0), "");
});
test("TestFinalForPrintf", () =>
  assert.equal(New("").Parse('{{"x" | printf}}').Execute(0), "x"));
test("TestMissingMapKey", () => {
  const data = value("map[string]int", "map", [["x", int(99)]], {
      keyType: "string",
      elemType: "int",
    }),
    t = New("t1").Parse("{{.x}} {{.y}}");
  assert.equal(t.Execute(data), "99 <no value>");
  assert.equal(t.Option("missingkey=default").Execute(data), "99 <no value>");
  assert.equal(t.Option("missingkey=zero").Execute(data), "99 0");
  assert.throws(() => t.Option("missingkey=error").Execute(data));
  assert.throws(() => t.Execute(null));
});
test("TestUnterminatedStringError", () =>
  assert.throws(
    () => New("X").Parse("hello\n\n{{`unterminated\n\n\n\n}}\n some more\n\n"),
    /X:3: unterminated raw quoted string/,
  ));
test("TestExecuteGivesExecError", () => {
  const original = new Error("always be failing");
  assert.throws(
    () =>
      New("X")
        .Parse("hello")
        .Execute(
          {
            write() {
              throw original;
            },
          },
          0,
        ),
    (e) => e === original,
  );
  assert.throws(
    () => New("X").Parse("hello, {{.X.Y}}").Execute(0),
    (e) => e instanceof ExecError && e.message.includes("field X in type int"),
  );
});
test("TestGoodFuncNames", () => {
  for (const name of ["_", "a", "a1", "a1", "Ӵ"])
    New("X").Funcs({ [name]: () => 0 });
});
test("TestBadFuncNames", () => {
  for (const name of ["", "2", "a-b"])
    assert.throws(() => New("X").Funcs({ [name]: () => 0 }));
});
test("TestBlock", () => {
  const t = New("outer").Parse('a({{block "inner" .}}bar({{.}})baz{{end}})b'),
    clone = t.Clone().Parse('{{define "inner"}}foo({{.}})bar{{end}}');
  assert.equal(t.Execute("hello"), "a(bar(hello)baz)b");
  assert.equal(clone.Execute("goodbye"), "a(foo(goodbye)bar)b");
});
test("TestMaxExecDepth", () =>
  assert.throws(
    () => New("tmpl").Parse('{{template "tmpl" .}}').Execute(null),
    /exceeded maximum template depth/,
  ));
test("TestAddrOfIndex", () => {
  const data = [struct("V", { j: 1 }, { String: () => "<1>" })];
  for (const text of [
    "{{range .}}{{.String}}{{end}}",
    "{{with index . 0}}{{.String}}{{end}}",
  ])
    assert.equal(New("tmpl").Parse(text).Execute(data), "<1>");
});
test("TestIssue31810", () => {
  const t = New("").Parse("{{ (.)  }}");
  assert.equal(t.Execute("result"), "result");
  const f = () => "result";
  assert.throws(() => t.Execute(f));
  assert.equal(New("").Parse("{{ (call .)  }}").Execute(f), "result");
});
test("TestIssue43065", () =>
  assert.throws(
    () =>
      New("")
        .Parse("{{range .}}{{end}}")
        .Execute(value("chan<- int", "chan", [])),
    /range over send-only channel/,
  ));
test("TestIssue39807", () => {
  const foo = New("foo").Parse('{{template "bar" .}}'),
    bar = New("bar").Parse("bar");
  for (let i = 0; i < 100; i++) {
    foo.AddParseTree(bar.Name(), bar.Tree!);
    assert.equal(foo.Execute(null), "bar");
  }
});
for (const mode of ["files", "glob", "fs", "fs-glob"])
  test(`TestParseFiles/Glob/FS ${mode}`, () => {
    const root = New("root").Funcs(functions);
    if (mode === "files")
      root.ParseFiles(dir + "file1.tmpl", dir + "file2.tmpl");
    if (mode === "glob") root.ParseGlob(dir + "file*.tmpl");
    if (mode === "fs") root.ParseFS(fs, "file1.tmpl", "file2.tmpl");
    if (mode === "fs-glob") root.ParseFS(fs, "file*.tmpl");
    for (const c of multi.exec)
      assert.equal(
        root.New(c.name).Parse(c.input).Execute(decode(c.data)),
        c.output,
      );
  });
test("TestParseFiles/Glob/FS errors", () => {
  assert.throws(() => ParseFiles("DOES NOT EXIST"));
  assert.throws(() => ParseGlob("DOES NOT EXIST"));
  assert.throws(() => New("error").ParseGlob("[x"));
  assert.throws(() => ParseFS(fs, "DOES NOT EXIST"));
});
for (const mode of ["files", "glob"])
  test(`TestParseFiles/GlobWithData ${mode}`, () => {
    const t = New("root");
    if (mode === "files") t.ParseFiles(dir + "tmpl1.tmpl", dir + "tmpl2.tmpl");
    else t.ParseGlob(dir + "tmpl*.tmpl");
    assert.equal(
      t.Parse('{{template "tmpl1.tmpl"}}{{template "tmpl2.tmpl"}}').Execute(0),
      "template1\n\ny\ntemplate2\n\nx\n",
    );
  });
const a = '{{define "a"}}{{template "b"}}{{template "c"}}{{end}}',
  b = '{{define "b"}}b{{end}}',
  c = '{{define "c"}}root{{end}}';
test("TestClone", () => {
  const root = New("root")
      .Parse(a)
      .Parse(b)
      .Parse('{{define "e"}}{{.Foo}}{{end}}')
      .Option("missingkey=error"),
    clone = root.Clone();
  root.Parse(c);
  clone.Parse('{{define "c"}}clone{{end}}');
  assert.equal(root.ExecuteTemplate("a", 0), "broot");
  assert.equal(clone.ExecuteTemplate("a", 0), "bclone");
  for (const t of clone.Templates()) assert.equal(t.Lookup(t.Name()), t);
  let first = "";
  assert.throws(
    () => root.ExecuteTemplate("e", {}),
    (e) => {
      first = (e as Error).message;
      return true;
    },
  );
  assert.throws(() => clone.ExecuteTemplate("e", {}), { message: first });
});
test("TestAddParseTree", () => {
  const root = New("root").Parse(a).Parse(b),
    tree = parse("cloneText3", c);
  assert.equal(
    root.AddParseTree("c", tree.get("c")!).ExecuteTemplate("a", 0),
    "broot",
  );
});
test("TestAddParseTreeToUnparsedTemplate", () => {
  New("master").AddParseTree(
    "master",
    parse("master", '{{define "master"}}{{end}}').get("master")!,
  );
});
test("TestRedefinition", () => {
  const t = New("tmpl1").Parse('{{define "test"}}foo{{end}}');
  t.Parse('{{define "test"}}bar{{end}}');
  t.New("tmpl2").Parse('{{define "test"}}bar{{end}}');
});
test("TestEmptyTemplateCloneCrash", () => {
  New("base").Clone();
});
test("TestTemplateLookUp", () => {
  const t = New("foo");
  assert.equal(t.Lookup("foo"), undefined);
  t.New("bar");
  assert.equal(t.Lookup("bar"), undefined);
  t.Parse('{{define "foo"}}test{{end}}');
  assert.ok(t.Lookup("foo"));
});
test("TestNew", () => {
  const t1 = New("test").Parse('{{define "test"}}foo{{end}}'),
    t2 = t1.New("test");
  assert.ok(t1.Tree);
  assert.equal(t2.Tree, undefined);
  assert.ok(t1.Templates().includes(t1));
  assert.ok(!t1.Templates().includes(t2));
});
test("TestParse", () => {
  New("test")
    .Parse('{{define "test"}}{{end}}')
    .Parse('{{define "test"}}{{/* this is a comment */}}{{end}}')
    .Parse('{{define "test"}}foo{{end}}');
});
test("TestEmptyTemplate", () => {
  for (const [defs, input, want] of [
    [["x", "y"], "", "y"],
    [[""], "once", ""],
    [["", ""], "twice", ""],
    [["{{.}}", "{{.}}"], "twice", "twice"],
    [["{{/* a comment */}}", "{{/* a comment */}}"], "comment", ""],
    [["{{.}}", ""], "twice", ""],
  ] as [string[], string, string][]) {
    const root = New("root");
    let t = root;
    for (const d of defs) t = root.New(input).Parse(d);
    assert.equal(t.Execute(input), want);
  }
});
test("TestIssue19294", () => {
  for (let i = 0; i < 100; i++) {
    const t = New("title.xhtml").Parse('{{template "xhtml" .}}');
    t.New("stylesheet").Parse('{{define "stylesheet"}}stylesheet{{end}}');
    t.New("xhtml").Parse('{{block "stylesheet" .}}{{end}}');
    assert.equal(t.Execute(0), "stylesheet");
  }
});
test("TestAddToZeroTemplate", () => {
  new Template().AddParseTree("x", parse("c", c).get("c")!);
});
test("parse.TestParseWithComments", () => {
  for (const [input, result] of [
    ["{{/*\n\n\n*/}}", "{{/*\n\n\n*/}}"],
    ["x \r\n\t{{- /* hi */}}", '"x"{{/* hi */}}'],
    ["{{/* hi */ -}}\n\n\ty", '{{/* hi */}}"y"'],
    ["x \r\n\t{{- /* */ -}}\n\n\ty", '"x"{{/* */}}"y"'],
  ])
    assert.equal(
      treeString(
        parse("comment", input, [], "{{", "}}", false, 10000, true).get(
          "comment",
        )!.nodes,
        true,
      ),
      result,
    );
});
test("parse.TestDelimsStringRoundtrip", () => {
  for (const input of [
    "[[.X]]",
    "[[/* a comment */]]",
    "[[if .X]]y[[else]]z[[end]]",
    "[[range .X]][[break]][[continue]][[end]]",
    "[[with .X]]y[[end]]",
    '[[template "name" .]]',
  ])
    assert.equal(
      treeString(
        parse("test", input, [], "[[", "]]", false, 10000, true).get("test")!
          .nodes,
      ),
      input,
    );
});
test("parse.TestKeywordsAndFuncs", () => {
  const input = "{{range .X}}{{break 20}}{{end}}";
  assert.doesNotThrow(() => parse("", input, ["break"]));
  assert.throws(() => parse("", input));
});
test("parse.TestSkipFuncCheck", () =>
  assert.equal(
    treeString(
      parse("skip func check", "{{fn 1 2}}", [], "{{", "}}", true).get(
        "skip func check",
      )!.nodes,
    ),
    "{{fn 1 2}}",
  ));
test("parse.TestIsEmpty", () => {
  for (const [input, empty] of [
    ["", true],
    ["hello", false],
    [" \t\n \t\n", true],
    ["{{/* comment */}}", true],
    ['{{define "x"}}something{{end}}', true],
    [
      "{{define `x`}}something{{end}}\n\n{{define `y`}}something{{end}}\n\n",
      true,
    ],
    [
      "{{define `x`}}something{{end}}\nx\n{{define `y`}}something{{end}}\ny\n",
      false,
    ],
    ["{{define `x`}}something{{end}}{{if 3}}foo{{end}}", false],
  ] as [string, boolean][])
    assert.equal(isEmpty(parse("root", input).get("root")!.nodes), empty);
});
test("parse.TestErrorContextWithTreeCopy", () => {
  const t = parse("root", "{{if true}}{{end}}").get("root")!,
    copy = structuredClone(t);
  assert.deepEqual(
    errorContext(t, t.nodes[0]),
    errorContext(copy, copy.nodes[0]),
  );
});
test("parse.TestBlock", () => {
  const trees = parse("outer", 'a{{block "inner" .}}bar{{.}}baz{{end}}b');
  assert.equal(
    treeString(trees.get("outer")!.nodes),
    'a{{template "inner" .}}b',
  );
  assert.equal(treeString(trees.get("inner")!.nodes), "bar{{.}}baz");
});
test("parse.TestLineNum", () => {
  const t = parse("bench", "{{printf 1234}}\n".repeat(3)).get("bench")!;
  for (let i = 0; i < 3; i++)
    assert.equal(
      errorContext(t, t.nodes[2 * i])[0].split(":")[1],
      String(i + 1),
    );
});
test("TestIssue48215", () =>
  assert.throws(
    () =>
      New("")
        .Parse("{{ .S }}")
        .Execute(struct("B", { A: typedNil("*A") }, {}, ["A"])),
    /reflect: indirection through nil pointer to embedded struct field A/,
  ));
