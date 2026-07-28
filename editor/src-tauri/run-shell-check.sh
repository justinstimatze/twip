#!/usr/bin/env bash
# Launch the twip desktop shell, screenshot its window, and close it.
#
# Forces the X11 GDK backend: this box runs Wayland, where the compositor owns window
# geometry and ImageMagick's `import` cannot address another client's surface. Under X11
# the window is grabbable by name, so the check can prove the frontend actually painted
# rather than only that the process stayed alive.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$HERE/target/shell-check.png}"
# Release by default. mainBinaryName renames it to twip, so the debug build (still
# target/debug/twip-editor, the cargo package name) needs TWIP_BIN to reach it.
BIN="${TWIP_BIN:-$HERE/target/release/twip}"

[ -x "$BIN" ] || { echo "no binary at $BIN — run cargo build --release first" >&2; exit 2; }

GDK_BACKEND=x11 "$BIN" > "$HERE/target/shell-check.log" 2>&1 &
APP=$!
trap 'kill "$APP" 2>/dev/null' EXIT

# The React app mounts, then the engine mounts imperatively from componentDidMount.
# smoke.mjs waits 2.5s for that; give the cold webview a longer budget.
for _ in $(seq 1 40); do
    sleep 1
    kill -0 "$APP" 2>/dev/null || { echo "process exited early:"; cat "$HERE/target/shell-check.log"; exit 1; }
    if xwininfo -root -tree 2>/dev/null | rg -q '"twip"'; then break; fi
done

LINE=$(xwininfo -root -tree 2>/dev/null | rg '"twip"' | head -n 1)
if [ -z "$LINE" ]; then
    echo "no window titled twip after 40s. Window list:"
    xwininfo -root -tree 2>/dev/null | rg -i 'wick|twip|editor' | head
    echo "--- app log ---"; cat "$HERE/target/shell-check.log"
    exit 1
fi

echo "window: $LINE"
ID=$(echo "$LINE" | rg -o '0x[0-9a-f]+' | head -n 1)

sleep 6   # let the engine finish mounting and the preloader clear
import -window "$ID" "$OUT" 2>/dev/null || { echo "screenshot failed for $ID" >&2; exit 1; }
echo "shot: $OUT"
echo "--- app log ---"
cat "$HERE/target/shell-check.log"
