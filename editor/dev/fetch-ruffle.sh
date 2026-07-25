#!/usr/bin/env bash
#
# Stage the Ruffle selfhosted runtime into public/corelibs/ruffle.
#
# index.html loads /corelibs/ruffle/ruffle.js from a plain script tag and the directory is
# gitignored (28MB of wasm does not belong in history), so a fresh clone 404s on it: the SWF
# preview modal has no player, and every console check has a resource error in it.
#
# BUILD.md used to say "download a nightly". That is neither reproducible nor durable —
# Ruffle prunes old nightly assets, so a nightly URL that works today 404s in a few months.
# This pins a tagged release instead, and CI runs the same script.
#
# Usage: dev/fetch-ruffle.sh [--force]
set -euo pipefail

VERSION="0.4.1"
URL="https://github.com/ruffle-rs/ruffle/releases/download/v${VERSION}/ruffle-${VERSION}-web-selfhosted.zip"

cd "$(dirname "$0")/.."
DEST="public/corelibs/ruffle"

# The runtime ships its own package.json; its version is how we know what is on disk.
if [[ "${1:-}" != "--force" && -f "$DEST/package.json" ]]; then
  have=$(node -p "require('./$DEST/package.json').version" 2>/dev/null || echo unknown)
  if [[ "$have" == "$VERSION" ]]; then
    echo "ruffle $VERSION already staged in $DEST"
    exit 0
  fi
  echo "replacing ruffle $have with $VERSION"
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "fetching $URL"
curl -fsSL "$URL" -o "$tmp/ruffle.zip"
unzip -q "$tmp/ruffle.zip" -d "$tmp/out"

rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
mv "$tmp/out" "$DEST"

test -f "$DEST/ruffle.js" || { echo "no ruffle.js in the archive — did the asset layout change?" >&2; exit 1; }
echo "staged ruffle $VERSION in $DEST"
