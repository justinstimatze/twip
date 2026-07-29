#!/usr/bin/env bash
# Build the twip compiler to wasm and generate the JS bindings the editor imports.
#
# Output lands in editor/src/wasm-pkg/ (gitignored, generated). vite.config.mjs resolves
# `virtual:twip-wasm` to it when present and to a stub that names this script when absent,
# so a checkout without the Rust toolchain still builds the UI — it just falls back to the
# dev bridge for the SWF button.
#
# Run from anywhere; `pnpm wasm` from editor/ is the usual way.
#
#   dev/build-wasm.sh                        build it
#   dev/build-wasm.sh --print-bindgen-version   the version the CLI must be, from the lockfile
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EDITOR="$(dirname "$HERE")"
ROOT="$(dirname "$EDITOR")"
OUT="$EDITOR/src/wasm-pkg"

# The CLI and the crate must be the same version — wasm-bindgen refuses a mismatch outright,
# so `cargo install wasm-bindgen-cli` without a version is a time bomb that goes off the day
# 0.2.N+1 is published. wasm/Cargo.lock is the single source of truth; CI reads it from here
# rather than keeping its own copy of the number.
bindgen_version () {
  awk '/^name = "wasm-bindgen"$/ {f=1; next} f && /^version = / {gsub(/"/,"",$3); print $3; exit}' \
    "$ROOT/wasm/Cargo.lock"
}

if [ "${1:-}" = "--print-bindgen-version" ]; then bindgen_version; exit 0; fi

# rustup's cargo is not on PATH on every box that has it, and the system cargo can be an
# older source-tarball rustc that ignores rust-toolchain.toml. Prefer rustup's when present.
CARGO="${CARGO:-}"
if [ -z "$CARGO" ]; then
  if [ -x "$HOME/.cargo/bin/cargo" ]; then CARGO="$HOME/.cargo/bin/cargo"
  else CARGO="$(command -v cargo || true)"; fi
fi
if [ -z "$CARGO" ]; then
  echo "no cargo on PATH. Install Rust: https://rustup.rs" >&2
  exit 1
fi

# The wasm32 target is not installed by default. Refuse up front rather than let cargo
# discover it as a missing-core error partway into the build. rustup is the only thing that
# can answer this; a distro rustc without it gets no check and cargo's own error stands.
RUSTUP="$(command -v rustup || true)"
[ -z "$RUSTUP" ] && [ -x "$HOME/.cargo/bin/rustup" ] && RUSTUP="$HOME/.cargo/bin/rustup"
if [ -n "$RUSTUP" ] && ! "$RUSTUP" target list --installed 2>/dev/null | grep -qx wasm32-unknown-unknown; then
  echo "wasm32-unknown-unknown target not installed. Run:" >&2
  echo "    rustup target add wasm32-unknown-unknown" >&2
  exit 1
fi

BINDGEN="$(command -v wasm-bindgen || true)"
[ -z "$BINDGEN" ] && [ -x "$HOME/.cargo/bin/wasm-bindgen" ] && BINDGEN="$HOME/.cargo/bin/wasm-bindgen"
WANT="$(bindgen_version)"
if [ -z "$BINDGEN" ]; then
  echo "wasm-bindgen not found. Run:" >&2
  echo "    cargo install wasm-bindgen-cli --locked --version $WANT" >&2
  exit 1
fi
HAVE="$("$BINDGEN" --version | awk '{print $2}')"
if [ -n "$WANT" ] && [ "$HAVE" != "$WANT" ]; then
  echo "wasm-bindgen $HAVE, but wasm/Cargo.lock pins the crate at $WANT. Run:" >&2
  echo "    cargo install wasm-bindgen-cli --locked --version $WANT" >&2
  exit 1
fi

echo "building twip-wasm (release, wasm32-unknown-unknown)"
"$CARGO" build --release --target wasm32-unknown-unknown --manifest-path "$ROOT/wasm/Cargo.toml"

WASM="$ROOT/wasm/target/wasm32-unknown-unknown/release/twip_wasm.wasm"
[ -f "$WASM" ] || { echo "expected $WASM, not there" >&2; exit 1; }

# --target web: an ES module the bundler can see through, loading the .wasm from an
# import.meta.url-relative URL. vite emits that as a hashed asset with no extra config.
# --no-typescript: nothing here is TypeScript, and the .d.ts would be dead weight.
echo "generating bindings -> ${OUT#"$ROOT"/}"
rm -rf "$OUT"
"$BINDGEN" --target web --no-typescript --out-dir "$OUT" "$WASM"

echo "done: $(du -h "$OUT"/twip_wasm_bg.wasm | cut -f1) of wasm"
