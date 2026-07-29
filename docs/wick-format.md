# The `.wick` document, and what it takes to compile one

There is no specification for `.wick`. This is what twip's compiler learned by reading real
saves and the Wick engine's own source, written down so the next person does not have to
learn it the same way. Everything here is either checked against a file the editor actually
wrote or cited to the engine source it came from.

## The container

A `.wick` file is a zip holding `assets/` and `project.json`. Nothing else is required.

`project.json` is `{ project, objects }`, and the surprising half is `objects`: it is a **flat
map keyed by UUID**, not a tree. Every object carries a `classname` — one of `Project`,
`Clip`, `Timeline`, `Layer`, `Frame`, `Path`, `Selection` — and every parent names its
children as an array of UUID strings. Reading a document means building the map first and then
walking it from `project.children` down:

```
Project → [Selection, root Clip] → Timeline → Layer → Frame → [Path …]
```

`Selection` is editor UI state — a pivot point and a rotation widget. It appears as a child of
`Project` and has nothing to do with the movie. A compiler must skip it. Treating it as
content is the first thing that goes wrong when you write this parser from the shape of the
JSON alone.

A `Frame` carries `start` and `end` (inclusive, 1-based), so a cel that holds for five frames
is one object, not five. Scripts hang off frames and clips as `{ name, src }`.

## Paths are raw paper.js

A `Path` object's `json` field is paper.js `exportJSON` output, passed through untouched. That
means several things the rest of the file does not prepare you for.

Segment handles are **relative to their anchor**, not absolute. A segment with handles
serializes as `[[anchor], [handleIn], [handleOut]]`, but a segment without them collapses to a
bare `[x, y]` — and both forms appear in one document, because the ellipse tool writes the
first and the rectangle tool writes the second. Anything that assumes a uniform segment shape
parses one of the two tools' output and not the other.

The top-level class is not always `Path`. It can be `CompoundPath`, `Raster`, `PointText` or
`Group`. Colours arrive as hex strings *or* as float arrays, depending on which code path in
the engine set them.

When emitting SWF, round **absolute** coordinates to twips and then take deltas. Taking deltas
in floating point and rounding those accumulates drift across a long path, and the error is
invisible on any shape small enough to eyeball.

## The brush draws compound paths, and SWF has no fill rule

The brush is potrace output (`engine/src/tools/Brush.js`). It produces `CompoundPath`s whose
holes exist because of winding direction — the outer contour runs one way and the hole runs
the other, and paper.js resolves them under the non-zero rule at render time.

SWF has no fill rule at all. A shape's fill is declared per edge: `FillStyle0` is what is on
the left of the edge, `FillStyle1` what is on the right. So a brush stroke cannot be
transcribed edge for edge — it has to be planarized first (self-union under non-zero), the
winding normalized, and the fill sides assigned from the result. `fixtures/brush-donut.wick`
exists to keep that honest; a donut whose hole fills in is the failure this catches.

## Layers count down, SWF depths count up

Wick layer index 0 is the **frontmost** layer — `View.Timeline` reverses the list before
rendering. SWF is the other way round: a higher depth draws on top. twip maps them with
`depth_base = (layer_count − layer_index) × 1000` (`src/lib.rs:987`), banding each layer so
drawables within a frame can take consecutive depths inside it without colliding with the next
layer.

Hidden layers still render in published output — the engine checks `isPublished`, not
visibility. That is Wick's behaviour and twip matches it rather than quietly improving on it.

## Tweens are applied absolutely, and only to clips

`Frame.applyTweenTransforms` (`engine/src/Frame.js`) copies the tween's transformation onto
every clip on the frame as a **replacement**, not a composition. Loose paths on that same frame
are not transformed at all. So a frame holding one clip and one drawn path, with a tween on it,
moves the clip and leaves the path where it was drawn.

Matrix mapping is otherwise clean. Clip children are re-based into clip-local coordinates when
the clip is created (`Clip.js addObjects`) and the view pivots the group at the origin, so
`PlaceObject.matrix` is just `clip.transformation.toMatrix()`. Both systems are y-down, and
`[a, b, c, d, tx, ty]` maps to `[ScaleX, RotateSkew0, RotateSkew1, ScaleY, TranslateX,
TranslateY]` with no sign games.

### Interpolation is per-property, and that is a deliberate divergence

The engine's default tween method decomposes each endpoint into paper.js values, lerps every
property, and then recomposes through a matrix round trip —
`fromMatrix(toMatrixPaper(...))`. twip lerps x, y, scaleX, scaleY, rotation, skew and opacity
per property and builds the SWF matrix directly, which is the engine's own `'skew'` branch
minus the round trip.

The two agree bit for bit on every well-behaved tween, because the round trip is an identity
there. It is only reachable where it is broken, and it breaks three ways —
reproduced verbatim in `scripts/oracle-tween.js` rather than argued from reading:

- at `scaleX = 0` the recompose divides zero by zero and yields `NaN`;
- for `scaleX < 0` it silently flips the sign positive and snaps rotation to ±180, turning a
  mirror into a rotation;
- the `skew.x === 0` guard is dead, because `skew` is a `Number` and `.x` is `undefined`.

Matching bug for bug would mean emitting `NaN` into a movie. Nobody authored that, so twip
does not reproduce it. `negative_scale_flip_tween_stays_signed_and_finite` and
`rotation_tween_through_90_degrees_stays_finite` pin the divergence so a future "match the
engine" change cannot quietly reintroduce it.

`fullRotations` applies to rotation only, as `valB += 360 × n`.

### Skew

`Transform` carries a signed `skew_deg` parsed from `transformation.skew`. It is absent from
everything the upstream editor writes and defaults to zero; the fork serializes it. The matrix
reproduces `Transformation.toMatrix()` (`engine/src/Transformation.js:102`) — the x basis stays
at `rotation` while the y basis rotates to `rotation + skew`:

```
a = sx·cos(r)         b = sx·sin(r)
c = −sy·sin(r + k)    d = sy·cos(r + k)
```

At `k = 0` that collapses to plain scale-and-rotate, which is why adding skew re-rendered every
pre-existing golden bit-identically. Expected values come from running the engine's own
JavaScript (`node scripts/oracle-tween.js`), not from re-deriving the algebra.

The editor has a "Skew Rotate" toggle that flips the engine between its `'skew'` and `'normal'`
tween methods. twip always takes the `'skew'` path, so that toggle changes the editor's preview
and not the export — deliberately, since the export is the one that is not `NaN` at
`scaleX = 0`.

### Opacity

Opacity becomes a `PlaceObject` colour transform multiplying alpha, per baked frame. Without
it a fade exports fully opaque.

One divergence is accepted rather than fixed: paper.js composites a group's opacity offscreen
and then blends, while SWF's colour transform multiplies each shape independently. Overlapping
children inside a translucent clip therefore differ between the editor canvas and the player.
Fixtures that do this are excluded from strict pixel comparison.

## Engine versions, and why the fixtures nearly lied

Documents carry a `wickengine` stamp. The editor deployed at wickeditor.com writes
`2021.1.22`; the fork vendored at `editor/` writes `2026.7.24`. Every fixture in this repo was
originally authored on the deployed editor, which meant the parser had only ever been tested
against a serialization nothing in this tree produces — a field that moved in five years of
fork history would have mis-parsed every real save while the whole suite stayed green.

`fixtures/editor-tween.wick` closes that. `editor/dev/make-fixture.mjs` (`pnpm fixture`) drives
the real Rectangle tool through Playwright mouse events, calls the engine's own `createTween`
for the clip wrap and the keys, and hands the project back to Node through
`Wick.WickFile.toWickFile(project, cb, 'base64')`. Base64 rather than the save button on
purpose: `saveFileFromWick` is a FileSaver blob download, and going through it would test
FileSaver.

## The SWF side

Notes that cost a day each to find, none of which are visible in twip's own source.

**The `swf` crate on crates.io is a decoy.** Version 0.2.2 there is an 18-month-stale package
wearing the same version number as ruffle master's `swf/`, dozens of commits behind. The
dependency must be a git dependency pinned to one `ruffle-rs/ruffle` revision, and the golden
oracle's exporter has to be built from that same revision. Bump them together or not at all.
This is also why there is no crates.io release of twip — crates.io rejects git dependencies.

**`DefineShape4`, unconditionally.** RGBA fills need version 3 or higher, `LineStyle2` caps and
joins need 4, and the non-zero winding flag is only written for 4 — which matters because
paper.js's default fill rule is non-zero. Lower versions drop alpha silently or hard-error.

**`avm1::write` is public, with three sharp edges.** `DoAction` takes `&[u8]` while `Tag<'a>`
borrows, so the actions need an owned byte-buffer arena that outlives the tag list.
`Action::End` must be appended by hand. `write_tag_list` appends `Tag::End` implicitly, so
pushing one yourself writes two.

**Header and sprite `num_frames` are caller-supplied.** Compute them as the `ShowFrame` count
in the same function that finalizes each timeline, or they drift from the tags they describe.

**Clicks are clip events, not mouse events.** `ClipEventFlag::PRESS` on a `PlaceObject`'s clip
actions gives a hit area of the clip's own shapes. `MOUSE_DOWN` fires stage-globally and is not
what a button wants. `PRESS` requires SWF 6, which is free — twip writes header version 8
anyway. No button tags are needed for this.

**General JavaScript is not compiled.** twip recognizes a small vocabulary of frame-script
calls — `stop`, `play`, `gotoAndPlay`, `gotoAndStop` — and compiles those to AVM1. Anything
else is left uncompiled and warned about. A general JS-to-AVM1 compiler is a permanent
non-goal; if full ActionScript 3 ever matters, Apache Royale already exists.

## Deliberately not done

Frame scripts and press handlers *inside* a nested clip's body. Compiling them would force the
whole `defs` pipeline off `'static`, and no fixture has needed it yet. They are collected and
warned about rather than silently dropped.
