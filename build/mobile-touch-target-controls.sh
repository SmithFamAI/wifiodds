#!/bin/sh
# Prove the focused phone target check catches the old footer dimensions, then
# prove the committed page remains valid. A passing mutation is a failed guard.
set -eu
cd "$(dirname "$0")/.."

expected=3
observed=0

if MOBILE_TARGET_MUTATION=footer-nav-shrink node build/mobile-touch-targets.test.mjs >/dev/null 2>&1; then
  echo "FAIL footer-nav-shrink: planted undersized links escaped" >&2
  exit 1
fi
observed=$((observed + 1))
echo "PASS footer-nav-shrink: planted undersized links were caught"

if MOBILE_TARGET_MUTATION=feature-tour-shrink node build/mobile-touch-targets.test.mjs >/dev/null 2>&1; then
  echo "FAIL feature-tour-shrink: planted undersized homepage link escaped" >&2
  exit 1
fi
observed=$((observed + 1))
echo "PASS feature-tour-shrink: planted undersized homepage link was caught"

node build/mobile-touch-targets.test.mjs
observed=$((observed + 1))
echo "PASS clean: supported phone targets remain valid"

[ "$observed" -eq "$expected" ] || {
  echo "FAIL control count: expected $expected, observed $observed" >&2
  exit 1
}
echo "mobile touch-target controls: $observed/$expected behaved"
