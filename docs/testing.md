# How twip is tested

Five layers, each catching something the one before it cannot. The workflows and the test
files carry the operational detail in comments next to the code that needs it; this is the
shape and the reasoning.

## The layers

**Structural oracle** (`src/lib.rs` tests, `cargo test`) — parse the emitted SWF back with the
same `swf` crate that wrote it and assert the tags, the depths and the per-frame matrices.
This is the workhorse: it is fast, it runs on every commit through the pre-commit hook, and it
is the only layer precise enough to catch an easing curve that is subtly wrong. Expected tween
matrices come from running the Wick engine's own JavaScript (`node scripts/oracle-tween.js`)
and pasting the numbers in, not from re-deriving them in Rust.

**Round-trip oracle** (`tests/`) — replay the emitted display list over every fixture in both
compile modes and check it against the document's own frame numbers.

**Golden PNGs** (`tests/golden.rs`, `--features golden`) — render each fixture's compiled SWF
through ruffle's own `exporter` and compare against a committed PNG. This is the only layer
that sees *rendering*: geometry that parses correctly but rasterizes wrong. Planarized brush
fills, winding, layer order.

**Browser checks** (`editor/dev/`, `pnpm smoke --sweep`, `pnpm interact`) — the editor loads at
six widths with no console errors and twelve interactions do what they say.

**Byte agreement** (`pnpm wasm-check`) — compile a fixture in a real browser tab and require
the bytes to match the CLI's exactly. Two backends built from one source drift apart when that
source changes, which is why the editor workflow's path filter includes `src/`.

## Why there is no editor-versus-player pixel diff

The obvious test — render a document on the Wick canvas, render the compiled SWF in Ruffle,
diff the two — was tried on paper and rejected. Two renderers disagree constantly about
antialiasing, and a tolerance loose enough to absorb that disagreement is also loose enough to
miss an easing error, a one-frame timing slip, or a slightly wrong matrix. It would pass while
being blind to every bug worth catching.

The split above replaces it: matrices are checked as *numbers* where they are exact, and pixels
are checked only against Ruffle's own previous output, where the comparison is
renderer-against-itself and the tolerance can stay at zero. A side-by-side of the canvas and
the player is a useful thing to look at by hand. It is not a test.

## The golden oracle's one hard rule

Whatever blesses a golden must be what checks it. The renderer is lavapipe — deterministic
software Vulkan, never a real GPU — and antialiasing fringes move between mesa releases, so
the CI job runs in a `ubuntu:26.04` container rather than on `ubuntu-latest` to hold the mesa
version steady against the box the goldens were blessed on.

It is `workflow_dispatch` only. Building ruffle's exporter takes twenty to forty minutes cold,
which is not a per-push cost worth paying for a layer that catches rendering regressions
specifically.

Re-blessing, when a mesa update legitimately moves pixels: dispatch `golden.yml` with
`bless=true`, download the artifact, commit it to `tests/goldens/`. The installed mesa version
is printed in the log directly above the comparison, so a failure tells you which of the two it
was.

Opacity fixtures are excluded from strict pixel comparison. paper.js composites a group's
opacity offscreen and blends; SWF's colour transform multiplies each shape independently, so
overlapping children inside a translucent clip legitimately differ. See
[`wick-format.md`](wick-format.md).

## Running them

`scripts/check.sh` is the whole Rust suite, and both the pre-commit hook and CI call it, so
local and CI strictness cannot drift apart. Build and test always gate. clippy gates on CI and
is skipped locally, because a full clippy pass roughly doubles the commit loop —
`RUN_CLIPPY=1` forces it before a push. Formatting is advisory in both.

Enable the hook once: `git config core.hooksPath .githooks`.

The editor's checks are `pnpm` scripts in `editor/`; `.github/workflows/editor.yml` runs all of
them and its comments explain the ordering, which is load-bearing in two places.
