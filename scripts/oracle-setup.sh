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
MIN_RUSTC_MINOR=94   # ruffle @ this rev needs `if let` guards + cfg_select (rustc 1.94+).
                     # Read off cargo's version, which tracks rustc's release-for-release.

# Preflight the toolchain BEFORE building. Failing here costs a second; failing at
# ruffle_core costs ~20 min AND deletes the previously-working exporter binary, because
# cargo drops the old artifact once it starts a rebuild it cannot finish. On a box whose
# default rustc is too old (a distro/source-tarball 1.93 with no rustup, say), pass a
# newer one explicitly: CARGO=~/.cargo/bin/cargo bash scripts/oracle-setup.sh
CARGO_BIN="${CARGO:-cargo}"
MINOR=$("$CARGO_BIN" --version 2>/dev/null | sed -n 's/^cargo 1\.\([0-9]\+\).*/\1/p')
if [[ -z "$MINOR" ]]; then
    echo "✗ could not read a version from '$CARGO_BIN --version' — is it a cargo?" >&2
    exit 1
fi
if (( MINOR < MIN_RUSTC_MINOR )); then
    echo "✗ $CARGO_BIN is 1.$MINOR; ruffle @ $REV needs 1.$MIN_RUSTC_MINOR+ (E0658 on \`if let\` guards)." >&2
    echo "  Point CARGO at a newer toolchain, e.g.:" >&2
    echo "    CARGO=\$HOME/.cargo/bin/cargo bash scripts/oracle-setup.sh" >&2
    exit 1
fi

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
#
# RUSTFLAGS= (empty, not unset) is load-bearing: cargo discovers config by walking UP
# from the cwd, so oracle/ruffle inherits twip's own .cargo/config.toml — including
# `-C link-arg=-fuse-ld=mold` and `-D warnings`, neither of which has any business
# applying to a vendored third-party build. An env RUSTFLAGS overrides BOTH the
# [build] and [target.*] blocks wholesale, so empty means "compiler defaults".
# Without it this fails on any box without mold (golden.yml run 30118810306:
# `collect2: fatal error: cannot find 'ld'` while compiling proc-macro2's build
# script), and a ruffle rev bump that warns would fail the build outright.
RUSTFLAGS= "$CARGO_BIN" build --release --manifest-path "$DIR/Cargo.toml" -p exporter || exit 1

BIN="$DIR/target/release/exporter"
if [[ -x "$BIN" ]]; then
    echo "✓ exporter built: $BIN"
    "$BIN" --version 2>/dev/null || true
else
    echo "✗ expected binary not found at $BIN — check the build output above" >&2
    exit 1
fi
