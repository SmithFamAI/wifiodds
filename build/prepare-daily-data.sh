#!/bin/bash
# Fetch, reconcile, render, and gate one daily data candidate. This script does
# not commit, push, or publish. The reviewer policy decides what happens next.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 2
SOURCE=${1:-}
[ -n "$SOURCE" ] || { echo "usage: build/prepare-daily-data.sh <source-worktree>" >&2; exit 2; }
[ -f "$SOURCE/scripts/update-unitedstarlink.js" ] || { echo "source worktree is missing the United updater: $SOURCE" >&2; exit 2; }
[ -n "${WIFIODDS_DRIVER_ID:-}" ] || { echo "WIFIODDS_DRIVER_ID is required" >&2; exit 2; }

if [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
  echo "site worktree must start clean" >&2
  git status --short >&2
  exit 3
fi
if [ -n "$(git -C "$SOURCE" status --porcelain --untracked-files=normal)" ]; then
  echo "source worktree must start clean" >&2
  git -C "$SOURCE" status --short >&2
  exit 3
fi

node "$SOURCE/scripts/test-plausibility-gate.js" || exit 11
(cd "$SOURCE" && node scripts/update-unitedstarlink.js) || exit 12
node -e 'const d=require(process.argv[1]);const f=d.fleet&&d.fleet.plausibility&&d.fleet.plausibility.flags||[];if(f.length){console.error(f.join("\n"));process.exit(1)}' \
  "$SOURCE/public/unitedstarlink/data.json" || { echo "United plausibility flags require review" >&2; exit 13; }

cp "$SOURCE/public/unitedstarlink/data.json" united/data.json || exit 14
node build/refresh-airline-counts.js || exit 15
node build/prerender.js || exit 16
node build/make-og-card.js || exit 17
WIFIODDS_DRIVER_ID="$WIFIODDS_DRIVER_ID" bash build/ship.sh --check-only || exit 18
node build/verify-data-deploy-controls.js || exit 19

if git status --porcelain | grep -q '^??'; then
  echo "candidate produced untracked files" >&2
  git status --short >&2
  exit 20
fi
SOURCE_CHANGED=$(git -C "$SOURCE" status --porcelain --untracked-files=normal | awk '{print $2}')
if [ -n "$SOURCE_CHANGED" ] && [ "$SOURCE_CHANGED" != "public/unitedstarlink/data.json" ]; then
  echo "source refresh changed unexpected paths: $SOURCE_CHANGED" >&2
  exit 21
fi

node - <<'NODE'
const d=require('./united/data.json');
const A=require('./assets/airlines.js').WIFI_AIRLINES;
const last=d.history[d.history.length-1]||{};
console.log(JSON.stringify({
  united:{equipped:d.fleet.equipped,total:d.fleet.total,measurementAsOf:d.measurementAsOf||d.updated,
    topRoutes:(d.leaderboard||[]).slice(0,3),moved:last.moved||[]},
  alaska:{equipped:A.alaska.equipped,total:A.alaska.fleet,asOf:A.alaska.segments[0].as},
  hawaiian:{equipped:A.hawaiian.equipped,total:A.hawaiian.fleet,asOf:A.hawaiian.segments[0].as}
},null,2));
NODE
