#!/bin/bash
# daily-refresh.sh — the unattended daily data refresh, end to end.
#
# Runs from .github/workflows/daily-data.yml every morning, and by hand with
# `bash build/daily-refresh.sh`. It stages a disposable source worktree from
# this repository's own scripts/ and united/data.json, hands it to
# build/prepare-daily-data.sh (fetch, plausibility gate, render, every ship
# gate in check-only mode), then publishes through build/ship.sh, which is the
# only sanctioned way to push main. Nothing here bypasses a gate: a flagged
# measurement exits non-zero before anything is committed.
#
# One-shot owner rulings pass through the environment and apply only when the
# tracker returns exactly the ruled pair:
#   WIFIODDS_REBASELINE="617/1675:<ruling text>"   United (see update-unitedstarlink.js)
#   WIFIODDS_REBASELINE_ALASKA="105/347"           Alaska (see refresh-airline-counts.js)
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2
export WIFIODDS_DRIVER_ID=${WIFIODDS_DRIVER_ID:-daily-refresh}
TODAY=$(date -u +%F)

SRC=$(mktemp -d)
mkdir -p "$SRC/scripts" "$SRC/public/unitedstarlink"
cp scripts/update-unitedstarlink.js scripts/test-plausibility-gate.js "$SRC/scripts/"
cp united/data.json "$SRC/public/unitedstarlink/data.json"
git -C "$SRC" init -q
git -C "$SRC" add -A
git -C "$SRC" -c user.email=daily@wifiodds.com -c user.name=daily-refresh commit -qm "seed from united/data.json"

# His live badge (unitedstarlinktracker.com/embed), kept on this origin so the
# pages make no third-party request. Refreshed daily; a failed fetch keeps the
# committed copy rather than shipping an empty file.
BADGE_TMP=$(mktemp)
if curl -sS --compressed --max-time 20 -A 'wifiodds-daily/1.0 (+https://wifiodds.com/)' \
     "https://unitedstarlinktracker.com/badge.svg?cb=$RANDOM" -o "$BADGE_TMP" \
   && grep -q '<svg' "$BADGE_TMP" && grep -q 'aircraft' "$BADGE_TMP"; then
  mv "$BADGE_TMP" assets/united-starlink-badge.svg
else
  echo "daily-refresh: badge.svg fetch failed or malformed; keeping the committed copy" >&2
  rm -f "$BADGE_TMP"
fi

bash build/prepare-daily-data.sh "$SRC"
rc=$?
if [ $rc -ne 0 ]; then
  echo "daily-refresh: prepare-daily-data.sh exited $rc; nothing committed, nothing pushed" >&2
  exit $rc
fi

bash build/ship.sh "daily data refresh $TODAY"
rc=$?
rm -rf "$SRC"
exit $rc
