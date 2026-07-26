#!/bin/bash
# leak-canary.sh — what of this repo is publicly fetchable from wifiodds.com?
#
# DETECT ONLY. It never deletes a file, never edits config, never commits. An
# auto-remediating monitor on this machine once produced 16 junk commits, 8
# wasted builds and 8 pages to a human on a site that was never broken.
#
# Three properties, each of which exists because the alternative failed in
# production somewhere:
#
#   CONTENT, not status codes. A 200 means the server answered, not that it
#   answered with your file. Sites with an SPA fallback return 200 plus the
#   shell for every missing path, so a leaked file and a blocked file look
#   identical to a status check. We compare bodies against a known-absent
#   baseline instead.
#
#   A CONTROL that VOIDS the run. If a path known to be served does not come
#   back as its own distinct content, the site is down or the network is broken
#   and every "blocked" result is meaningless. That is not a pass. Exit 2.
#
#   ENUMERATION, not a guess list. Paths come from `git ls-files`. Every
#   deny-list ever written here lost to the next filename nobody thought of.
#
# Usage:  bash build/leak-canary.sh [https://wifiodds.com]
# Exit:   0 clean · 1 something internal is served · 2 run void

set -u
SITE="${1:-https://wifiodds.com}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
cd "$ROOT" || exit 2

# Paths that SHOULD be public. Anything served and not matching this is a finding.
PUBLIC='^(index\.html|404\.html|privacy\.html|sitemap\.xml|robots\.txt|llms\.txt|assets/|airlines/|united/|record/|alaska/|race/|systems/|methodology/|roadmap/|api/)'

# Always truncate the body file first: on a dead host curl writes nothing and a
# stale or missing file would make BYTES empty, which compares equal to nothing
# and silently poisons every later comparison.
fetch() {
  : > "$TMP/b"
  CODE=$(curl -sS --compressed --max-time 20 "$SITE/$1?cb=$RANDOM$RANDOM" \
    -o "$TMP/b" -w '%{http_code}' 2>/dev/null) || CODE=000
  BYTES=$(wc -c < "$TMP/b" 2>/dev/null | tr -d ' ')
  [ -z "$BYTES" ] && BYTES=0
}

fetch "__absent_probe_$RANDOM$RANDOM"; MISS=$BYTES
fetch "robots.txt"; CTL=$BYTES; CTLC=$CODE
if [ "$CTLC" != "200" ] || [ "$CTL" = "$MISS" ] || [ "$CTL" = "0" ]; then
  echo "VOID: control /robots.txt returned $CTLC/$CTL b against absent $MISS b."
  echo "The site may be down or the fetch failed. This is not a pass."
  exit 2
fi

FOUND=0
for f in $(git ls-files | grep -v '\[' ); do
  echo "$f" | grep -qE "$PUBLIC" && continue
  fetch "$f"
  [ "$BYTES" = "$MISS" ] && continue
  [ "$BYTES" = "0" ] && continue          # 308/redirect with no body is not a leak
  FOUND=$((FOUND+1)); printf 'SERVED  %-46s %s  %s b\n' "$f" "$CODE" "$BYTES"
done

echo "---"
if [ "$FOUND" = "0" ]; then
  echo "clean: no internal tracked file is publicly served (control ok, absent=$MISS b)"
  exit 0
fi
echo "$FOUND internal file(s) publicly served."
echo "Expected while the Pages build output directory is empty: that publishes the"
echo "repo root. See README > Stack. Escalate only if a file here is sensitive —"
echo "the repo is public, so build scripts being readable discloses nothing new."
exit 1
