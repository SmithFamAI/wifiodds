#!/bin/bash
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
HELPER="$ROOT/build/revert-data-deploy.sh"
REFRESH="${WIFIODDS_EXCHANGE:-$HOME/Projects/wifiodds-relay/exchange}/daily-data-refresh.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }

# A registered driver must let ship.sh perform its established isolated-worktree
# integration. The old helper manually pushed from the primary main tree.
grep -Fq 'bash build/ship.sh' "$HELPER" || fail "rollback helper does not hand integration to ship.sh"
! grep -Fq 'git -C "$MAIN_TREE" push origin HEAD:main' "$HELPER" || fail "rollback helper still pushes from primary main tree"

# A single stale cache read is not evidence of a bad deployment. The scheduler
# must ask the verifier for consecutive failed samples before invoking rollback.
grep -Fq 'ROLLBACK_CANARY_SAMPLES=${ROLLBACK_CANARY_SAMPLES:-3}' "$REFRESH" || fail "refresh has no multi-sample rollback control"
grep -Fq 'ROLLBACK_CANARY_INTERVAL=${ROLLBACK_CANARY_INTERVAL:-30}' "$REFRESH" || fail "refresh has no configurable canary interval"
grep -Fq '[ "$VERIFY_FAILURES" -ge "$ROLLBACK_CANARY_SAMPLES" ]' "$REFRESH" || fail "refresh can still roll back after one stale sample"

echo "PASS: rollback helper uses ship integration and canary requires consecutive failures"
