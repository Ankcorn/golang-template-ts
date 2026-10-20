#!/bin/sh
set -eu
: "${GOROOT:?Set GOROOT to the Go 1.27.3 toolchain directory}"
version=$("$GOROOT/bin/go" env GOVERSION)
if [ "$version" != 'go1.27.3' ]; then echo "Expected go1.27.3; got $version" >&2; exit 1; fi
"$GOROOT/bin/go" test -count=1 text/template text/template/parse
