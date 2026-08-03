#!/bin/bash
# assemble.sh — default-deny static publication for Cloudflare Pages.
#
# The repository root contains source, doctrine and build tooling. Cloudflare
# must publish dist/, assembled only from the exact paths in the committed
# manifest. A new tracked filename is therefore private by default.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="${PUBLIC_MANIFEST:-$ROOT/build/public-manifest.txt}"
DIST="${PUBLIC_DIST:-$ROOT/dist}"
cd "$ROOT"

fail() {
  echo "ASSEMBLE FAILED: $1" >&2
  echo "A surprising result is a claim about the instrument until proven otherwise. Before filing a defect, prove the instrument is sound — with a control that is known-good, not with a second run." >&2
  exit 1
}
[ -f "$MANIFEST" ] || fail "manifest not found: $MANIFEST"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PATHS="$TMP/paths"
sed -e 's/[[:space:]]*$//' -e '/^[[:space:]]*#/d' -e '/^[[:space:]]*$/d' "$MANIFEST" > "$PATHS"

if [ -n "$(sort "$PATHS" | uniq -d)" ]; then
  fail "duplicate public path(s): $(sort "$PATHS" | uniq -d | tr '\n' ' ')"
fi
if ! cmp -s "$PATHS" <(LC_ALL=C sort "$PATHS"); then
  fail "public manifest is not sorted: $MANIFEST"
fi

# routes.js is the source of truth for generated pages and runtime assets. A
# new route cannot silently 404 merely because its author forgot the manifest;
# nor can a removed route linger in dist. Machine surfaces are named here
# because they are intentionally public but are not browser routes.
node - <<'NODE' | LC_ALL=C sort > "$TMP/required-public"
const { ROUTES, UNLISTED, REQUIRED } = require('./build/routes.js');
const machine = ['_redirects', 'llms.txt', 'robots.txt', 'sitemap.xml'];
for (const path of [...ROUTES, ...UNLISTED].map(r => r.file).concat(REQUIRED, machine)) {
  console.log(path);
}
NODE
if ! cmp -s "$PATHS" "$TMP/required-public"; then
  echo "ASSEMBLE FAILED: public manifest differs from routes.js + machine surfaces:" >&2
  diff -u "$TMP/required-public" "$PATHS" >&2 || true
  exit 1
fi

while IFS= read -r path; do
  case "$path" in
    /*|*../*|../*|*/..|.|..|.*|*/.*|build/*|functions/*|design/*|test/*|node_modules/*|*.md)
      fail "public manifest refused internal path by name: $path" ;;
  esac
  [ -f "$path" ] || fail "allow-listed path does not exist: $path"
done < "$PATHS"

rm -rf "$DIST"
mkdir -p "$DIST"
while IFS= read -r path; do
  mkdir -p "$DIST/$(dirname "$path")"
  cp "$path" "$DIST/$path"
done < "$PATHS"

[ -s "$DIST/index.html" ] || fail "dist/index.html is missing or empty"
[ -s "$DIST/assets/site.css" ] || fail "dist/assets/site.css is missing or empty"
[ -s "$DIST/robots.txt" ] || fail "dist/robots.txt is missing or empty"

find "$DIST" -type f | sed "s#^$DIST/##" | LC_ALL=C sort > "$TMP/dist-paths"
if ! cmp -s "$PATHS" "$TMP/dist-paths"; then
  echo "ASSEMBLE FAILED: dist does not exactly match the public manifest:" >&2
  diff -u "$PATHS" "$TMP/dist-paths" >&2 || true
  exit 1
fi

COUNT="$(wc -l < "$PATHS" | tr -d ' ')"
echo "assemble OK: $COUNT allow-listed files copied to dist/; every other repo path is unpublished"
