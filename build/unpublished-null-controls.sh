#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

expected=6
observed=0
work=$(mktemp -d "${TMPDIR:-/tmp}/wifiodds-unpublished-null.XXXXXX")
trap 'rm -rf "$work"' EXIT HUP INT TERM

isolate() {
  target="$work/$1"
  mkdir -p "$target"
  # Test the candidate bytes, including uncommitted changes, rather than HEAD.
  git ls-files -z | tar -cf - --null -T - | tar -xf - -C "$target"
  git -C "$target" init -q
  git -C "$target" add -A
  git -C "$target" -c user.name='WiFi Odds control' -c user.email='controls@wifiodds.invalid' \
    commit -q -m 'control baseline'
}

run_mutation() {
  name=$1
  expression=$2
  replacement=$3
  isolate "$name"
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
  'equippedPct: a.equippedPublished === false ? null :' \
  'equippedPct: a.equippedPublished === false ? 0 :'
run_mutation equipped-share-zero \
  'equippedShare: a.equippedPublished === false ? null : round(a.parts.pctEquipped, 4)' \
  'equippedShare: a.equippedPublished === false ? 0 : round(a.parts.pctEquipped, 4)'
run_mutation equipped-published-true \
  'equippedPublished: a.equippedPublished !== false' \
  'equippedPublished: true'

run_mutation nextgen-score-zero \
  'return a.nextGenPublished === false ? null : a.nextGenScore;' \
  'return a.nextGenPublished === false ? 0 : a.nextGenScore;'

run_mutation nextgen-ranked-true \
  'ranked: a.nextGenPublished !== false,' \
  'ranked: true,'

isolate clean
(cd "$target" && node build/apitest.js >/dev/null)
observed=$((observed + 1))
echo "PASS clean: unpublished equipped values remain false and null, unpublished next-gen is not a numeric 0"

[ "$observed" -eq "$expected" ] || {
  echo "FAIL control count: expected $expected, observed $observed" >&2
  exit 1
}
echo "unpublished-null controls: $observed/$expected behaved"
