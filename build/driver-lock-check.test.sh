#!/bin/sh
set -u

ROOT=$(cd "$(dirname "$0")/.." && pwd)
CHECK="$ROOT/build/driver-lock-check.sh"
INSTALL="$ROOT/build/install-ship-hook.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
LOCK="$TMP/.driver-lock"
PASS=0
FAIL=0

ok() { PASS=$((PASS + 1)); echo "ok $PASS - $1"; }
bad() { FAIL=$((FAIL + 1)); echo "not ok - $1"; }

run_expect() {
  label=$1 expected=$2 driver=$3
  if WIFIODDS_DRIVER_LOCK_FILE="$LOCK" WIFIODDS_DRIVER_ID="$driver" sh "$CHECK" >"$TMP/out" 2>&1; then
    actual=0
  else
    actual=$?
  fi
  if [ "$actual" -eq "$expected" ]; then ok "$label"; else
    bad "$label (wanted $expected, got $actual: $(tr '\n' ' ' < "$TMP/out"))"
  fi
}

write_lock() {
  driver=$1 pid=$2 expires_epoch=$3
  cat > "$LOCK" <<EOF
driver=$driver
pid=$pid
host=test
claimed_at=2026-08-03T00:00:00Z
expires_at=2099-01-01T00:00:00Z
expires_epoch=$expires_epoch
note=control
EOF
}

rm -f "$LOCK"
run_expect "absent lock fails open" 0 alpha
: > "$LOCK"
run_expect "empty lock fails open" 0 alpha
printf 'not-a-lock\n' > "$LOCK"
run_expect "corrupt lock fails open" 0 alpha
write_lock alpha "$$" 1
run_expect "expired lock fails open" 0 beta
write_lock alpha 99999999 4102444800
run_expect "dead holder pid fails open" 0 beta
write_lock alpha "$$" 4102444800
run_expect "matching live holder passes" 0 alpha
run_expect "different live holder blocks" 1 beta
run_expect "unset identity blocks on a live lock" 1 ""

# Install into a throwaway repository, then exercise both generated hooks.
FAKE="$TMP/repo"
mkdir -p "$FAKE/.git/hooks" "$FAKE/build"
cp "$CHECK" "$FAKE/build/driver-lock-check.sh"
printf '#!/bin/sh\nexit 0\n' > "$FAKE/.git/hooks/pre-commit"
printf '#!/bin/sh\nprintf "old-pre-push-ran\\n" >> "$HOOK_CONTROL_LOG"\n' > "$FAKE/.git/hooks/pre-push"
chmod +x "$FAKE/.git/hooks/pre-commit"
chmod +x "$FAKE/.git/hooks/pre-push"
printf 'process.exit(0);\n' > "$FAKE/build/apitest.js"
git -C "$FAKE" init -q
WIFIODDS_HOOK_REPO="$FAKE" sh "$INSTALL" >"$TMP/install.out" 2>&1

write_lock alpha "$$" 4102444800
if (cd "$FAKE" && WIFIODDS_DRIVER_LOCK_FILE="$LOCK" WIFIODDS_DRIVER_ID=alpha .git/hooks/pre-commit); then
  ok "installed pre-commit allows holder"
else bad "installed pre-commit rejected holder"; fi
if (cd "$FAKE" && WIFIODDS_DRIVER_LOCK_FILE="$LOCK" WIFIODDS_DRIVER_ID=beta .git/hooks/pre-commit >"$TMP/hook.out" 2>&1); then
  bad "installed pre-commit allowed contention"
else ok "installed pre-commit blocks contention"; fi
if (cd "$FAKE" && HOOK_CONTROL_LOG="$TMP/old-hook.log" WIFIODDS_DRIVER_LOCK_FILE="$LOCK" \
    WIFIODDS_DRIVER_ID=alpha .git/hooks/pre-push); then
  ok "installed pre-push allows holder"
else bad "installed pre-push rejected holder"; fi
if (cd "$FAKE" && WIFIODDS_DRIVER_LOCK_FILE="$LOCK" WIFIODDS_DRIVER_ID=beta .git/hooks/pre-push >"$TMP/hook.out" 2>&1); then
  bad "installed pre-push allowed contention"
else ok "installed pre-push blocks contention"; fi

# A missing API suite must not skip the preserved hook.
rm -f "$FAKE/build/apitest.js" "$TMP/old-hook.log"
if (cd "$FAKE" && HOOK_CONTROL_LOG="$TMP/old-hook.log" WIFIODDS_DRIVER_LOCK_FILE="$LOCK" \
    WIFIODDS_DRIVER_ID=alpha .git/hooks/pre-push) \
    && grep -q '^old-pre-push-ran$' "$TMP/old-hook.log"; then
  ok "pre-push runs the preserved hook when apitest is absent"
else bad "pre-push skipped the preserved hook when apitest was absent"; fi

# If another tool replaces an installed hook, that active replacement wins on
# reinstall even when an older backup exists.
cat > "$FAKE/.git/hooks/pre-commit" <<'EOF'
#!/bin/sh
printf 'replacement-pre-commit-ran\n' >> "$HOOK_CONTROL_LOG"
EOF
cat > "$FAKE/.git/hooks/pre-push" <<'EOF'
#!/bin/sh
printf 'replacement-pre-push-ran\n' >> "$HOOK_CONTROL_LOG"
EOF
chmod +x "$FAKE/.git/hooks/pre-commit" "$FAKE/.git/hooks/pre-push"
WIFIODDS_HOOK_REPO="$FAKE" sh "$INSTALL" >"$TMP/reinstall.out" 2>&1
rm -f "$TMP/replacement-hook.log"
if (cd "$FAKE" && HOOK_CONTROL_LOG="$TMP/replacement-hook.log" \
    WIFIODDS_DRIVER_LOCK_FILE="$LOCK" WIFIODDS_DRIVER_ID=alpha .git/hooks/pre-commit) \
    && (cd "$FAKE" && HOOK_CONTROL_LOG="$TMP/replacement-hook.log" \
      WIFIODDS_DRIVER_LOCK_FILE="$LOCK" WIFIODDS_DRIVER_ID=alpha .git/hooks/pre-push) \
    && grep -q '^replacement-pre-commit-ran$' "$TMP/replacement-hook.log"; then
  if grep -q '^replacement-pre-push-ran$' "$TMP/replacement-hook.log"; then
    ok "reinstall preserves the current replacement hooks"
  else bad "reinstall lost the current replacement pre-push"; fi
else bad "reinstall lost the current replacement pre-commit"; fi

WIFIODDS_HOOK_REPO="$FAKE" sh "$INSTALL" --uninstall >"$TMP/uninstall.out" 2>&1
if grep -q 'replacement-pre-commit-ran' "$FAKE/.git/hooks/pre-commit" \
    && ! grep -q 'driver-lock gate' "$FAKE/.git/hooks/pre-commit" \
    && grep -q 'replacement-pre-push-ran' "$FAKE/.git/hooks/pre-push" \
    && ! grep -q 'Driver-lock and API gates' "$FAKE/.git/hooks/pre-push"; then
  ok "uninstall restores the latest replacement hooks"
else bad "uninstall restored a stale replacement hook"; fi

# core.hooksPath is part of git's runtime path and must be authoritative.
HOOKPATH_REPO="$TMP/hookpath-repo"
mkdir -p "$HOOKPATH_REPO/build"
git -C "$HOOKPATH_REPO" init -q
git -C "$HOOKPATH_REPO" config core.hooksPath runtime-hooks
cp "$CHECK" "$HOOKPATH_REPO/build/driver-lock-check.sh"
WIFIODDS_HOOK_REPO="$HOOKPATH_REPO" sh "$INSTALL" >"$TMP/hookpath-install.out" 2>&1
if grep -Fq 'Installed by build/install-ship-hook.sh.' "$HOOKPATH_REPO/runtime-hooks/pre-commit" \
    && grep -Fq 'Installed by build/install-ship-hook.sh.' "$HOOKPATH_REPO/runtime-hooks/pre-push" \
    && [ ! -e "$HOOKPATH_REPO/.git/hooks/pre-commit" ]; then
  ok "installer honors core.hooksPath"
else bad "installer wrote outside core.hooksPath"; fi

# Exercise the real ship script in a minimal local repository. The build tools
# are controls that return green; the assertion is on the resulting commit.
SHIP_REPO="$TMP/ship-repo"
SHIP_REMOTE="$TMP/ship-remote.git"
mkdir -p "$SHIP_REPO/build" "$SHIP_REPO/bin"
cp "$ROOT/build/ship.sh" "$SHIP_REPO/build/ship.sh"
cp "$CHECK" "$SHIP_REPO/build/driver-lock-check.sh"
if grep -Fq 'git -C "$MAIN_TREE" push' "$SHIP_REPO/build/ship.sh"; then
  bad "ship resume pushes from the protected main integration tree"
else ok "ship resume pushes the reviewed branch through its owning worktree"; fi
printf '#!/bin/sh\nexit 0\n' > "$SHIP_REPO/build/assemble.sh"
printf '#!/bin/sh\nexit 0\n' > "$SHIP_REPO/build/proof-binding-controls.sh"
printf '#!/bin/sh\nexit 0\n' > "$SHIP_REPO/bin/node"
chmod +x "$SHIP_REPO/build/assemble.sh" "$SHIP_REPO/build/proof-binding-controls.sh" "$SHIP_REPO/bin/node"
printf 'before\n' > "$SHIP_REPO/tracked.txt"
git -C "$SHIP_REPO" init -q -b main
git -C "$SHIP_REPO" config user.name control
git -C "$SHIP_REPO" config user.email control@example.invalid
git -C "$SHIP_REPO" add bin build tracked.txt
git -C "$SHIP_REPO" commit -qm initial
git init -q --bare "$SHIP_REMOTE"
git -C "$SHIP_REPO" remote add origin "$SHIP_REMOTE"
printf 'after\n' > "$SHIP_REPO/tracked.txt"

# Shipping without an identity must stop before any commit is created.
before_head=$(git -C "$SHIP_REPO" rev-parse HEAD)
rm -f "$LOCK"
if (cd "$SHIP_REPO" && PATH="$SHIP_REPO/bin:$PATH" WIFIODDS_DRIVER_LOCK_FILE="$LOCK" \
    WIFIODDS_DRIVER_ID= bash build/ship.sh "missing identity control" >"$TMP/no-id.out" 2>&1); then
  bad "ship allowed an unset WIFIODDS_DRIVER_ID"
elif [ "$(git -C "$SHIP_REPO" rev-parse HEAD)" = "$before_head" ] \
    && grep -q 'WIFIODDS_DRIVER_ID is unset' "$TMP/no-id.out"; then
  ok "ship rejects an unset WIFIODDS_DRIVER_ID before commit"
else bad "ship rejected missing identity without the required diagnostic"; fi

write_lock alpha "$$" 4102444800
if (cd "$SHIP_REPO" && PATH="$SHIP_REPO/bin:$PATH" WIFIODDS_DRIVER_LOCK_FILE="$LOCK" \
    WIFIODDS_DRIVER_ID=alpha bash build/ship.sh "ship trailer control" >"$TMP/ship.out" 2>&1) \
    && git -C "$SHIP_REPO" log -1 --format=%B | grep -q '^Driver: alpha$'; then
  ok "ship writes the Driver trailer"
else bad "ship did not write the Driver trailer ($(tr '\n' ' ' < "$TMP/ship.out"))"; fi

echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
