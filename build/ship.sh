#!/bin/bash
# ship.sh — the only sanctioned way to publish this site.
#
# WHY THIS EXISTS. On 26 Jul 2026 the 04:32 refresh committed 13b5860 and pushed
# it to main while `node build/apitest.js` was failing six checks. Production
# carried a red suite for 38 minutes and nothing said so.
#
# The gate was not missing. The scheduled task's own prompt already said, in
# plain words, "if it exits non-zero: do NOT commit, do NOT push". It was simply
# not followed. That is the third time this project has been bitten by the same
# shape: .assetsignore was believed to block a deploy and did nothing, a model
# doctrine was enforced in one paused shell script, and a verification rule sat
# in a prompt nobody executed. A rule that lives somewhere the runtime does not
# read is not a rule, it is a wish.
#
# So the gate is code now. Any agent, any human, any scheduled task that ships
# by calling this script gets the check whether or not it read the instructions.
#
# WHAT IT DOES NOT DO: it never hard-exits in a way that leaves the tree
# mangled, and it never pushes a failed build. On failure it leaves the working
# tree exactly as the build left it and returns non-zero with a legible reason.
# That is heal-and-log: the deploy is protected, the work is preserved, and the
# morning session can see the whole state with `git status`. A process that
# takes the deploy down at 04:32 with nobody awake is worse than the fault it
# was guarding against — see reconcileUnited() in build/prerender.js.
#
# Usage:
#   bash build/ship.sh "commit message"      # build, verify, commit, push main
#   bash build/ship.sh --check-only          # build + verify, touch nothing
#
set -uo pipefail
cd "$(dirname "$0")/.." || exit 90

TREE_SNAPSHOT_FILES=""
cleanup_tree_snapshots() {
  [ -z "$TREE_SNAPSHOT_FILES" ] || rm -f $TREE_SNAPSHOT_FILES
}
trap cleanup_tree_snapshots EXIT

snapshot_tracked_tree() {
  out="$1"
  : > "$out"
  git ls-files -z | while IFS= read -r -d '' path; do
    if [ -f "$path" ]; then
      shasum -a 256 "$path"
    else
      printf '%064d  %s\n' 0 "$path"
    fi
  done > "$out"
}

CHECK_ONLY=""
MSG=""
for a in "$@"; do
  case "$a" in
    --check-only) CHECK_ONLY=1 ;;
    *) MSG="$a" ;;
  esac
done

fail() { echo ""; echo "SHIP ABORTED: $1"; echo "Nothing was committed and nothing was pushed."; echo "The working tree is exactly as the build left it; run 'git status' to see it."; echo "A surprising result is a claim about the instrument until proven otherwise. Before filing a defect, prove the instrument is sound — with a control that is known-good, not with a second run."; exit "${2:-1}"; }

echo "── 1/5 prerender ─────────────────────────────────────────"
if ! node build/prerender.js; then
  fail "node build/prerender.js exited non-zero (see its output above)." 91
fi

echo ""
echo "── publication allow-list ────────────────────────────────"
if ! bash build/assemble.sh; then
  fail "build/assemble.sh exited non-zero. The default-deny publication manifest
does not match a safe, complete dist/ tree. Read the named path above." 99
fi

echo ""
echo "── 2/5 api suite ─────────────────────────────────────────"
if ! node build/apitest.js; then
  fail "node build/apitest.js exited non-zero. THIS IS THE 26 JUL FAULT: a cached
figure moved and an assertion still held the old value, or the page and the API
genuinely disagree. Read the failing checks above before doing anything else." 92
fi

echo ""
echo "── 3/5 proof-binding controls ────────────────────────────"
# Round 6, 1 Aug 2026. Steps 1 and 2 are the site's opinion of its own work, and
# the auditor showed that opinion can be wrong in the one way that matters: the
# proof-block guard passed a template whose visible figure had been severed from
# its token, because the token was parked in a comment two lines up. Watching a
# guard succeed proves nothing about whether it can fail. These controls make it
# fail on demand, in isolation, and the clean one runs last. Wired here rather
# than left in a document, because a rule the runtime does not read is a wish.
if ! sh build/proof-binding-controls.sh; then
  fail "build/proof-binding-controls.sh exited non-zero. Either a mutation was NOT
caught — the proof-block binding guard has stopped guarding and a hard-coded
figure can now ship and go stale silently — or the clean control failed, which
means the guard is rejecting honest markup. Read which line said FAIL." 98
fi

# Bind the bytes just verified to the bytes about to be committed. A scheduled
# refresh or overlapping driver can otherwise write into the tree after the
# green suite and ride into this commit without ever being checked.
VERIFIED_TREE="$(mktemp)"
TREE_SNAPSHOT_FILES="$TREE_SNAPSHOT_FILES $VERIFIED_TREE"
snapshot_tracked_tree "$VERIFIED_TREE"

if [ -n "$CHECK_ONLY" ]; then
  echo ""
  # Truthful, not reassuring: a clean clone made on the other side of a UTC-day
  # boundary once left `M sitemap.xml` in the tree while this line still said
  # "Nothing staged" (P2-02). check-only writes files to disk exactly like a
  # real ship does; only staging and pushing are skipped. So assert what the
  # build actually did to the tracked tree instead of a fixed sentence.
  TREE_DIFF=$(git status --porcelain -- . ':!node_modules' 2>/dev/null | grep -v '^??' || true)
  if [ -z "$TREE_DIFF" ]; then
    echo "── check-only: build and suite are green. Working tree is clean; the build changed no tracked file. ──"
  else
    echo "── check-only: build and suite are green, but the build changed tracked files relative to HEAD: ──"
    echo "$TREE_DIFF" | sed 's/^/  /'
    echo "── This is NOT \"nothing staged\" — a real ship would stage and commit the paths above. ──"
  fi
  exit 0
fi

[ -n "$MSG" ] || fail "no commit message given. Usage: bash build/ship.sh \"message\"" 93

echo ""
echo "── 4/5 stage ─────────────────────────────────────────────"
# Explicit paths only. NEVER `git add .` — this tree holds other people's
# drafts and that rule has already caught one real staging mistake.
CHANGED=$(git status --porcelain | awk '{print $2}')
if [ -z "$CHANGED" ]; then echo "nothing changed; not committing."; exit 0; fi
if git status --porcelain | grep -q '^??'; then
  echo "Untracked files present:"; git status --porcelain | grep '^??'
  fail "untracked files in the tree. Stage them deliberately, then re-run. This
script will not guess which new files belong in a public deploy." 94
fi
git add -u
echo "$CHANGED" | sed 's/^/  /'

echo ""
echo "── 5/5 commit and push ───────────────────────────────────"
CURRENT_TREE="$(mktemp)"
TREE_SNAPSHOT_FILES="$TREE_SNAPSHOT_FILES $CURRENT_TREE"
snapshot_tracked_tree "$CURRENT_TREE"
# Negative-control only: exercises the same compare/diagnostic path without
# touching a product byte. A real ship never sets this environment variable.
if [ "${SHIP_TREE_GUARD_CONTROL:-}" = "1" ]; then
  printf '%064d  %s\n' 1 '<deliberate-tree-guard-control>' >> "$CURRENT_TREE"
fi
if ! cmp -s "$VERIFIED_TREE" "$CURRENT_TREE"; then
  echo "Verified tree changed after the suite passed:" >&2
  diff -u "$VERIFIED_TREE" "$CURRENT_TREE" >&2 || true
  fail "tracked bytes changed between verification and commit. Re-run the suite
against the tree that would actually ship." 99
fi
echo "verified-tree guard OK: commit bytes match the post-suite snapshot"
git commit -m "$MSG" || fail "git commit failed (the pre-commit prose ratchet may have blocked it)." 95
git push origin HEAD || fail "git push failed. The commit exists locally." 96

BR=$(git rev-parse --abbrev-ref HEAD)
if [ "$BR" != "main" ]; then
  git checkout -q main && git merge -q --ff-only "$BR" && git push -q origin main \
    && git checkout -q "$BR" \
    || fail "fast-forward of main from $BR failed; branch is pushed, main is not." 97
fi
echo ""
echo "shipped: $(git rev-parse --short main) on main"
echo "Verify by BODY, never by status code:"
echo "  curl -sS --compressed \"https://wifiodds.com/?cb=\$RANDOM\" | grep -o '<title>[^<]*'"
