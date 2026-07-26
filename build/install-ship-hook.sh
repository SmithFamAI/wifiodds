#!/bin/sh
# install-ship-hook.sh — put the API suite in front of `git push`.
#
#   sh build/install-ship-hook.sh              # install
#   sh build/install-ship-hook.sh --uninstall  # remove
#
# build/ship.sh is the sanctioned way to publish and it runs the suite itself.
# This hook exists for the case that actually bit us on 26 Jul 2026: a push that
# never went through ship.sh at all. The scheduled refresh had the rule written
# in its prompt, did not follow it, and put a red suite on production for 38
# minutes. A rule the runtime does not enforce is not a rule.
#
# Git hooks are not versioned, so this must be run once per clone. Running it
# again is safe. `--no-verify` still bypasses it, which is correct: this is a
# guard rail, not a lock, and there are legitimate emergencies.
#
# It does NOT run the full build. prerender.js rewrites tracked files, and a
# hook that mutates the tree mid-push would be worse than the fault. It runs the
# suite against whatever is already built, which is exactly the thing that was
# wrong in July: the committed HTML disagreeing with the committed API module.
set -e

REPO="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$REPO/.git/hooks/pre-push"

if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$HOOK" && echo "removed $HOOK"
  exit 0
fi

cat > "$HOOK" <<'HOOK_EOF'
#!/bin/sh
# Blocks a push when the API suite is red. Installed by build/install-ship-hook.sh.
REPO="$(git rev-parse --show-toplevel)"
[ -f "$REPO/build/apitest.js" ] || exit 0

if node "$REPO/build/apitest.js" >/tmp/.wo-prepush.log 2>&1; then
  exit 0
fi

echo ""
echo "PUSH BLOCKED — build/apitest.js is failing."
echo ""
tail -25 /tmp/.wo-prepush.log
echo ""
echo "This is the 26 Jul 2026 fault: the daily refresh pushed a red suite to main"
echo "and production carried it for 38 minutes. Usually a cached figure moved and"
echo "an assertion still holds the old value, or a page and the API genuinely"
echo "disagree — in which case the API is wrong and the page is the record."
echo ""
echo "Fix it, or push with --no-verify if this is a real emergency and say so in"
echo "the commit message."
exit 1
HOOK_EOF

chmod +x "$HOOK"
echo "installed $HOOK"
echo "verify:  cd $REPO && git push --dry-run 2>&1 | tail -3"
