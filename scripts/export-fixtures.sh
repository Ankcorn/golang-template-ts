#!/bin/sh
set -eu
: "${GOROOT:?Set GOROOT to the Go 1.27.3 toolchain directory}"
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export TS_FIXTURES="$root/test/fixtures"
target="$GOROOT/src/text/template/zz_export_ts_test.go"
test ! -e "$target"
trap 'rm -f "$target"' EXIT HUP INT TERM
cp "$root/scripts/export_test.go.txt" "$target"
"$GOROOT/bin/go" run "$root/scripts/lift-tables.go" -- "$root/test/upstream/exec_test.go" >> "$target"
"$GOROOT/bin/go" test text/template -run '^TestExport.*TS$' -count=1

rm -f "$target"
target="$GOROOT/src/text/template/parse/zz_export_ts_test.go"
test ! -e "$target"
cp "$root/scripts/export_parse_test.go.txt" "$target"
"$GOROOT/bin/go" test text/template/parse -run '^TestExportTS$' -count=1

node "$root/scripts/compact-fixtures.mjs"
