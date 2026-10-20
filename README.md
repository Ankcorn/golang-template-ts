# golang-template-ts

A TypeScript implementation of Go's `text/template`, targeting Go **1.27.3**. The runtime is TypeScript; it does not shell out to Go or load Go/Wasm. Requires Node.js 22.17+ and uses ESM.

**Experimental: passing the translated upstream tests is not a proof of 100% feature parity.** See the compatibility boundaries below.

```ts
import { New } from 'golang-template-ts';

const template = New('hello').Parse(
  '{{range .People}}Hello, {{.}}!\n{{else}}Nobody here.{{end}}',
);
console.log(template.Execute({ People: ['Ada', 'Grace'] }));
```

## What is implemented

Actions, comments, trim markers, custom delimiters, pipelines, variables and assignment, field/method chains, parenthesized expressions, `if`, `with`, `range`, `break`, `continue`, `define`, `template`, and `block`. Associated templates support cloning, redefinition, lookup, parse-tree insertion, file/glob loading, and an in-memory filesystem adapter. Built-ins include comparisons, boolean short-circuiting, indexing, slicing, length, function calls, printing, and HTML/JavaScript/URL-query escaping. This is **text/template**, not `html/template`; output is not automatically escaped.

The API keeps Go's method names. `Execute(data)` returns a string; `Execute(writer, data)` writes incrementally to an object with `write(string)`. Errors are thrown. `ExecuteTemplate(name, data)` and `ExecuteTemplate(writer, name, data)` execute an associated template.

```ts
import { New, func, int, pointer, struct, typedNil } from 'golang-template-ts';

const t = New('example')
  .Funcs({ double: func(n => n * 2, ['int']) })
  .Option('missingkey=error')
  .Parse('{{double .Count}}');

console.log(t.Execute({ Count: 21 })); // 42
```

Ordinary objects represent string-keyed maps. For Go distinctions that JavaScript does not have, use `int`, `uint`, `float`, `complex`, `pointer`, `typedNil`, `struct`, and `value`. `func(callback, argumentTypes, options)` supplies argument/return-signature metadata. Callbacks throw to represent Go errors; ordinary JavaScript callbacks are also accepted but have no Go signature metadata. Big integers retain 64-bit precision. See `test/fixtures.ts` for translations of the upstream Go fixture types and methods.

## Measure correctness

```sh
npm ci
npm run check                 # build, typecheck, upstream inventory audit, 872 tests
npm run test:upstream         # run TypeScript against the adapted upstream expectations
npm run test:differential     # requires Go: 1,344 cases compared with a live Go reference
```

The original Go tests cannot import TypeScript. This project therefore preserves their test data and translates the harness:

* `test/upstream/` contains the original package sources and tests, unmodified, with their BSD license in `LICENSE`.
* `test/fixtures/` contains tables extracted by running export helpers **inside the pinned Go packages**. Inputs, expected outputs, and success/error expectations come from upstream. Typed data descriptors are decoded separately; callbacks are translations of the Go fixture functions, not precomputed template results.
* Standalone API regressions and examples have behavioral TypeScript adapters. The race regression exercises the same operations sequentially because this JavaScript API is synchronous; it does not validate Go's goroutine scheduling or race detector.
* `test/upstream-manifest.json` accounts for all **72** upstream test/example functions. **71** have TypeScript behavioral adapters. `TestLinkerGC` is explicitly Go-only: it compiles a Go program and checks Go's linker dead-code elimination. It is not counted as a TypeScript pass.
* `npm run audit:upstream` checks source hashes, inventory completeness, and adapter markers. The manifest is a coverage index, not a mathematical equivalence certificate.
* `scripts/differential.ts` independently compares 1,344 combinations of built-ins and data with the Go implementation. Success outputs and error occurrence are compared; this differential check does not require every error message to match. The upstream-specific error tests do check their original message expectations.

To reproduce fixture extraction and the original Go baseline, install the **Go 1.27.3** toolchain, set `GOROOT` to that installation, then run:

```sh
npm run fixtures
npm run check
npm run test:go
```

Fixture extraction temporarily adds test-only export files under `GOROOT/src/text/template` and `parse`, and removes them on exit. Use a dedicated writable toolchain. `test:go` runs the actual Go tests, including `TestLinkerGC`; it measures the reference implementation, **not** the TypeScript port. CI runs the translated suite, differential comparisons, and the separate Go baseline.

## Compatibility boundaries

The current evidence is **872 passing adapted tests and 1,344 passing differential cases**, not unrestricted Go equivalence. In particular:

* Go reflection, pointer identity, struct metadata, function signatures, and channels have no exact native JavaScript equivalents. Explicit typed wrappers are required for the distinctions exercised by the Go tests. Channel/iterator fixture values currently represent synchronous sequences rather than live Go channels or goroutines.
* `printf` implements the formatting exercised by these suites, but is not a complete port of the separate Go `fmt` package. Arbitrary formatting flags, reflection formatting, custom `fmt.Formatter`, and all combinations of argument indexing are not certified.
* Template recursion is currently limited to 1,000 calls rather than Go's 100,000 on non-Wasm platforms. Extremely deeply nested expressions may also encounter JavaScript stack limits.
* JavaScript strings represent Unicode text. Arbitrary invalid UTF-8 Go strings and byte slices that split a UTF-8 sequence do not retain identical byte-level behavior.
* Filesystem/glob operations use Node's filesystem APIs; OS-specific behavior and the complete `io/fs` interface are not reproduced.

These remaining boundaries mean this release **does not yet satisfy a literal 100% feature-parity guarantee**. The test machinery is intended to make further compatibility work measurable without hiding omissions or skipped test families.
