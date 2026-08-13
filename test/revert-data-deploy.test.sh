#!/bin/bash
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
HELPER="$ROOT/build/revert-data-deploy.sh"
SHIP="$ROOT/build/ship.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }

grep -Fq 'bash build/ship.sh' "$HELPER" || fail "rollback helper does not hand integration to ship.sh"
! grep -Fq 'git -C "$MAIN_TREE" push origin HEAD:main' "$HELPER" || fail "rollback helper still pushes from primary main tree"
grep -Fq 'bash test/revert-data-deploy.test.sh' "$SHIP" || fail "ship gate does not run rollback control"

echo "PASS: rollback helper uses ship integration and gate runs the control"
