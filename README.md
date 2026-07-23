# twip

> A modern Flash. Draw vector shapes on a timeline, tween them, press export, and get an honest-to-god `.swf` that [Ruffle](https://ruffle.rs) plays.

A personal nostalgia project — not a product. Flash is gone, its editor is abandonware, and the thing it did well — drawing and animating vectors and shipping them as a small file that just plays — has no clean modern replacement. twip is an attempt to get that feeling back without pretending Flash never had problems.

## How it works

- **One file format, and it's SWF.** Saving is compiling. The editor produces `.wick` documents (a zip of paper.js paths + a timeline); twip compiles those to real SWF that Ruffle renders.
- **One truth renderer, and it's Ruffle.** Anything that plays — preview, test, export — is Ruffle rendering compiled SWF. No second renderer to disagree with the first.
- **The editor is a polished fork of the [Wick editor](https://github.com/StickmanRed/wick-editor).** Reusing a battle-tested drawing/timeline UI, with a real SWF Export button and a Ruffle preview tab bolted on. The one thing no Wick fork has: playable SWF out.

This repo is the **compiler** — the Rust crate and CLI that turn `.wick` into `.swf`. The editor fork lives separately.

## Status

Design is converged and pressure-tested; the real `.wick` structure is verified against a live save (`fixtures/test1.wick`). No compilation is implemented yet — Phase 0 (a hardcoded red-square SWF that plays in Ruffle) is the first executable step. See [`HANDOFF.md`](HANDOFF.md) for the full design, the verified format notes, and the phased plan.

## License

MIT (see [`LICENSE`](LICENSE)). The editor fork is GPLv3, because it contains Wick's code; this compiler ships none of it.
