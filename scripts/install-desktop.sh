#!/bin/bash
# install-desktop.sh — put the current desktop app on this machine.
#
# desktop.yml builds a .deb on pushes to main that could change the app; this fetches the newest
# one and installs it.
#
#   scripts/install-desktop.sh            # fetch the newest build from CI
#   scripts/install-desktop.sh --local    # build from the working tree instead
#   scripts/install-desktop.sh --dry-run  # say what would happen, install nothing
#
# dpkg needs root, so this asks for sudo at the end and nowhere else.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

LOCAL=0
DRY=0
for arg in "$@"; do
    case "$arg" in
        --local)   LOCAL=1 ;;
        --dry-run) DRY=1 ;;
        # The header comment is the help text. Read to the end of the block rather than to a
        # line number, so editing the header cannot start spilling code into --help.
        -h|--help) awk 'NR==1{next} /^#/{sub(/^# ?/,""); print; next} {exit}' "$0"; exit 0 ;;
        *) echo "unknown argument: $arg" >&2; exit 2 ;;
    esac
done

installed_version() {
    # The installed binary carries no version string worth reading, so its mtime is the
    # honest answer about how old it is.
    [[ -e /usr/bin/twip ]] && date -r /usr/bin/twip '+%Y-%m-%d %H:%M' || echo "not installed"
}

echo "installed: $(installed_version)"

if [[ $LOCAL -eq 1 ]]; then
    echo "building from the working tree ($(git rev-parse --short HEAD)$(git diff --quiet || echo '+dirty'))"
    [[ $DRY -eq 1 ]] && { echo "would build, then install"; exit 0; }
    (cd editor && pnpm build)
    (cd editor/src-tauri && CARGO_BUILD_JOBS=2 ~/.cargo/bin/cargo-tauri build --bundles deb)
    DEB=$(ls -t editor/src-tauri/target/release/bundle/deb/*.deb | head -1)
else
    command -v gh >/dev/null || { echo "gh is not installed; use --local" >&2; exit 1; }

    # Failure here is the same situation as an empty result — the workflow has not landed on
    # the default branch yet, and gh reports that as a 404 rather than as no runs. Both want
    # the same sentence, so neither is allowed to abort with a raw API error.
    FOUND=$(gh run list --workflow=desktop.yml --branch main --status success \
        --limit 1 --json databaseId,headSha --jq '.[0] | "\(.databaseId) \(.headSha)"' 2>/dev/null || true)
    read -r RUN_ID SHA <<<"$FOUND"
    if [[ -z "${RUN_ID:-}" || "$RUN_ID" == "null" ]]; then
        echo "no successful desktop build on main yet — push a change under editor/ or src/," >&2
        echo "dispatch the desktop workflow, or use --local." >&2
        exit 1
    fi

    echo "newest CI build: ${SHA:0:7} (run $RUN_ID)"
    # How far the local checkout is from what is being installed, which is the number worth
    # seeing before overwriting the app you are about to open.
    if git cat-file -e "$SHA^{commit}" 2>/dev/null; then
        BEHIND=$(git rev-list --count "$SHA..HEAD" 2>/dev/null || echo '?')
        [[ "$BEHIND" != "0" ]] && echo "note: your HEAD is $BEHIND commit(s) past that build"
    fi

    [[ $DRY -eq 1 ]] && { echo "would download run $RUN_ID and install it"; exit 0; }

    TMP=$(mktemp -d)
    trap 'rm -rf "$TMP"' EXIT
    gh run download "$RUN_ID" --name twip-deb --dir "$TMP"
    DEB=$(ls "$TMP"/*.deb | head -1)
fi

echo "installing $(basename "$DEB") ($(du -h "$DEB" | cut -f1))"
sudo dpkg -i "$DEB"
echo "installed: $(installed_version)"
