# Driving twip from a program

Notes on how an agent — or a script, or a test — should reach into twip, and why the seams
fall where they do. This is design rationale rather than an API reference; nothing here is a
committed interface yet, and the parts that exist are listed at the bottom.

## Two tiers, because they fail differently

**The document tier needs no browser.** A `.wick` is a zip around a `project.json`, and that
JSON holds nearly everything: layers, frames and their spans, clips and their nesting, tween
keyframes with easing curves, scripts, asset references, stage size, framerate, background.
Adding a layer, retiming a tween, writing a frame script, reading what is on frame 12 —
none of it needs a rendering engine. It is data manipulation followed by
`twip in.wick out.swf`.

**The canvas tier needs the page.** Anything that requires paper.js: boolean operations,
brush stroke planarisation, hit-testing, text measurement, and drawing itself. These are not
document edits, they are computations the drawing engine performs and then records.

The split matters because the tiers have different reliability. The document tier is
deterministic and cannot break from an interface change. The canvas tier drives a live
application, and every dev check in `editor/dev/` that does so has had to learn where the
engine is asynchronous. Anything that *can* be done at the document tier should be.

There is a subtler reason to prefer it. `window.editor` exposes a live object graph mid-render;
the `.wick` is a value. Asked twice, the document tier gives the same answer, and an agent that
cannot rely on that spends its budget re-establishing what it already knew.

## Seeing

Structure is not appearance. The document says a path has 47 segments and a fill of `#ef4a2f`.
It does not say the shape reads as a lopsided blob, that two clips overlap, or that the text
runs off the stage. That needs a render, and there are two worth having:

- **The editor's canvas**, as the author sees it — the stage with selection handles, onion
  skins, guides. This is what to look at when the question is about the interface or about
  what a person would see while working.
- **The compiled movie, through Ruffle** — what a player actually shows. This is the truth,
  since Ruffle is the only renderer twip targets and the compiler is what decides what reaches
  it.

Both already exist as machinery. `editor/dev/visual.mjs` screenshots editor scenes;
`tests/golden.rs` renders a compiled SWF through ruffle's own exporter on lavapipe. The gap
between the two channels is where compiler bugs live — a shape that looks right on the canvas
and wrong in the movie is precisely the class of bug the golden oracle exists for — so an agent
wants both rather than either.

## Hearing

Sound is the awkward one, and it belongs to the document tier rather than the canvas tier: an
agent cannot listen. What it can use is structure — which asset sits on which frame, its
duration, its envelope — plus, if perceptual access is genuinely wanted, a rendered waveform
or spectrogram, which is an image and therefore the same channel as seeing.

This is moot until the compiler emits sound at all. See
[`docs/flash8-parity.md`](flash8-parity.md).

## The checks are an oracle, and that is the cheapest channel of all

An agent that can only look at pixels has to guess whether what it sees is correct. An agent
that can run `pnpm toolbar-check` or `cargo test --features golden` and read structured
pass/fail has the answer. Every check in this repo prints one line per case with a name and a
detail string, and exits non-zero on failure, which is a machine-readable result that happens
also to be readable by a person.

This is the highest-leverage thing to expose, and it is already built — it needs naming, not
writing.

## What exists today

`window.editor` is the whole `EditorCore` surface, and the ten scripts in `editor/dev/` drive
it: they import assets, select tools, draw with real pointer events, set tool settings, select
objects, read the timeline model, and compile to SWF. That is a working prototype of the canvas
tier, shaped by whatever `EditorCore` happens to expose rather than by anything anyone designed.

The document tier has no interface at all. `twip` the CLI compiles and imports; it does not
read or edit documents.
