#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

expected=2
observed=0

if TECH_LABEL_MUTATION=narrow-tier-column node build/technology-label-wrap.test.mjs >/dev/null 2>&1; then
  echo "FAIL narrow-tier-column: planted mid-word wrap escaped" >&2
  exit 1
fi
observed=$((observed + 1))
echo "PASS narrow-tier-column: planted mid-word wrap was caught"

node build/technology-label-wrap.test.mjs
observed=$((observed + 1))
echo "PASS clean: Technology labels remain complete"

[ "$observed" -eq "$expected" ] || {
  echo "FAIL control count: expected $expected, observed $observed" >&2
  exit 1
}
echo "technology label-wrap controls: $observed/$expected behaved"
