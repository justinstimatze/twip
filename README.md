# twip

> A modern Flash. Draw vector shapes on a timeline, tween them, press export, and get an honest-to-god `.swf` that [Ruffle](https://ruffle.rs) plays.

A personal nostalgia project — not a product. Flash is gone, its editor is abandonware, and the thing it did well — drawing and animating vectors and shipping them as a small file that just plays — has no clean modern replacement. twip is an attempt to get that feeling back without pretending Flash never had problems.

## How it works

- **One file format, and it's SWF.** Saving is compiling. The editor produces `.wick` documents (a zip of paper.js paths + a timeline); twip compiles those to real SWF that Ruffle renders.
- **One truth renderer, and it's Ruffle.** Anything that plays — preview, test, export — is Ruffle rendering compiled SWF. No second renderer to disagree with the first.
- **The editor is a fork of the [Wick Editor](https://github.com/Wicklets/wick-editor)**, vendored at [`editor/`](editor/). Reusing a battle-tested drawing and timeline UI, with a real SWF export and a Ruffle preview added. The one thing no Wick fork has is playable SWF out.

## Layout

| | |
|---|---|
| `src/`, `tests/`, `fixtures/` | the compiler — a Rust crate and CLI that turn `.wick` into `.swf` |
| `editor/` | the editor fork (its own README and BUILD.md) |
| `scripts/`, `oracle/` | the Ruffle golden-PNG oracle, off by default behind a cargo feature |

```
cargo run --bin twip -- fixtures/test1.wick out.swf
```

## Status

The compiler handles what the fixtures exercise: filled and stroked paths, layer ordering, frame-by-frame timelines, nested clips as sprites, motion tweens with every easing curve the Wick engine ships, skew, brush shapes planarized so their holes survive, and `stop`/`play`/`gotoAndPlay`/`gotoAndStop` compiled to AVM1 — as frame actions and as click handlers. Gradients, text, audio, filters and images are out of scope for now.

Three test layers back it: a structural oracle that parses the emitted SWF and asserts tags, depths and per-frame matrices; golden PNGs rendered through Ruffle's own exporter on lavapipe; and the editor's own browser checks. All of them run in CI.

What is not yet true: exporting a `.swf` from the editor works on a desktop build or against a local dev bridge, not from a plain browser tab. See [`HANDOFF.md`](HANDOFF.md) for the design, the verified `.wick` format notes, and the open work.

## Credit

twip's editor is **built on the [Wick Editor](https://github.com/Wicklets/wick-editor) by Wicklets LLC**, via [StickmanRed's fork](https://github.com/StickmanRed/wick-editor). The drawing engine, the document model, the tween engine and the timeline are theirs; see [`editor/CREDITS.md`](editor/CREDITS.md) for the people who wrote them. twip is not affiliated with or endorsed by either project.

## License

Two licenses, because the tree holds two things.

- The compiler — everything outside `editor/` — is **MIT**, and ships no Wick code. See [`LICENSE`](LICENSE).
- The editor fork at `editor/` is **GPLv3**, because it contains Wick's code. See [`editor/LICENSE.md`](editor/LICENSE.md).

MIT is GPL-compatible, so there is no conflict in having both here. A desktop build links the compiler into the same binary as the editor and is conveyed under GPLv3; the compiler crate on its own stays MIT and can be taken and used as such.

[`LICENSING.md`](LICENSING.md) says which is which in detail, including what GPLv3 §6 requires before a packaged build can be handed to anyone. I am not a lawyer; read the licenses rather than my summary of them.
