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

## The shape tier one took

**A Go binary, `twipdoc`, and an MCP server in the same binary.** It is built:
[`tools/twipdoc`](../tools/twipdoc). Go because it is the house default, and not Rust even
though the compiler is Rust — the document tier does not compile anything, it reads and writes
a zip of JSON, and putting it in the compiler crate would mean linking an MCP server into
`twip`.

The plan here said to lift [gemot](https://github.com/justinstimatze/gemot)'s skeleton whole:
HTTP transport, an agent card at `/.well-known/agent-card.json`, anonymous rate-limited access.
That was matching gemot's shape onto a job with a different one. gemot is a hosted service that
strangers reach over a network, so it has to answer *who is asking*. twipdoc edits files on the
caller's own disk, where the only question worth asking is *which directory* — and the answer
is a `--root` flag, not an auth scheme. It speaks MCP over stdio and runs beside its client, the
way a language server does. What survived from gemot is the grouping: tools named for what they
touch, each taking an `action`, rather than one tool per verb.

The verbs, in the order they earned their place:

| | |
|---|---|
| `read` | the document as a summary: stage, framerate, layers, frames and their spans, clips, tween keys, scripts, assets |
| `frames` | one layer's keyframes, with what is on each |
| `script get` / `script set` | a frame's or clip's script, by event name |
| `tween` | read and retime a tween's keys, including its easing and any `bezier` |
| `layer add` / `layer reorder` | the structural edits with no geometry in them |
| `compile` | shell out to `twip`, returning the report from `wick::Skipped` alongside the bytes |

Three constraints the format imposes, none obvious from the outside:

- `project.json` is a **flat UUID map**, not a tree. Parents name children by UUID and a
  `Selection` object is editor state. Anything that walks it must go root-down through the
  project's root Clip to its Timeline, or it will read the same objects twice.
- A path's `json` is `[class, props]` **or** `[["dictionary", {…}], [class, props]]` when it
  carries a gradient, because paper.js stores shared objects in a table. A reader that assumes
  the first shape does not degrade — it fails outright. See `split_dictionary` in
  `src/wick.rs`.
- **A typed model of this format is a lossy one.** twipdoc keeps every object as a generic map
  and mutates in place, because the engine writes dozens of fields it does not know and will
  write dozens more. Anything else round-trips a document through the subset it understands, and
  the loss is silent: the file still opens and still looks almost right. The check that this
  holds is not Go asserting it about its own output — it is compiling the original and the
  round-tripped copy and requiring byte-identical SWFs, since the Rust parser is an independent
  reader of the same bytes.

The canvas tier stays what it is for now: `window.editor`, driven the way `editor/dev/*.mjs`
already drive it. Naming that surface deliberately is worth doing, but it is worth doing after
the document tier, because most of what an agent wants does not need it.

## What exists today

`window.editor` is the whole `EditorCore` surface, and the ten scripts in `editor/dev/` drive
it: they import assets, select tools, draw with real pointer events, set tool settings, select
objects, read the timeline model, and compile to SWF. That is a working prototype of the canvas
tier, shaped by whatever `EditorCore` happens to expose rather than by anything anyone designed.

The document tier is [`tools/twipdoc`](../tools/twipdoc): the seven verbs above, as a CLI and as
five MCP tools over stdio. `twip` the CLI still only compiles and imports.
