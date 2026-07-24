#!/bin/bash
# oracle-setup.sh — build ruffle's `exporter` binary from the SAME rev twip pins
# its `swf` dep to (Cargo.toml). The golden-PNG oracle (tests/golden.rs) shells out
# to this binary to rasterize twip-compiled SWFs under lavapipe.
#
# Cold build is ~20-40 min (whole ruffle_core + wgpu). Idempotent: skips the clone
# if oracle/ruffle already exists, and cargo skips the build if nothing changed.
# The oracle/ tree is gitignored.
#
#   Usage:  bash scripts/oracle-setup.sh
#   Result: oracle/ruffle/target/release/exporter
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

REV=645449a5c602044471f045546a0a31af0df9cd69
DIR=oracle/ruffle

if [[ ! -d "$DIR/.git" ]]; then
    echo "== cloning ruffle (full; need to reach rev $REV) =="
    mkdir -p oracle
    git clone https://github.com/ruffle-rs/ruffle "$DIR" || exit 1
fi

echo "== checkout $REV =="
git -C "$DIR" checkout --quiet "$REV" || exit 1

echo "== cargo build --release -p exporter (this is the slow part) =="
# ruffle @ this rev uses features (if-let guards, cfg_select) that need a recent
# stable rustc — newer than some distro/source-tarball toolchains. Override the
# compiler with CARGO=/path/to/cargo (e.g. a rustup stable) if the default is too
# old. Build inside the ruffle workspace so it uses ruffle's own lockfile, not
# twip's; its target/ lands under oracle/ (gitignored).
"${CARGO:-cargo}" build --release --manifest-path "$DIR/Cargo.toml" -p exporter || exit 1

BIN="$DIR/target/release/exporter"
if [[ -x "$BIN" ]]; then
    echo "✓ exporter built: $BIN"
    "$BIN" --version 2>/dev/null || true
else
    echo "✗ expected binary not found at $BIN — check the build output above" >&2
    exit 1
fi
