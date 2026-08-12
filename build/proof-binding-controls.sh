#!/bin/sh
# Negative controls for the proof-block source-token binding guard in
# build/lib/render.js (Render.home).
#
# WHY THIS FILE EXISTS. Round 6 of the autonomous audit, 1 Aug 2026. The guard
# used to ask `tpl.indexOf('{{P_STREAMING}}') !== -1`, which proves a token is
# somewhere in the file and nothing more. The auditor replaced the visible
# figure with today's correct literal and parked the token in a detached HTML
# comment inside #proof. Every value check still passed, because the severed
# literal equalled the model that morning, and the full gate exited 0. The
# figure would have gone stale at the next daily refresh with nothing to say so.
#
# A guard that has never been watched to fail is not a guard, so each mutation
# below is applied to an ISOLATED copy of HEAD and its bare exit code is read.
# Nothing here touches the working tree. Run it bare and read $?; a pipe would
# report the pipe's status, which has already fooled this project once.
#
#   sh build/proof-binding-controls.sh
#
# Contract: every mutation must exit NON-ZERO, and the unmutated clean control
# must exit ZERO, and the clean control runs last so a harness that has silently
# stopped mutating anything cannot end on a pass.

set -u

REPO=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/proof-binding-controls.XXXXXX")
TPL=build/templates/home.html
FAILURES=0
RAN=0

cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT INT TERM

# isolate <name> -> prints the path of a fresh unmutated copy of the TRACKED
# WORKING TREE. Deliberately the working tree and not `git archive HEAD`: this
# harness is wired into build/ship.sh, which runs unattended at 04:32. Copying
# HEAD would build tomorrow's guard against yesterday's data, so the clean
# control could fail on a morning when nothing is wrong — and an instrument that
# takes the deploy down with nobody awake is worse than the fault it guards
# against. Isolating the same bytes step 1/5 already prerendered means the clean
# control can only fail where step 1 would have failed first and aborted anyway.
isolate() {
  d="$WORK/$1"
  mkdir -p "$d"
  ( cd "$REPO" && git ls-files -z | tar -cf - --null -T - ) | tar -xf - -C "$d" || return 1
  printf '%s' "$d"
}

# control <expected-exit> <name> <description>   (mutation already applied in $d)
control() {
  want=$1; name=$2; desc=$3
  ( cd "$d" && node build/prerender.js ) >"$WORK/$name.log" 2>&1
  got=$?
  RAN=$((RAN + 1))
  if [ "$want" = "nonzero" ]; then
    if [ "$got" -ne 0 ]; then
      printf '  PASS  %-28s exit %-3s  %s\n' "$name" "$got" "$desc"
    else
      printf '  FAIL  %-28s exit %-3s  %s\n' "$name" "$got" "$desc"
      printf '        the mutation was NOT caught; this is the defect the file guards\n'
      FAILURES=$((FAILURES + 1))
    fi
  else
    if [ "$got" -eq 0 ]; then
      printf '  PASS  %-28s exit %-3s  %s\n' "$name" "$got" "$desc"
    else
      printf '  FAIL  %-28s exit %-3s  %s\n' "$name" "$got" "$desc"
      printf '        the CLEAN build failed; the guard is now rejecting honest markup\n'
      sed -n '1,12p' "$WORK/$name.log" | sed 's/^/        /'
      FAILURES=$((FAILURES + 1))
    fi
  fi
}

echo "proof-binding controls — isolated copies of the tracked working tree"
echo

# ---- 1. the exact Round 6 finding: visible field severed, token parked ------
d=$(isolate detached-streaming)
python3 - "$d/$TPL" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
assert s.count('{{P_STREAMING}}') == 1, 'template no longer has exactly one {{P_STREAMING}}'
s = s.replace('{{P_STREAMING}}', '560', 1)
s = s.replace('<section class="proof" id="proof">',
              '<section class="proof" id="proof"><!--{{P_STREAMING}}-->', 1)
open(p, 'w', encoding='utf-8').write(s)
PY
control nonzero detached-streaming "visible {{P_STREAMING}} -> 560, token parked in a comment"

# ---- 2. same shape on the floor, which is prose, not a tile ------------------
d=$(isolate detached-streamfloor)
python3 - "$d/$TPL" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
assert s.count('{{P_STREAMFLOOR}}') == 1, 'template no longer has exactly one {{P_STREAMFLOOR}}'
s = s.replace('{{P_STREAMFLOOR}}', '≥58%', 1)
s = s.replace('<section class="proof" id="proof">',
              '<section class="proof" id="proof"><!--{{P_STREAMFLOOR}}-->', 1)
open(p, 'w', encoding='utf-8').write(s)
PY
control nonzero detached-streamfloor "visible {{P_STREAMFLOOR}} -> the right floor, token parked"

# ---- 3. the plain case the first guard did catch: keep it caught -------------
d=$(isolate literal-nowifi)
python3 - "$d/$TPL" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
assert s.count('{{P_NOWIFI}}') == 1
s = s.replace('{{P_NOWIFI}}', '131', 1)
open(p, 'w', encoding='utf-8').write(s)
PY
control nonzero literal-nowifi "visible {{P_NOWIFI}} -> 131 with no token left anywhere"

# ---- 4. a second visible copy makes 'which field cleared?' ambiguous ---------
d=$(isolate duplicate-legacy)
python3 - "$d/$TPL" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
s = s.replace('<section class="proof" id="proof">',
              '<section class="proof" id="proof"><span hidden>{{P_LEGACY}}</span>', 1)
open(p, 'w', encoding='utf-8').write(s)
PY
control nonzero duplicate-legacy "a second visible {{P_LEGACY}} outside the field that renders it"

# ---- 5. the field's own element renamed out from under the token ------------
d=$(isolate unbound-streaming-element)
python3 - "$d/$TPL" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
s = s.replace('<span class="streaming-only">{{P_STREAMING}}</span></b>',
              '<span class="streaming-only">{{P_STREAMING}}</span></i>', 1)
assert s.count('<span class="streaming-only">{{P_STREAMING}}</span></i>') == 1, \
    'streaming binding mutation did not land exactly once'
open(p, 'w', encoding='utf-8').write(s)
PY
control nonzero unbound-streaming-element "token kept, but no longer inside the element it binds"

# ---- 6. severed with NO comment, so the structural half is exercised alone ---
# Control 1 could in principle be caught by comment-stripping only. This one
# parks the token in ordinary markup, so the field-to-element association is the
# single thing standing between the mutation and a green build.
d=$(isolate severed-no-comment)
python3 - "$d/$TPL" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
s = s.replace('{{P_STREAMING}}', '560', 1)
s = s.replace('<section class="proof" id="proof">',
              '<section class="proof" id="proof"><span hidden>{{P_STREAMING}}</span>', 1)
open(p, 'w', encoding='utf-8').write(s)
PY
control nonzero severed-no-comment "visible field -> 560, token parked in plain markup"

# ---- 7. clean control, last, so the harness cannot end on a stale pass -------
d=$(isolate clean)
control zero clean "the unmutated tracked working tree"

echo
if [ "$FAILURES" -eq 0 ]; then
  echo "proof-binding controls: $RAN/$RAN behaved."
  exit 0
fi
echo "proof-binding controls: $FAILURES of $RAN did NOT behave."
exit 1
