#!/bin/bash
# check.sh — the single check suite, run by BOTH the local pre-commit hook
# (.githooks/pre-commit) and CI (.github/workflows/ci.yml), so local and CI
# strictness can't drift. Builds and tests ALWAYS gate. clippy gates when clippy
# is installed (as on CI) and skips with a note otherwise; formatting is advisory
# (report-only) either way.
#
# This dev box runs a source-tarball rustc with no rustfmt/clippy, so locally only
# build + test gate here; CI (dtolnay stable, which honours rust-toolchain.toml)
# adds the clippy gate. Flip fmt to a hard gate (add `|| fail=1`) once it's verified
# clean everywhere and rustfmt is reliably available. Pattern lifted from rtux.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

fail=0
step() { echo; echo "== $* =="; }

step "fmt (advisory)"
if cargo fmt --version >/dev/null 2>&1; then
    cargo fmt --all --check \
        || echo "  formatting differs — run: cargo fmt --all  (advisory, not gating)"
else
    echo "  rustfmt not installed — skipping (rustup component add rustfmt)"
fi

step "clippy"
if cargo clippy --version >/dev/null 2>&1; then
    cargo clippy --all-targets -- -D warnings || fail=1
else
    echo "  clippy not installed — skipping (rustup component add clippy)"
fi

step "build"
cargo build --all-targets || fail=1

step "test"
cargo test || fail=1

echo
if [[ $fail -ne 0 ]]; then
    echo "✗ checks FAILED"
    exit 1
fi
echo "✓ checks passed"
