#!/bin/sh
set -u

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TMP=$(mktemp -d "${TMPDIR:-/tmp}/homepage-visual-controls.XXXXXX") || exit 2
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
RAN=0
FAIL=0

make_case() {
  name=$1
  dst="$TMP/$name"
  mkdir -p "$dst/build" "$dst/technology" || return 1
  cp "$ROOT/index.html" "$dst/index.html" || return 1
  cp "$ROOT/technology/index.html" "$dst/technology/index.html" || return 1
  cp "$ROOT/build/homepage-visual.test.mjs" "$dst/build/homepage-visual.test.mjs" || return 1
}

expect_fail() {
  name=$1
  RAN=$((RAN + 1))
  if (cd "$TMP/$name" && node build/homepage-visual.test.mjs --quick >/dev/null 2>&1); then
    echo "FAIL $name: planted defect escaped the browser gate"
    FAIL=$((FAIL + 1))
  else
    echo "PASS $name: planted defect was caught"
  fi
}

make_case three-column-grid || exit 2
perl -0pi -e 's/\.allgrid\.allgrid-v2\{grid-template-columns:1fr\}/.allgrid.allgrid-v2{grid-template-columns:repeat(3,1fr)}/' "$TMP/three-column-grid/index.html"
expect_fail three-column-grid

make_case missing-evidence-binding || exit 2
perl -0pi -e 's/data-figure-evidence="nextgen"/data-broken-evidence="nextgen"/g' "$TMP/missing-evidence-binding/index.html"
expect_fail missing-evidence-binding

make_case hidden-keyboard-slider || exit 2
perl -0pi -e 's/<div class="handle" aria-hidden="true"><b>↔<\/b>/<div class="handle" aria-hidden="true"><b tabindex="0" role="slider">↔<\/b>/' "$TMP/hidden-keyboard-slider/technology/index.html"
expect_fail hidden-keyboard-slider

make_case incomplete-denominator-source || exit 2
perl -0pi -e 's/(id="row-alaska-nextgen-evidence"[\s\S]*?<p class="figure-source-list">)alaskastarlinktracker\.com; /$1/' "$TMP/incomplete-denominator-source/index.html"
expect_fail incomplete-denominator-source

make_case stacked-nextgen-streaming || exit 2
perl -0pi -e 's/(#airline-grid \.row \.metric\.primary\{[^}]*)(})/$1flex-direction:column;flex-wrap:wrap;$2/' "$TMP/stacked-nextgen-streaming/index.html"
expect_fail stacked-nextgen-streaming

make_case clean || exit 2
RAN=$((RAN + 1))
if (cd "$TMP/clean" && node build/homepage-visual.test.mjs --quick >/dev/null 2>&1); then
  echo "PASS clean: valid candidate passes"
else
  echo "FAIL clean: valid candidate was rejected"
  FAIL=$((FAIL + 1))
fi

if [ "$RAN" -ne 6 ]; then
  echo "FAIL control count: expected 6, ran $RAN"
  exit 1
fi
if [ "$FAIL" -ne 0 ]; then
  echo "homepage visual controls: $FAIL of $RAN failed"
  exit 1
fi
echo "homepage visual controls: $RAN/$RAN behaved"
