#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

expected=4
observed=0
work=$(mktemp -d "${TMPDIR:-/tmp}/wifiodds-unpublished-null.XXXXXX")
trap 'rm -rf "$work"' EXIT HUP INT TERM

run_mutation() {
  name=$1
  expression=$2
  replacement=$3
  target="$work/$name"
  mkdir -p "$target"
  git archive HEAD | tar -x -C "$target"
  perl -0pi -e "s/\\Q$expression\\E/$replacement/ or die qq(mutation did not land\\n)" \
    "$target/functions/_lib/api.mjs"
  if (cd "$target" && node build/apitest.js >/dev/null 2>&1); then
    echo "FAIL $name: planted unpublished-value defect escaped" >&2
    exit 1
  fi
  observed=$((observed + 1))
  echo "PASS $name: planted unpublished-value defect was caught"
}

run_mutation equipped-pct-zero \
  'equippedPct: a.equippedPublished === false ? null : publishedPct(a.parts.pctEquipped)' \
  'equippedPct: a.equippedPublished === false ? 0 : publishedPct(a.parts.pctEquipped)'
run_mutation equipped-share-zero \
  'equippedShare: a.equippedPublished === false ? null : round(a.parts.pctEquipped, 4)' \
  'equippedShare: a.equippedPublished === false ? 0 : round(a.parts.pctEquipped, 4)'
run_mutation equipped-published-true \
  'equippedPublished: a.equippedPublished !== false' \
  'equippedPublished: true'

node build/apitest.js >/dev/null
observed=$((observed + 1))
echo "PASS clean: unpublished equipped values remain false and null"

[ "$observed" -eq "$expected" ] || {
  echo "FAIL control count: expected $expected, observed $observed" >&2
  exit 1
}
echo "unpublished-null controls: $observed/$expected behaved"
