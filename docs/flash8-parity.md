# What Flash 8 could do

A target to aim at, and an honest account of where twip stands against it.

## What "Flash 8" means here

Macromedia Flash Professional 8 shipped in 2005 and is the height most people mean by
"Flash". It authored **SWF version 8**, and that number is the useful definition: the
authoring tool's features are hard to enumerate exhaustively and easy to argue about, but the
file format is written down, and anything Flash 8 could put on a screen it had to put in a
SWF 8 file.

So this document is organised around the format. Every capability below is either a tag in
the SWF specification or a property of one, and each is marked with where twip stands.

Sourced from the **SWF File Format Specification v19** (Adobe, the last public revision;
[open-flash mirror](https://open-flash.github.io/mirrors/swf-spec-19.pdf)). v19 documents
SWF 1 through 19, so it is a superset — items introduced *in* SWF 8 are marked **[SWF 8]**,
and anything unmarked was already there in an earlier version and therefore also in Flash 8.
Line and page references are to that PDF.

The tag inventory is cross-checked against `swf/src/tag_code.rs` in the ruffle revision twip
pins, which enumerates 70 tag codes — the spec's set plus a few undocumented vendor tags
(`NameCharacter`, `ProductInfo`, `DebugId`, `EnableTelemetry`).

**Status key** — ● built · ◐ partial · ○ not started · ✗ out of scope

---

## 1. Display list

The spine of every movie: put a character on stage, move it, take it off.

| Capability | Tags | twip |
|---|---|---|
| Place a character at a depth with a matrix | `PlaceObject`, `PlaceObject2` | ● |
| Colour transform on a placed instance | `PlaceObject2` CXFORMWITHALPHA | ● |
| Remove from a depth | `RemoveObject`, `RemoveObject2` | ● |
| Advance a frame | `ShowFrame` | ● |
| Named instances (`_root.myClip`) | `PlaceObject2` Name field | ○ |
| Clip depths — **mask layers** | `PlaceObject2` ClipDepth | ○ |
| Per-instance **clip actions** (onEnterFrame, onPress…) | `PlaceObject2` CLIPACTIONS | ◐ mouse press only |
| **Filters** on an instance **[SWF 8]** | `PlaceObject3` SurfaceFilterList | ○ |
| **Blend modes** on an instance **[SWF 8]** | `PlaceObject3` BlendMode | ○ |
| **Bitmap caching** **[SWF 8]** | `PlaceObject3` BitmapCache | ○ |
| Class association for AS3 | `PlaceObject3` ClassName, `SymbolClass` | ✗ AVM2 |

The eight filter types the format defines, all of them SWF 8: drop shadow, blur, glow, bevel,
gradient glow, gradient bevel, colour matrix, convolution.

Blend modes: normal, layer, multiply, screen, lighten, darken, difference, add, subtract,
invert, alpha, erase, overlay, hardlight.

## 2. Shapes and strokes

| Capability | Tags | twip |
|---|---|---|
| Filled and stroked paths, straight and curved edges | `DefineShape`, `DefineShape2`, `DefineShape3` | ● |
| Solid fills with alpha | `DefineShape3` RGBA | ● |
| Multiple fill and line styles per shape | FILLSTYLEARRAY, LINESTYLEARRAY | ● |
| Holes via winding (planarised brush shapes) | — | ● |
| **Linear and radial gradient fills** | `GRADIENT` | ● |
| **Focal radial gradients** **[SWF 8]** | `FOCALGRADIENT`, `DefineShape4` only | ● |
| **15 gradient stops** instead of 8 **[SWF 8]** | `DefineShape4` NumGradients 1–15 | ● |
| **Stroke caps and joins** **[SWF 8]** | `LINESTYLE2`, `DefineShape4` | ● |
| **Bitmap fills** (clipped, tiled, smoothed) | FILLSTYLE types 0x40–0x43 | ○ |
| Gradient-filled strokes **[SWF 8]** | `LINESTYLE2` FILLSTYLE | ○ |
| Non-scaling strokes **[SWF 8]** | `LINESTYLE2` | ○ |

Worth knowing: before `LINESTYLE2` arrived in SWF 8, *every* line in a SWF has rounded joins
and round caps — the format could not express anything else.

twip emits `DefineShape4`, which is the SWF 8 shape tag, so the SWF 8 shape features are
available to it rather than blocked: caps and joins already ride out on `LINESTYLE2`, and
gradients get focal points and the full fifteen stops instead of the eight the older tags
allow. A ramp with more stops than that loses its tail, and the export says so.

## 3. Bitmaps

| Capability | Tags | twip |
|---|---|---|
| JPEG images, shared and per-image tables | `DefineBits` + `JpegTables`, `DefineBitsJPEG2` | ○ |
| JPEG with an alpha channel | `DefineBitsJPEG3` | ○ |
| Lossless (zlib) 8/15/24-bit | `DefineBitsLossless` | ○ |
| Lossless with alpha (32-bit) | `DefineBitsLossless2` | ○ |

The editor imports images today and the compiler drops them. It at least says so now — see
`wick::Skipped` in [`src/wick.rs`](../src/wick.rs).

## 4. Text and fonts

| Capability | Tags | twip |
|---|---|---|
| Static text from embedded glyph outlines | `DefineText`, `DefineText2` | ○ |
| Embedded fonts | `DefineFont`, `DefineFont2` | ○ |
| Font metrics and mapping to device fonts | `DefineFontInfo`, `DefineFontInfo2` | ○ |
| **Dynamic and input text fields** | `DefineEditText` | ○ |
| Text with a device font (no glyph outlines needed) | `DefineEditText` UseOutlines=0 | ○ |
| **FlashType / advanced anti-aliasing** **[SWF 8]** | `DefineFont3`, `DefineFontAlignZones`, `CSMTextSettings` | ○ |
| HTML subset in text fields | `DefineEditText` HTML flag | ○ |

`DefineEditText` with a device font is the cheapest text in the format: no glyph outlines to
extract, the player renders with a system face. `DefineText` + `DefineFont2` means parsing a
font file for outlines, which is a different order of work.

## 5. Sound

| Capability | Tags | twip |
|---|---|---|
| Event sounds attached to a frame | `DefineSound` + `StartSound` | ○ |
| Sounds on button states | `DefineButtonSound` | ○ |
| Streaming sound synced to the timeline | `SoundStreamHead`, `SoundStreamHead2`, `SoundStreamBlock` | ○ |
| Envelopes, loops, in/out points | SOUNDINFO | ○ |

Codecs the format allows: uncompressed PCM, ADPCM, MP3, Nellymoser (8/16 kHz), Speex. The
editor stores whatever was imported, so a writer has to transcode or restrict.

## 6. Shape morphing

| Capability | Tags | twip |
|---|---|---|
| **Shape tweens** between two shapes | `DefineMorphShape` | ○ |
| Morphing with SWF 8 stroke and gradient features **[SWF 8]** | `DefineMorphShape2` | ○ |

Neither twip nor the Wick engine can author a shape tween today, so this one is an editor
feature before it is a compiler feature.

## 7. Buttons

| Capability | Tags | twip |
|---|---|---|
| Up / Over / Down / Hit states | `DefineButton`, `DefineButton2` | ○ |
| Per-state actions on button events | `DefineButton2` BUTTONCONDACTION | ◐ press handled as a clip action |
| Colour transform on hover | `DefineButtonCxform` | ○ |
| **Filters and blend modes on button states** **[SWF 8]** | `DefineButton2` ButtonHasFilterList / ButtonHasBlendMode | ○ |

The engine has a Button class with up/over/down states; twip's compiler treats a Button as a
plain Clip and renders its timeline, ignoring the states.

## 8. Sprites and timeline control

| Capability | Tags | twip |
|---|---|---|
| Nested timelines (movie clips) | `DefineSprite` | ● |
| Frame labels | `FrameLabel` | ○ |
| Named scenes | `DefineSceneAndFrameLabelData` | ○ |
| Stage colour | `SetBackgroundColor` | ● |
| Movie-level flags | `FileAttributes` **[SWF 8]** | ○ |
| **9-slice scaling** **[SWF 8]** | `DefineScalingGrid` | ○ |
| Export/import symbols across SWFs | `ExportAssets`, `ImportAssets`, `ImportAssets2` **[SWF 8]** | ✗ |
| Arbitrary embedded data | `DefineBinaryData` | ✗ |
| Metadata (RDF/XMP) | `Metadata` | ○ |

## 9. Video

| Capability | Tags | twip |
|---|---|---|
| Embedded video stream | `DefineVideoStream` + `VideoFrame` | ✗ |

Codecs: H.263 (Sorenson Spark), Screen Video v1/v2, **On2 VP6** and **VP6 with alpha**, the
last two being Flash 8's headline video feature.

## 10. ActionScript

| Capability | Tags | twip |
|---|---|---|
| Frame actions (AVM1 bytecode) | `DoAction` | ◐ four commands |
| Initialisation actions for a sprite | `DoInitAction` | ○ |
| Clip event handlers | `PlaceObject2` CLIPACTIONS | ◐ press only |
| AS3 / AVM2 | `DoAbc`, `DoAbc2`, `SymbolClass` | ✗ |

twip recognises `stop()`, `play()`, `gotoAndPlay(n)` and `gotoAndStop(n)` by pattern-matching
the script source and emits the matching AVM1 actions. Everything else in a script is ignored.

AVM1's instruction set is an ECMAScript-3 machine — `DefineFunction2` with closures and
registers, `GetMember`/`SetMember`, `NewObject`, `InitArray`, prototype `Extends`. A
JavaScript- or TypeScript-shaped language compiles onto it directly, which is exactly what
Macromedia's AS2 compiler did.

## 11. Authoring-side, with no tag of its own

Flash 8 features that live entirely in the editor and leave no trace in the format. Most are
questions of interface, not of output.

| Feature | twip |
|---|---|
| Library of reusable symbols | ● |
| Onion skinning | ● |
| Motion tweens with easing | ● |
| Timeline layers, keyframes, frame-by-frame | ● |
| The Flash 8 "object drawing" model (shapes that do not merge) | ● paper.js does not merge |
| Motion guides (tween along a drawn path) | ○ |
| Mask layers | ○ |
| Guide and folder layers | ○ |
| Script Assist | ✗ |
| Components (UI widgets) | ✗ |
| Video encoder | ✗ |

## Where this leaves twip

The compiler emits `DefineShape`, `DefineSprite`, `PlaceObject`, `RemoveObject`,
`SetBackgroundColor`, `ShowFrame` and `DoAction`. Everything else in this document is
unwritten.

That is seven tags of seventy, but tags are a poor unit — `DefineShape4` alone carries solid
fills, gradients of three kinds, and every stroke style the format has. What the number does
say is that whole *categories* are absent: nothing here defines a bitmap, a font, a sound or
a video.

That reads worse than it is, for two reasons worth stating plainly.

**The runtime is not the constraint.** Ruffle — which is the only player twip targets, and
the one it previews in — already implements essentially all of the above: every filter type is
handled in its render layer, morph shapes and masks are in its display list, and it ships
decoders for PCM, ADPCM, MP3, Nellymoser, G.711 and AAC, plus H.263, VP6, VP6-with-alpha,
Screen Video and H.264. Anything twip learns to emit will play.

**The writer is the part nobody rebuilt.** Ruffle reconstructed the SWF *reader* because
preservation needs one. The authoring side was Adobe's and went with them. `swf/src/write.rs`
and `swf/src/avm1/write.rs` exist in the crate twip already depends on, so the encoding is
solved — what is missing is the mapping from a `.wick` document onto it, which is twip's whole
job and is written one capability at a time.

The cheapest ground per unit of work, in order: `DefineEditText` with device fonts (no glyph
outlines to extract — the player renders with a system face), bitmap fills, then event sounds.
Gradients were first on this list and are done.
