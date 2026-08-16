#!/bin/sh
# Prove the daily-refresh United gate rejects a severed API percentage and a
# rendered whole-fleet denominator. Each mutation is isolated; the clean case
# runs last so this cannot end on a stale pass.
set -eu
cd "$(dirname "$0")/.."

work=$(mktemp -d "${TMPDIR:-/tmp}/wifiodds-united-refresh.XXXXXX")
trap 'rm -rf "$work"' EXIT HUP INT TERM
observed=0
expected=3

isolate() {
  target="$work/$1"
  mkdir -p "$target"
  git ls-files -z | tar -cf - --null -T - | tar -xf - -C "$target"
  # apitest's retained-date gate compares united/data.json with HEAD. Give each
  # isolated control its own baseline made from these exact candidate bytes.
  git -C "$target" init -q
  git -C "$target" add -A
  git -C "$target" -c user.name='WiFi Odds control' -c user.email='controls@wifiodds.invalid' \
    commit -q -m 'control baseline'
  printf '%s' "$target"
}

must_fail() {
  name=$1
  target=$2
  if (cd "$target" && node build/prerender.js >/dev/null 2>&1 && node build/apitest.js >/dev/null 2>&1); then
    echo "FAIL $name: planted United refresh defect escaped" >&2
    exit 1
  fi
  observed=$((observed + 1))
  echo "PASS $name: planted United refresh defect was caught"
}

target=$(isolate api-parity)
perl -0pi -e 's/nextGen: \{\n      score: publicNextGenScore\(a\),/nextGen: {\n      score: publicNextGenScore(a) + 1,/' \
  "$target/functions/_lib/api.mjs"
must_fail api-parity "$target"

target=$(isolate rendered-denominator)
perl -0pi -e 's/var total = a\.total \|\| 0;/var total = (a.total || 0) - 1;/' \
  "$target/build/lib/render.js"
must_fail rendered-denominator "$target"

target=$(isolate clean)
(cd "$target" && node build/prerender.js >/dev/null && node build/apitest.js >/dev/null)
observed=$((observed + 1))
echo "PASS clean: derived United source-to-API-to-rendered gate is green"

[ "$observed" -eq "$expected" ] || {
  echo "FAIL control count: expected $expected, observed $observed" >&2
  exit 1
}
echo "United refresh derived controls: $observed/$expected behaved"
