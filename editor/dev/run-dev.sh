#!/bin/bash
# run-dev.sh — bring up everything the editor needs to export SWF in a browser:
# the twip compiler (release binary), the bridge that shells out to it, and Vite.
#
# The SWF paths need BOTH servers. The bridge is what makes them work outside the
# Tauri shell (in Tauri the compile is an in-process Rust call and no bridge exists),
# so forgetting it produces "could not reach the twip bridge on :8752" rather than
# anything that looks like an editor bug.
#
#   Usage:  bash editor/dev/run-dev.sh      (Ctrl-C stops both)
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

# The bridge runs whatever binary is on disk, so a stale one silently tests an old
# compiler — it was built before skew landed, for instance. Always refresh.
echo "== cargo build --release --bin twip =="
cargo build --release --bin twip || exit 1

# Free both ports if servers from an earlier session are still holding them. The two
# failure modes differ and the Vite one is nastier: the bridge would just die on bind,
# but Vite quietly slides to :3001 and prints it, so you end up with two servers and
# the URL you reflexively open is the stale one.
for spec in "8752 bridge" "3000 vite"; do
    set -- $spec
    if lsof -ti tcp:"$1" >/dev/null 2>&1; then
        echo "== stopping the $2 already on :$1 =="
        lsof -ti tcp:"$1" | xargs -r kill
        sleep 0.5
    fi
done

echo "== twip bridge -> http://127.0.0.1:8752 =="
python3 editor/dev/twip_bridge.py &
BRIDGE_PID=$!
trap 'echo; echo "== stopping bridge ($BRIDGE_PID) =="; kill $BRIDGE_PID 2>/dev/null' EXIT INT TERM

# Give it a moment to bind, then prove it is actually answering rather than assuming.
sleep 1
if ! curl -sf http://127.0.0.1:8752/health >/dev/null; then
    echo "✗ bridge is not answering on :8752 — see its output above" >&2
    exit 1
fi
echo "✓ bridge healthy"

echo "== vite -> http://localhost:3000  (Ctrl-C stops both) =="
cd editor && pnpm dev
