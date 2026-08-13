#!/bin/bash
# Revert one failed data deployment without rewriting history.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2
BAD_SHA=${1:-}
[ -n "$BAD_SHA" ] || { echo "usage: build/revert-data-deploy.sh <deployed-sha>" >&2; exit 2; }
[ -n "${WIFIODDS_DRIVER_ID:-}" ] || { echo "WIFIODDS_DRIVER_ID is required" >&2; exit 2; }
sh build/driver-lock-check.sh || exit 3
[ -z "$(git status --porcelain --untracked-files=normal)" ] || { echo "rollback refused: worktree is dirty" >&2; exit 4; }

git fetch origin main || exit 5
REMOTE=$(git rev-parse origin/main) || exit 5
FULL=$(git rev-parse "$BAD_SHA^{commit}") || exit 5
[ "$REMOTE" = "$FULL" ] || { echo "rollback refused: origin/main moved after $BAD_SHA" >&2; exit 6; }

git revert --no-commit "$FULL" || exit 7
WIFIODDS_DRIVER_ID="$WIFIODDS_DRIVER_ID" git commit -m "revert failed daily data deploy $BAD_SHA" \
  -m "Driver: $WIFIODDS_DRIVER_ID" || exit 7
# ship.sh owns the branch push and isolated-worktree fast-forward into main.
# Direct integration here used the primary main tree, which the registered
# driver hook correctly rejects.
WIFIODDS_DRIVER_ID="$WIFIODDS_DRIVER_ID" bash build/ship.sh "revert failed daily data deploy $BAD_SHA" || exit 8
echo "reverted $FULL with $(git rev-parse HEAD)"
