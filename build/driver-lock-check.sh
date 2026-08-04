#!/bin/sh
# Enforce the shared WiFi Odds driver lock on commit, push, and ship paths.
#
# A live lock held by another driver blocks. Every other lock failure is loud
# but open: the unattended refresh must not be wedged by a missing or malformed
# coordination file.

set -u

LOCK=${WIFIODDS_DRIVER_LOCK_FILE:-"$HOME/Projects/wifiodds-relay/exchange/.driver-lock"}
ME=${WIFIODDS_DRIVER_ID:-}

allow_open() {
  echo "driver-lock: ALLOW (could not verify contention: $1; lock=$LOCK)" >&2
  exit 0
}

field() {
  sed -n "s/^$1=//p" "$LOCK" 2>/dev/null | head -1
}

[ -e "$LOCK" ] || allow_open "lock file absent"
[ -r "$LOCK" ] || allow_open "lock file unreadable"
[ -s "$LOCK" ] || allow_open "lock file empty"

holder=$(field driver)
pid=$(field pid)
claimed=$(field claimed_at)
expires=$(field expires_at)
expires_epoch=$(field expires_epoch)

[ -n "$holder" ] || allow_open "driver is missing"
[ -n "$claimed" ] || allow_open "claimed_at is missing"
[ -n "$expires" ] || allow_open "expires_at is missing"
case "$expires_epoch" in
  ''|*[!0-9]*) allow_open "expires_epoch is unparseable" ;;
esac
case "$pid" in
  ''|*[!0-9]*) allow_open "pid is unparseable" ;;
esac

now=$(date +%s 2>/dev/null) || allow_open "current time is unavailable"
[ "$now" -lt "$expires_epoch" ] || allow_open "lock expired at $expires"

if [ "$pid" != 0 ] && ! kill -0 "$pid" 2>/dev/null; then
  allow_open "holder pid $pid is not alive"
fi

if [ -n "$ME" ] && [ "$holder" = "$ME" ]; then
  exit 0
fi

echo "" >&2
echo "DRIVER LOCK BLOCKED — another live driver holds the WiFi Odds repositories." >&2
echo "" >&2
echo "  holder:  $holder" >&2
echo "  caller:  ${ME:-<WIFIODDS_DRIVER_ID unset>}" >&2
echo "  claimed: $claimed" >&2
echo "  expires: $expires" >&2
echo "" >&2
echo "Claim the lock with your own WIFIODDS_DRIVER_ID after the current holder releases it." >&2
echo "Nothing was committed or pushed." >&2
exit 1
