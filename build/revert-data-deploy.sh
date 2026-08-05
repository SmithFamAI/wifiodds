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
git push origin HEAD || exit 8

BR=$(git branch --show-current)
if [ "$BR" != "main" ]; then
  MAIN_TREE=$(git worktree list --porcelain | awk '/^worktree /{tree=substr($0,10)} /^branch refs\/heads\/main$/{print tree;exit}')
  [ -n "$MAIN_TREE" ] || exit 9
  [ -z "$(git -C "$MAIN_TREE" status --porcelain --untracked-files=normal)" ] || exit 9
  git -C "$MAIN_TREE" merge --ff-only "$BR" || exit 9
  git -C "$MAIN_TREE" push origin HEAD:main || exit 9
fi
echo "reverted $FULL with $(git rev-parse HEAD)"
