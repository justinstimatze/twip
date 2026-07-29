# twip

> A modern Flash. Draw vector shapes on a timeline, tween them, press export, and get an honest-to-god `.swf` that [Ruffle](https://ruffle.rs) plays.

A personal nostalgia project — not a product. Flash is gone, its editor is abandonware, and the thing it did well — drawing and animating vectors and shipping them as a small file that just plays — has no clean modern replacement. twip is an attempt to get that feeling back without pretending Flash never had problems.

## How it works

- **One file format, and it's SWF.** Saving is compiling. The editor produces `.wick` documents (a zip of paper.js paths + a timeline); twip compiles those to real SWF that Ruffle renders.
- **One truth renderer, and it's Ruffle.** Anything that plays — preview, test, export — is Ruffle rendering compiled SWF. No second renderer to disagree with the first.
- **The editor is a fork of the [Wick Editor](https://github.com/Wicklets/wick-editor)**, vendored at [`editor/`](editor/). Reusing a battle-tested drawing and timeline UI, with a real SWF export and a Ruffle preview added. The one thing no Wick fork has is playable SWF out.
- **Draw at 12fps, play back at 60.** New projects start at Flash's own 12, because a fifth as many drawings is the reason to hand-draw at all. The compiler resamples on export: each document frame becomes as many movie frames as fit in 60, and a tween is re-evaluated at each one rather than held. A cel still holds for its five frames — the flipbook look survives — while anything moving continuously gets every refresh the display has. `--no-upsample` turns it off.

## Layout

| | |
|---|---|
| `src/`, `tests/`, `fixtures/` | the compiler — a Rust crate and CLI that turn `.wick` into `.swf` |
| `editor/` | the editor fork (its own README and BUILD.md) |
| `scripts/`, `oracle/` | the Ruffle golden-PNG oracle, off by default behind a cargo feature |

```
cargo run --bin twip -- fixtures/test1.wick out.swf      # from a clone
cargo run --bin twip -- --no-upsample in.wick out.swf    # one movie frame per document frame
cargo install --git https://github.com/justinstimatze/twip
```

There is no crates.io release. The compiler depends on ruffle's `swf` crate pinned to one
revision, crates.io rejects git dependencies, and the published `swf` 0.2.2 is an
18-month-stale package wearing the same version number as the one this needs. `--git` is the
route.

## Status

The compiler handles what the fixtures exercise: filled and stroked paths, layer ordering, frame-by-frame timelines, nested clips as sprites, motion tweens with every easing curve the Wick engine ships, skew, brush shapes planarized so their holes survive, and `stop`/`play`/`gotoAndPlay`/`gotoAndStop` compiled to AVM1 — as frame actions and as click handlers. Gradients, text, audio, filters and images are out of scope for now.

Five test layers back it: a structural oracle that parses the emitted SWF and asserts tags, depths and per-frame matrices; a round-trip oracle that replays the emitted display list over every fixture in both compile modes and checks it against the document's own frame numbers; golden PNGs rendered through Ruffle's own exporter on lavapipe; the editor's own browser checks; and a check that compiles a fixture in a real browser tab and requires the bytes to match the CLI's exactly. All of them run in CI.

Export works three ways, and the editor picks whichever exists: an in-process Rust call under the desktop build, the same compiler as wasm in a plain browser tab, or a local dev bridge. See [`editor/BUILD.md`](editor/BUILD.md) for setup and [`HANDOFF.md`](HANDOFF.md) for the design, the verified `.wick` format notes, and the open work.

## Credit

twip's editor is **built on the [Wick Editor](https://github.com/Wicklets/wick-editor) by Wicklets LLC**, via [StickmanRed's fork](https://github.com/StickmanRed/wick-editor). The drawing engine, the document model, the tween engine and the timeline are theirs; see [`editor/CREDITS.md`](editor/CREDITS.md) for the people who wrote them. twip is not affiliated with or endorsed by either project.

## License

Two licenses, because the tree holds two things.

- The compiler — everything outside `editor/` — is **MIT**, and ships no Wick code. See [`LICENSE`](LICENSE).
- The editor fork at `editor/` is **GPLv3**, because it contains Wick's code. See [`editor/LICENSE.md`](editor/LICENSE.md).

MIT is GPL-compatible, so there is no conflict in having both here. A desktop build links the compiler into the same binary as the editor and is conveyed under GPLv3; the compiler crate on its own stays MIT and can be taken and used as such.

[`LICENSING.md`](LICENSING.md) says which is which in detail, including what GPLv3 §6 requires before a packaged build can be handed to anyone. I am not a lawyer; read the licenses rather than my summary of them.
