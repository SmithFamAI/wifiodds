#!/bin/bash
# Shared content-based live-site probe. Source this file, then call
# live_probe_init ORIGIN CONTROL_PATH. Exit 2 means VOID: the known-good control
# did not prove the instrument could distinguish served content.

live_probe_fetch() {
  probe_path="$1"
  probe_out="$2"
  : > "$probe_out"
  LIVE_PROBE_CODE=$(curl -sS --compressed --max-time 20 \
    "$LIVE_PROBE_SITE/${probe_path#/}?cb=$RANDOM$RANDOM" \
    -o "$probe_out" -w '%{http_code}' 2>/dev/null) || LIVE_PROBE_CODE=000
  LIVE_PROBE_BYTES=$(wc -c < "$probe_out" 2>/dev/null | tr -d ' ')
  [ -n "$LIVE_PROBE_BYTES" ] || LIVE_PROBE_BYTES=0
}

live_probe_void() {
  echo "VOID: live-site control ${LIVE_PROBE_CONTROL_PATH} did not return distinct known-good content." >&2
  echo "The site, network or probe may be broken. This is neither PASS nor FAIL." >&2
  return 2
}

live_probe_init() {
  LIVE_PROBE_SITE="${1%/}"
  LIVE_PROBE_CONTROL_PATH="${2:-/robots.txt}"
  LIVE_PROBE_TMP="$(mktemp -d)"
  LIVE_PROBE_ROOT="$LIVE_PROBE_TMP/root"
  LIVE_PROBE_ABSENT="$LIVE_PROBE_TMP/absent"
  LIVE_PROBE_CONTROL="$LIVE_PROBE_TMP/control"

  live_probe_fetch / "$LIVE_PROBE_ROOT"
  root_code="$LIVE_PROBE_CODE"; root_bytes="$LIVE_PROBE_BYTES"
  live_probe_fetch "/__absent_probe_$RANDOM$RANDOM" "$LIVE_PROBE_ABSENT"
  absent_code="$LIVE_PROBE_CODE"; absent_bytes="$LIVE_PROBE_BYTES"
  live_probe_fetch "$LIVE_PROBE_CONTROL_PATH" "$LIVE_PROBE_CONTROL"
  control_code="$LIVE_PROBE_CODE"; control_bytes="$LIVE_PROBE_BYTES"

  if [ "$root_code" = 000 ] || [ "$absent_code" = 000 ] || [ "$control_code" = 000 ] || \
     [ "$root_bytes" = 0 ] || [ "$control_bytes" = 0 ] || \
     cmp -s "$LIVE_PROBE_CONTROL" "$LIVE_PROBE_ROOT" || \
     cmp -s "$LIVE_PROBE_CONTROL" "$LIVE_PROBE_ABSENT"; then
    echo "VOID detail: root=${root_code}/${root_bytes}B absent=${absent_code}/${absent_bytes}B control=${control_code}/${control_bytes}B" >&2
    live_probe_void
    return 2
  fi
  LIVE_PROBE_ROOT_CODE="$root_code"; LIVE_PROBE_ROOT_BYTES="$root_bytes"
  LIVE_PROBE_ABSENT_CODE="$absent_code"; LIVE_PROBE_ABSENT_BYTES="$absent_bytes"
  LIVE_PROBE_CONTROL_CODE="$control_code"; LIVE_PROBE_CONTROL_BYTES="$control_bytes"
  return 0
}

live_probe_classify() {
  live_probe_fetch "$1" "$LIVE_PROBE_TMP/body"
  LIVE_PROBE_BODY="$LIVE_PROBE_TMP/body"
  if [ "$LIVE_PROBE_CODE" = 000 ]; then LIVE_PROBE_STATE=VOID
  elif cmp -s "$LIVE_PROBE_BODY" "$LIVE_PROBE_ABSENT" || cmp -s "$LIVE_PROBE_BODY" "$LIVE_PROBE_ROOT"; then
    LIVE_PROBE_STATE=BLOCKED
  elif [ "$LIVE_PROBE_BYTES" = 0 ]; then LIVE_PROBE_STATE=BLOCKED
  else LIVE_PROBE_STATE=SERVED
  fi
}
