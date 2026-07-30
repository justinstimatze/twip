#!/bin/bash
# check.sh — the single check suite, run by BOTH the local pre-commit hook
# (.githooks/pre-commit) and CI (.github/workflows/ci.yml), so local and CI
# strictness can't drift. Builds and tests ALWAYS gate. formatting is advisory
# (report-only) either way.
#
# clippy is the gate ON CI ONLY (a full clippy pass roughly doubles the local
# commit loop, and this box now has clippy via a user-space rustup). It runs when
# $CI is set (GitHub Actions sets CI=true) — so every push is still gated — and is
# skipped on local commits. Set RUN_CLIPPY=1 to force it locally before a push.
# Flip fmt to a hard gate (add `|| fail=1`) once it's verified clean everywhere and
# rustfmt is reliably available. Pattern lifted from rtux.
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
if [[ -n "${CI:-}" || -n "${RUN_CLIPPY:-}" ]]; then
    if cargo clippy --version >/dev/null 2>&1; then
        cargo clippy --all-targets -- -D warnings || fail=1
    else
        echo "  clippy not installed — skipping (rustup component add clippy)"
    fi
else
    echo "  clippy skipped locally (gated in CI; set RUN_CLIPPY=1 to run here)"
fi

step "build"
cargo build --all-targets || fail=1

step "test"
cargo test || fail=1

# tools/twipdoc is a separate Go module (the document tier — see docs/agent-interface.md).
# Gated here rather than in its own workflow because its strongest test compiles fixtures with
# the twip binary this same suite just built: a Go change that corrupts a document shows up as
# a movie that differs, and that check only exists where both languages are present.
step "twipdoc (go)"
if command -v go >/dev/null 2>&1; then
    (cd tools/twipdoc && go vet ./... && go test ./...) || fail=1
elif [[ -n "${CI:-}" ]]; then
    # Loud on CI. A silent skip there means the Go tests quietly stop running and the suite
    # still reports green — the failure nobody finds, because nothing is red.
    echo "  go missing on CI — the twipdoc tests did not run"
    fail=1
else
    echo "  go not installed — skipping (install Go to run the twipdoc tests)"
fi

echo
if [[ $fail -ne 0 ]]; then
    echo "✗ checks FAILED"
    exit 1
fi
echo "✓ checks passed"
