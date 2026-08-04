#!/bin/sh
# install-ship-hook.sh — put the driver lock and API suite on git's write path.
#
#   sh build/install-ship-hook.sh              # install
#   sh build/install-ship-hook.sh --uninstall  # remove and restore prior hooks
#
# Hooks are not versioned, so this must run once per clone. Re-running is safe.
# `git commit --no-verify` and `git push --no-verify` remain the explicit
# emergency bypasses.
set -e

REPO=${WIFIODDS_HOOK_REPO:-"$(cd "$(dirname "$0")/.." && pwd)"}
HOOKS=$(git -C "$REPO" rev-parse --git-path hooks 2>/dev/null) \
  || { echo "not a git worktree: $REPO" >&2; exit 2; }
case "$HOOKS" in
  /*) ;;
  *) HOOKS="$REPO/$HOOKS" ;;
esac
mkdir -p "$HOOKS"
PRE_COMMIT="$HOOKS/pre-commit"
PRE_PUSH="$HOOKS/pre-push"
MARKER='Installed by build/install-ship-hook.sh.'

restore_hook() {
  hook=$1
  backup="$hook.before-wifiodds"
  if [ -f "$backup" ]; then
    mv "$backup" "$hook"
    echo "restored $hook"
  else
    rm -f "$hook"
    echo "removed $hook"
  fi
}

if [ "${1:-}" = "--uninstall" ]; then
  for hook in "$PRE_COMMIT" "$PRE_PUSH"; do
    if [ -f "$hook" ] && grep -Fq "$MARKER" "$hook" 2>/dev/null; then
      restore_hook "$hook"
    else
      echo "skip $hook — not installed by this script"
    fi
  done
  exit 0
fi

save_existing() {
  hook=$1
  if [ -f "$hook" ] && ! grep -Fq "$MARKER" "$hook" 2>/dev/null; then
    # The active non-managed hook is authoritative. Overwrite any stale backup
    # left by an earlier installation so reinstalling can never discard a hook
    # another tool or person installed in the meantime.
    cp "$hook" "$hook.before-wifiodds"
    echo "kept existing hook at $hook.before-wifiodds"
  fi
}

save_existing "$PRE_COMMIT"
save_existing "$PRE_PUSH"

cat > "$PRE_COMMIT" <<'HOOK_EOF'
#!/bin/sh
# Driver-lock gate. Installed by build/install-ship-hook.sh.
ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0

if [ -f "$ROOT/build/driver-lock-check.sh" ]; then
  sh "$ROOT/build/driver-lock-check.sh" || exit $?
else
  echo "driver-lock: ALLOW (could not verify contention: checker is missing)" >&2
fi

# Preserve the prose ratchet (or any other pre-existing local hook) rather than
# silently replacing it.
HOOK_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)
OLD="$HOOK_DIR/pre-commit.before-wifiodds"
[ -x "$OLD" ] && exec "$OLD" "$@"
exit 0
HOOK_EOF

cat > "$PRE_PUSH" <<'HOOK_EOF'
#!/bin/sh
# Driver-lock and API gates. Installed by build/install-ship-hook.sh.
ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0

if [ -f "$ROOT/build/driver-lock-check.sh" ]; then
  sh "$ROOT/build/driver-lock-check.sh" || exit $?
else
  echo "driver-lock: ALLOW (could not verify contention: checker is missing)" >&2
fi

if [ -f "$ROOT/build/apitest.js" ]; then
  if ! node "$ROOT/build/apitest.js" >/tmp/.wo-prepush.log 2>&1; then
    echo "" >&2
    echo "PUSH BLOCKED — build/apitest.js is failing." >&2
    echo "" >&2
    tail -25 /tmp/.wo-prepush.log >&2
    echo "" >&2
    echo "Fix it, or push with --no-verify for a real emergency and say so in" >&2
    echo "the commit message." >&2
    exit 1
  fi
fi

HOOK_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)
OLD="$HOOK_DIR/pre-push.before-wifiodds"
[ -x "$OLD" ] && exec "$OLD" "$@"
exit 0
HOOK_EOF

chmod +x "$PRE_COMMIT" "$PRE_PUSH"
echo "installed $PRE_COMMIT"
echo "installed $PRE_PUSH"
echo "driver id: export WIFIODDS_DRIVER_ID=<your-driver-id>"
