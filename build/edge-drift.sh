#!/bin/bash
# edge-drift.sh — does production serve what this repository produced?
#
# WHY THIS EXISTS. Every other check in build/ reads bytes this build wrote.
# None of them can see anything the edge adds, removes or rewrites on the way
# out. That blind spot has now cost this project three times:
#
#   1. A Cloudflare analytics beacon injected at the edge. No check here could
#      see it, because none of them read anything but our own output.
#   2. `.assetsignore` was believed to keep files off the deploy. It did nothing.
#   3. 28 Jul 2026: robots.txt. This repo publishes 639 bytes; wifiodds.com
#      serves ~2,475. Cloudflare PREPENDS a managed block, and for months the
#      two halves said opposite things about the same crawlers — `Disallow: /`
#      for GPTBot and ClaudeBot above, `Allow: /` for the same agents below.
#      Two matching groups with contradictory directives has no defined
#      outcome; the real policy was whatever each crawler's parser did.
#
# All three are one fault: a rule that lives somewhere the runtime does not read
# is not a rule. This script is the smallest thing that would have caught the
# third one, and it is written to catch the shape rather than that instance.
#
# DETECT ONLY, like build/leak-canary.sh, and for the same reason: an
# auto-remediating monitor on this machine once produced 16 junk commits and 8
# pages to a human on a site that was never broken. This prints and exits. It
# never edits, never commits, never deploys.
#
# NOT WIRED INTO ship.sh ON PURPOSE. ship.sh gates on things the build controls.
# The edge is not one of them: a Cloudflare dashboard change could fail this
# check at 04:32 with nobody awake, and taking the deploy down over a policy
# difference we may have chosen deliberately is worse than the drift. Run it by
# hand, or from a monitor that pages nobody.
#
#   bash build/edge-drift.sh          # exits 0 always; read the output
#   bash build/edge-drift.sh --strict # exits 1 on drift, for a monitor
#
# EXIT CODES: read them BARE. `cmd | tail` reports tail's status, which is how
# this repo previously recorded leak-canary.sh as exiting 0 when it exits 1.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

ORIGIN="https://wifiodds.com"
STRICT=0
[ "${1:-}" = "--strict" ] && STRICT=1
DRIFT=0

# Cache-buster on every fetch. Three separate failures in this project were
# masked by a cached response; a stale 200 is the most convincing wrong answer
# there is.
fetch() { curl -sS --compressed "$ORIGIN$1?cb=$RANDOM$$"; }

echo "edge-drift · $ORIGIN · $(date -u '+%Y-%m-%d %H:%M UTC')"
echo

# ── robots.txt ───────────────────────────────────────────────────────────────
# Byte counts first, because that is the cheap signal that something upstream is
# rewriting the file at all.
LIVE_ROBOTS="$(fetch /robots.txt)"
DISK_BYTES=$(wc -c < robots.txt | tr -d ' ')
LIVE_BYTES=$(printf '%s' "$LIVE_ROBOTS" | wc -c | tr -d ' ')

echo "robots.txt   repo ${DISK_BYTES}B · served ${LIVE_BYTES}B"
if [ "$LIVE_BYTES" != "$DISK_BYTES" ]; then
  echo "             DRIFT: the served file is not this repo's file."
  printf '%s' "$LIVE_ROBOTS" | grep -q "Cloudflare Managed" && \
    echo "             cause: Cloudflare managed content is prepended (dashboard, not code)."
  DRIFT=1
fi

# THE REAL CHECK, and the one the byte count alone would miss. A user-agent that
# appears twice with opposite directives is the fault that actually shipped: the
# file can be a plausible size and still be self-contradictory.
echo
echo "contradictory user-agent groups:"
CONTRA=$(printf '%s\n' "$LIVE_ROBOTS" | awk '
  /^[Uu]ser-agent:/ { ua = tolower($2); next }
  /^[Dd]isallow:[[:space:]]*\/[[:space:]]*$/ { if (ua != "") d[ua] = 1; next }
  /^[Aa]llow:[[:space:]]*\/[[:space:]]*$/    { if (ua != "") a[ua] = 1; next }
  END { for (u in d) if (u in a) print "             " u " is both Allow:/ and Disallow:/" }
')
if [ -n "$CONTRA" ]; then
  echo "$CONTRA"
  echo "             No defined outcome: some parsers merge and take the least"
  echo "             restrictive rule, others take the first matching group."
  DRIFT=1
else
  echo "             none"
fi

# ── the homepage, by BODY ────────────────────────────────────────────────────
# Never by status code. Three failures in this project returned HTTP 200, one of
# them serving a zero-byte body that passed every check for the life of the
# deployment.
echo
HOME_LIVE="$(fetch /)"
for marker in "What are your odds" "sitebar" "application/ld+json"; do
  if printf '%s' "$HOME_LIVE" | grep -q "$marker"; then
    echo "homepage     ok: $marker"
  else
    echo "homepage     MISSING: $marker"
    DRIFT=1
  fi
done

# Anything the edge ADDED that this build never wrote. The beacon incident in
# one line.
echo
echo "injected third-party script hosts on /:"
INJECTED=$(printf '%s' "$HOME_LIVE" \
  | grep -oE '<script[^>]+src="https?://[^"]+"' \
  | grep -oE 'https?://[^/"]+' | sort -u \
  | grep -v 'wifiodds\.com' || true)
if [ -n "$INJECTED" ]; then
  echo "$INJECTED" | sed 's/^/             /'
  echo "             Cross-check against what build/ emits before assuming these are ours."
  DRIFT=1
else
  echo "             none"
fi

echo
if [ "$DRIFT" = "0" ]; then
  echo "RESULT: production matches this repository on every checked surface."
else
  echo "RESULT: DRIFT above. Not necessarily a fault — some of it may be a"
  echo "        deliberate Cloudflare setting. It is always something a human"
  echo "        should have decided rather than discovered."
fi

[ "$STRICT" = "1" ] && [ "$DRIFT" = "1" ] && exit 1
exit 0
