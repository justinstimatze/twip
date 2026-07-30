//! Parse a `.wick` document (zip + `project.json`) into flat contours
//! (fill and/or stroke) ready to become SWF shapes.
//!
//! Scope: static shapes (fills and strokes) plus nested clips (recursive timelines).
//! Curves are flattened to polylines; the format details were ground-truthed
//! against a real save (see docs/wick-format.md): `objects` is a flat
//! UUID-keyed map, parents reference children by UUID, and `Selection` objects
//! are editor UI state to skip. The walk is root-down (project -> root Clip ->
//! Timeline -> ...) so multiple timelines (one per clip) resolve correctly.

use anyhow::{Context, Result, anyhow};
use serde_json::Value;
use std::collections::BTreeMap;
use std::io::{Cursor, Read};
use swf::Color;

/// What a document held that did not reach the movie.
///
/// The compiler has no reader for text, images, sounds or gradients, and leaving them out is
/// the right answer — a guess at a gradient is a confident wrong one, which is the same
/// reason `import` refuses to infer tween curves back out of matrices. Leaving them out
/// *silently* is the part that costs someone an afternoon: the export succeeds, the `.swf`
/// plays, and the only sign that the title card is missing is that it is missing.
///
/// So the walk counts what it declined. Every drop site reports through here, and the kinds
/// are read off the document rather than enumerated in advance, so a `.wick` holding
/// something no one anticipated is reported by whatever name it gave itself instead of
/// vanishing into a `_ => {}`.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Skipped {
    counts: BTreeMap<String, usize>,
}

impl Skipped {
    fn note(&mut self, what: &str) {
        *self.counts.entry(what.to_owned()).or_default() += 1;
    }

    pub fn is_empty(&self) -> bool {
        self.counts.is_empty()
    }

    /// How many objects were left out, across every kind.
    pub fn total(&self) -> usize {
        self.counts.values().sum()
    }

    /// Each kind and how many of it, by name. Ordered, so two runs over one document read
    /// the same and a test can assert on the whole thing.
    pub fn kinds(&self) -> impl Iterator<Item = (&str, usize)> {
        self.counts.iter().map(|(k, n)| (k.as_str(), *n))
    }

    /// One line for a terminal or a toast: `2 text objects, 1 gradient fill`.
    ///
    /// Plural by adding an s, which is why every name this can hold is a noun that takes
    /// one. A name the walk read off the document — a class no one anticipated — is left
    /// exactly as it was found, since inventing a plural for it would be worse than the
    /// bare repetition.
    pub fn describe(&self) -> String {
        self.counts
            .iter()
            .map(|(kind, n)| {
                if *n == 1 || !kind.chars().next().is_some_and(char::is_lowercase) {
                    format!("{n} {kind}")
                } else {
                    format!("{n} {kind}s")
                }
            })
            .collect::<Vec<_>>()
            .join(", ")
    }
}

/// A parsed document: stage size (pixels), playback rate, and the timeline's layers.
pub struct Document {
    pub width: f64,
    pub height: f64,
    /// Frames per second, straight from the project. The SWF header carries this, so getting
    /// it wrong plays the whole movie at the wrong speed while every frame is still correct.
    pub framerate: f64,
    /// The stage colour, which becomes a `SetBackgroundColor` tag.
    ///
    /// Its alpha is dropped on the way out: the SWF tag is a three-byte RGB record, and there
    /// is nothing behind a stage for a translucent one to reveal.
    pub background: Color,
    /// Layers in Wick order — index 0 is frontmost (depth is resolved at compile).
    pub layers: Vec<Layer>,
    /// What the walk found and could not carry. Empty for every fixture in this repo.
    pub skipped: Skipped,
}

/// One timeline layer: a sequence of keyframes.
pub struct Layer {
    pub frames: Vec<Frame>,
}

/// One keyframe, occupying frame numbers `start..=end` (1-indexed).
///
/// Holds loose shapes and nested clips. Within a frame, shapes are drawn first
/// (behind) and clips on top — a v1 simplification; the true z-order is the
/// child array order, which mixes the two. Fixtures keep clips and loose paths
/// on separate layers so this never bites.
///
/// A frame may also carry `tweens`: motion-tween keyframes that animate the
/// frame's (single) clip across its span. An empty `tweens` means the clip is
/// held statically at its own transform.
pub struct Frame {
    pub start: u16,
    pub end: u16,
    pub contours: Vec<Contour>,
    pub clips: Vec<Clip>,
    pub tweens: Vec<Tween>,
    /// Wick behavior scripts on this frame (`[{name, src}]`). The compiler
    /// recognizes a small command subset (stop/play/gotoAndPlay/gotoAndStop) in
    /// the `default`/`load` scripts and emits AVM1; the rest is left uncompiled.
    pub scripts: Vec<Script>,
}

/// A nested clip: its own transform (placed on the parent frame) plus its own
/// timeline, which compiles to a SWF `DefineSprite`. Recursive.
pub struct Clip {
    pub transform: crate::Transform,
    pub layers: Vec<Layer>,
    /// Wick behavior scripts on this clip. Milestone B recognizes
    /// `mousepressed`/`mouseclick` here and emits PRESS clip actions; unused for now.
    pub scripts: Vec<Script>,
}

/// A Wick behavior script: a `name` from the engine's fixed set (`default`,
/// `mousepressed`, `load`, …) and its JavaScript `src`. twip compiles only a
/// small recognized command subset; see `recognize_frame_actions` in lib.rs.
pub struct Script {
    pub name: String,
    pub src: String,
}

/// A motion-tween keyframe: the frame's clip should hold `transform` at this
/// playhead, interpolating to the next tween in between. Wick serializes one of
/// these per tween keyframe inside the frame.
pub struct Tween {
    /// 1-indexed position within the frame (1 = `Frame::start`).
    pub playhead: u16,
    pub transform: crate::Transform,
    /// Extra whole turns added to the rotation as it interpolates to the next
    /// tween (negative = counter-clockwise).
    pub full_rotations: i32,
    /// Wick easing curve name governing the segment from this tween to the next.
    /// One of `Wick.Tween.VALID_EASING_TYPES`; unknown names ease linearly.
    pub easing: String,
    /// Control points of a custom cubic-Bézier curve, `[x1, y1, x2, y2]`, read only when
    /// `easing` is `"custom"`. `None` for every file the upstream wickeditor.com engine
    /// writes and for everything twip wrote before the graph editor — a file that old
    /// cannot name the `custom` curve either, so the absence never has to be papered over.
    pub bezier: Option<[f64; 4]>,
}

/// One contour in absolute stage pixels (y-down). A path may carry a fill, a
/// stroke, or both; at least one is present or the parser drops it.
pub struct Contour {
    /// Outer polyline vertices. A filled or `closed` contour also closes from the
    /// last vertex back to the first; an open stroke does not.
    pub points: Vec<(f64, f64)>,
    /// Inner rings (holes), present only for a CompoundPath (e.g. a brush donut).
    /// When non-empty, the compiler planarizes `points` + `holes` so the holes
    /// render empty under the non-zero winding rule.
    pub holes: Vec<Vec<(f64, f64)>>,
    /// Whether paper.js marked the path closed (a fill closes regardless).
    pub closed: bool,
    pub fill: Option<Color>,
    pub stroke: Option<Stroke>,
}

/// A stroke outline: paper.js `strokeColor` / `strokeWidth` / `strokeCap` /
/// `strokeJoin`, mapped to SWF LineStyle2 at compile.
pub struct Stroke {
    pub color: Color,
    /// Width in stage pixels.
    pub width: f64,
    pub cap: StrokeCap,
    pub join: StrokeJoin,
    /// Miter limit, only meaningful for `StrokeJoin::Miter`.
    pub miter_limit: f64,
}

/// paper.js `strokeCap`. `Butt` (the paper.js default) is SWF's "no cap".
#[derive(Clone, Copy)]
pub enum StrokeCap {
    Butt,
    Round,
    Square,
}

/// paper.js `strokeJoin`.
#[derive(Clone, Copy)]
pub enum StrokeJoin {
    Miter,
    Round,
    Bevel,
}

fn classname(v: &Value) -> Option<&str> {
    v.get("classname").and_then(Value::as_str)
}

fn children(v: &Value) -> Vec<String> {
    v.get("children")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

/// Parse the bytes of a `.wick` file into a [`Document`].
pub fn parse_wick(bytes: &[u8]) -> Result<Document> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).context("open .wick zip")?;
    let mut json = String::new();
    zip.by_name("project.json")
        .context("project.json missing from .wick")?
        .read_to_string(&mut json)?;
    let root: Value = serde_json::from_str(&json).context("parse project.json")?;

    let project = root
        .get("project")
        .ok_or_else(|| anyhow!("no project root"))?;
    let width = project
        .get("width")
        .and_then(Value::as_f64)
        .unwrap_or(550.0);
    let height = project
        .get("height")
        .and_then(Value::as_f64)
        .unwrap_or(400.0);
    // 12 is the engine's own constructor default (engine/src/base/Project.js:39), so a
    // project.json that omits the key means 12, not whatever the SWF spec would prefer.
    //
    // This stays 12 even though the editor now starts NEW projects at 24
    // (EditorCore.newProject). The two are different questions: 24 is what twip wants people
    // to author at, while this is how to read a document that never said. Moving this to match
    // would re-time every existing .wick that omits the field rather than only changing what
    // new ones begin as.
    let framerate = project
        .get("framerate")
        .and_then(Value::as_f64)
        .filter(|f| *f > 0.0)
        .unwrap_or(12.0);

    // White when the key is absent or unreadable, matching the engine's own constructor
    // default (engine/src/base/Project.js:40) — and matching what a player shows for a movie
    // with no SetBackgroundColor tag, which is what every .wick compiled before this got.
    let background = project
        .get("backgroundColor")
        .and_then(Value::as_str)
        .and_then(parse_css_color)
        .unwrap_or(Color::WHITE);

    let objects = root
        .get("objects")
        .and_then(Value::as_object)
        .ok_or_else(|| anyhow!("no objects map"))?;

    // Walk root-down so nested clips (each with its own Timeline) resolve: the
    // project's children hold a Selection (skipped) plus the root Clip; the root
    // Clip's children hold the main Timeline.
    let root_clip = child_objects(project, objects)
        .find(|v| classname(v) == Some("Clip"))
        .ok_or_else(|| anyhow!("no root Clip in project"))?;
    let timeline = child_objects(root_clip, objects)
        .find(|v| classname(v) == Some("Timeline"))
        .ok_or_else(|| anyhow!("root Clip has no Timeline"))?;

    let mut skipped = Skipped::default();
    let layers = parse_timeline(timeline, objects, &mut skipped)?;
    Ok(Document {
        width,
        height,
        framerate,
        background,
        layers,
        skipped,
    })
}

/// What to call a paper.js or Wick class in a sentence aimed at whoever drew it. Anything
/// not named here keeps the name the document gave it, which is better than "unsupported
/// object" and is the case that keeps this list from having to be complete.
fn human(classname: &str) -> &str {
    match classname {
        "PointText" => "text object",
        "Raster" => "image",
        "SoundAsset" => "sound",
        other => other,
    }
}

type Objects = serde_json::Map<String, Value>;

/// Resolve an object's `children` UUIDs to the objects they name (missing ones dropped).
fn child_objects<'a>(v: &Value, objects: &'a Objects) -> impl Iterator<Item = &'a Value> {
    children(v)
        .into_iter()
        .filter_map(move |uuid| objects.get(&uuid))
}

/// Parse a Timeline object into its layers (Wick order; index 0 = frontmost).
fn parse_timeline(timeline: &Value, objects: &Objects, skipped: &mut Skipped) -> Result<Vec<Layer>> {
    let mut layers = Vec::new();
    for layer_obj in child_objects(timeline, objects) {
        if classname(layer_obj) != Some("Layer") {
            continue;
        }
        let mut frames = Vec::new();
        for frame_obj in child_objects(layer_obj, objects) {
            if classname(frame_obj) != Some("Frame") {
                continue;
            }
            let start = frame_obj.get("start").and_then(Value::as_u64).unwrap_or(1) as u16;
            let end = frame_obj
                .get("end")
                .and_then(Value::as_u64)
                .unwrap_or(u64::from(start)) as u16;
            let mut contours = Vec::new();
            let mut clips = Vec::new();
            let mut tweens = Vec::new();
            // A sound is a UUID on the frame rather than a child of it (engine
            // Frame._serialize writes `data.sound`), so it is the one attachment that has to
            // be looked for by name — nothing in the child walk below would ever see it.
            if frame_obj.get("sound").and_then(Value::as_str).is_some() {
                skipped.note(human("SoundAsset"));
            }
            for child in child_objects(frame_obj, objects) {
                match classname(child) {
                    Some("Path") => {
                        if let Some(contour) = path_to_contour(child, skipped)? {
                            contours.push(contour);
                        }
                    }
                    // Button is a Clip subclass; its extra state (states, script) is
                    // ignored for now — it still renders as its clip timeline.
                    Some("Clip" | "Button") => clips.push(parse_clip(child, objects, skipped)?),
                    Some("Tween") => tweens.push(parse_tween(child)),
                    // Everything else on a frame is either editor state with nothing to
                    // draw, or something with no reader here. Only the second is worth
                    // saying, and the difference is that the first has a name this knows.
                    Some("Selection") | None => {}
                    Some(other) => skipped.note(human(other)),
                }
            }
            // Wick may serialize tweens out of order; the interpolator wants them by playhead.
            tweens.sort_by_key(|t| t.playhead);
            frames.push(Frame {
                start,
                end,
                contours,
                clips,
                tweens,
                scripts: parse_scripts(frame_obj),
            });
        }
        layers.push(Layer { frames });
    }
    Ok(layers)
}

/// Parse a Clip object: its placement transform plus its own (recursive) timeline.
fn parse_clip(clip: &Value, objects: &Objects, skipped: &mut Skipped) -> Result<Clip> {
    let transform = parse_transform(clip);
    let timeline = child_objects(clip, objects)
        .find(|v| classname(v) == Some("Timeline"))
        .ok_or_else(|| anyhow!("Clip has no Timeline"))?;
    let layers = parse_timeline(timeline, objects, skipped)?;
    Ok(Clip {
        transform,
        layers,
        scripts: parse_scripts(clip),
    })
}

/// Read a Tickable's inline `scripts` array (`[{name, src}]`). Wick serializes
/// this directly on the object's `data` (engine: `data.scripts = ... this._scripts`),
/// not as a UUID child reference. Missing/malformed entries are skipped.
fn parse_scripts(obj: &Value) -> Vec<Script> {
    obj.get("scripts")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|s| {
                    let name = s.get("name").and_then(Value::as_str)?;
                    let src = s.get("src").and_then(Value::as_str).unwrap_or("");
                    Some(Script {
                        name: name.to_string(),
                        src: src.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// A Tween's `transformation` is the same inline shape a Clip carries, plus a
/// `playheadPosition`, `fullRotations`, and `easingType`.
fn parse_tween(tween: &Value) -> Tween {
    Tween {
        playhead: tween
            .get("playheadPosition")
            .and_then(Value::as_u64)
            .unwrap_or(1) as u16,
        transform: parse_transform(tween),
        full_rotations: tween
            .get("fullRotations")
            .and_then(Value::as_i64)
            .unwrap_or(0) as i32,
        easing: tween
            .get("easingType")
            .and_then(Value::as_str)
            .unwrap_or("none")
            .to_string(),
        bezier: parse_bezier(tween.get("bezier")),
    }
}

/// A `bezier` field, if it is there and is four numbers. Anything else — absent, the wrong
/// length, a string where a number should be — is `None` rather than an error: an older file
/// simply does not have this, and a newer one that has it malformed should fall back to the
/// named easing beside it rather than refuse to open.
fn parse_bezier(value: Option<&Value>) -> Option<[f64; 4]> {
    let array = value?.as_array()?;
    if array.len() != 4 {
        return None;
    }
    let mut out = [0.0; 4];
    for (slot, item) in out.iter_mut().zip(array) {
        *slot = item.as_f64()?;
    }
    Some(out)
}

/// A Clip's `transformation` is an inline `{x, y, scaleX, scaleY, rotation, skew, opacity}`.
/// `skew` is absent from anything the upstream wickeditor.com engine writes; the fork
/// serializes it (`Transformation.values`), so read it and default to 0.
fn parse_transform(clip: &Value) -> crate::Transform {
    let t = clip.get("transformation");
    let g = |key: &str, default: f64| {
        t.and_then(|t| t.get(key))
            .and_then(Value::as_f64)
            .unwrap_or(default)
    };
    crate::Transform {
        x: g("x", 0.0),
        y: g("y", 0.0),
        scale_x: g("scaleX", 1.0),
        scale_y: g("scaleY", 1.0),
        rotation_deg: g("rotation", 0.0),
        skew_deg: g("skew", 0.0),
        opacity: g("opacity", 1.0),
    }
}

fn path_to_contour(path: &Value, skipped: &mut Skipped) -> Result<Option<Contour>> {
    // Path.json = [class, props] (raw paper.js exportJSON). class is "Path" for a
    // single path or "CompoundPath" for a brush stroke with holes. A text object and a
    // placed image are also Wick `Path`s — "PointText" and "Raster" inside the json —
    // which is why the editor lets you make both and the movie has neither.
    let json = path
        .get("json")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("Path.json not an array"))?;
    let props = json
        .get(1)
        .and_then(Value::as_object)
        .ok_or_else(|| anyhow!("Path props missing"))?;
    match json.first().and_then(Value::as_str) {
        Some("Path") => single_path_to_contour(props, skipped),
        Some("CompoundPath") => compound_to_contour(props, skipped),
        Some(other) => {
            skipped.note(human(other));
            Ok(None)
        }
        None => {
            skipped.note("unreadable path");
            Ok(None)
        }
    }
}

/// Read a style colour off a props map, counting it if it is there and cannot be read.
fn styled_color(
    props: &serde_json::Map<String, Value>,
    key: &str,
    skipped: &mut Skipped,
) -> Option<Color> {
    let raw = props.get(key)?;
    let color = read_color(raw);
    if color.is_none() {
        skipped.note(&unreadable_color(raw));
    }
    color
}

fn single_path_to_contour(
    props: &serde_json::Map<String, Value>,
    skipped: &mut Skipped,
) -> Result<Option<Contour>> {
    let segs = props
        .get("segments")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("Path has no segments"))?;
    let closed = props
        .get("closed")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    let points = flatten_segments(segs, closed);

    // A fill needs a closed area (>=3 points); a stroke can be a bare 2-point line.
    let fill = styled_color(props, "fillColor", skipped).filter(|_| points.len() >= 3);
    let stroke = parse_stroke(props, skipped).filter(|_| points.len() >= 2);
    if fill.is_none() && stroke.is_none() {
        return Ok(None);
    }
    Ok(Some(Contour {
        points,
        holes: vec![],
        closed,
        fill,
        stroke,
    }))
}

/// A CompoundPath: style lives on the compound, geometry on its `children` paths
/// (`["CompoundPath", { children: [["Path",{segments,closed}], ...], fillColor }]`).
/// The child rings are collected as outer + holes; the compiler planarizes them so
/// the holes render empty. Orientation is left to the planarizer, so which child is
/// "outer" here does not matter.
fn compound_to_contour(
    props: &serde_json::Map<String, Value>,
    skipped: &mut Skipped,
) -> Result<Option<Contour>> {
    let children = props
        .get("children")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("CompoundPath has no children"))?;

    let mut rings: Vec<Vec<(f64, f64)>> = Vec::new();
    for child in children {
        let child = child.as_array().and_then(|c| c.get(1)?.as_object());
        let Some(child) = child else { continue };
        let Some(segs) = child.get("segments").and_then(Value::as_array) else {
            continue;
        };
        let closed = child.get("closed").and_then(Value::as_bool).unwrap_or(true);
        let ring = flatten_segments(segs, closed);
        if ring.len() >= 3 {
            rings.push(ring);
        }
    }
    if rings.is_empty() {
        return Ok(None);
    }

    // A brush stroke is a solid fill; strokes on a CompoundPath are unusual but honored.
    let fill = styled_color(props, "fillColor", skipped);
    let stroke = parse_stroke(props, skipped);
    if fill.is_none() && stroke.is_none() {
        return Ok(None);
    }
    let points = rings.remove(0);
    Ok(Some(Contour {
        points,
        holes: rings,
        closed: true,
        fill,
        stroke,
    }))
}

/// Pull a stroke off a paper.js Path's props, or `None` if it has no `strokeColor`.
/// paper.js omits style keys left at their defaults, so width/cap/join fall back to
/// paper's own defaults (1px, butt, miter, miterLimit 10).
fn parse_stroke(props: &serde_json::Map<String, Value>, skipped: &mut Skipped) -> Option<Stroke> {
    let color = styled_color(props, "strokeColor", skipped)?;
    let width = props
        .get("strokeWidth")
        .and_then(Value::as_f64)
        .unwrap_or(1.0);
    let cap = match props.get("strokeCap").and_then(Value::as_str) {
        Some("round") => StrokeCap::Round,
        Some("square") => StrokeCap::Square,
        _ => StrokeCap::Butt,
    };
    let join = match props.get("strokeJoin").and_then(Value::as_str) {
        Some("round") => StrokeJoin::Round,
        Some("bevel") => StrokeJoin::Bevel,
        _ => StrokeJoin::Miter,
    };
    let miter_limit = props
        .get("miterLimit")
        .and_then(Value::as_f64)
        .unwrap_or(10.0);
    Some(Stroke {
        color,
        width,
        cap,
        join,
        miter_limit,
    })
}

/// paper.js colors are `[r,g,b]`/`[r,g,b,a]` floats in 0..1, or a CSS string — and, for a
/// gradient, an array whose first element is the word "gradient" rather than a number.
///
/// `None` for anything else, which is the whole point of the signature. The old total
/// version read a gradient's leading string as a channel, got 0 from `as_f64`, and painted
/// the shape opaque black: a sunset became a silhouette, the export said nothing, and
/// nothing in the file recorded that a colour had ever been asked for. Absent and counted
/// beats present and wrong.
fn read_color(v: &Value) -> Option<Color> {
    if let Some(arr) = v.as_array() {
        let ch = |i: usize| {
            arr.get(i)
                .and_then(Value::as_f64)
                .map(|f| (f * 255.0).round().clamp(0.0, 255.0) as u8)
        };
        // All three channels, not just the first: a value that is an array but not a colour
        // array must fail here rather than default its way to black.
        let (r, g, b) = (ch(0)?, ch(1)?, ch(2)?);
        let a = ch(3).unwrap_or(255);
        return Some(Color::from_rgb(
            (u32::from(r) << 16) | (u32::from(g) << 8) | u32::from(b),
            a,
        ));
    }
    parse_css_color(v.as_str()?)
}

/// What to call a colour that could not be read, in the export's own report.
///
/// paper.js writes a non-RGB colour as its own type name followed by its components
/// (`Color._serialize`: `/^(gray|rgb)$/.test(this._type) ? components : [this._type].concat(...)`),
/// so `["gradient", ...]`, `["hsl", h, s, l]`, and so on. Reading the type back out costs two
/// lines and turns "unreadable color" into "1 hsl color", which is the difference between a
/// warning someone can act on and one they can only be puzzled by.
///
/// Gradients are the case that matters — the editor has a tool for them — but every non-RGB
/// paper colour lands here, and every one of them used to compile to something wrong rather
/// than to nothing: a gradient to opaque black, an hsl to black, a one-component gray to dark
/// red. None of those were reported either.
fn unreadable_color(v: &Value) -> String {
    match v.as_array().and_then(|a| a.first()).and_then(Value::as_str) {
        Some("gradient") => "gradient".to_owned(),
        Some(kind) => format!("{kind} color"),
        None => "unreadable color".to_owned(),
    }
}

/// The CSS colour strings a `.wick` can hold, which is more than one shape.
///
/// Path fills arrive as float arrays, but the project's own `backgroundColor` is whatever
/// paper.js `toCSS()` produced — `rgb(255,255,255)` in every fixture, `rgba(r,g,b,a)` once a
/// colour is translucent. Read as hex, `rgb(255,255,255)` is not a number at all, so the
/// old parser's `unwrap_or(0)` turned every background into black. Nothing noticed because
/// nothing read the background.
///
/// `None` rather than a fallback colour, so callers decide what an unreadable string means:
/// a path defaults to black, a stage to white.
pub(crate) fn parse_css_color(s: &str) -> Option<Color> {
    let s = s.trim();

    if let Some(args) = s
        .strip_prefix("rgba(")
        .or_else(|| s.strip_prefix("rgb("))
        .and_then(|rest| rest.strip_suffix(')'))
    {
        let mut part = args.split(',').map(str::trim);
        let mut channel = || -> Option<u8> {
            Some(part.next()?.parse::<f64>().ok()?.round().clamp(0.0, 255.0) as u8)
        };
        let (r, g, b) = (channel()?, channel()?, channel()?);
        // Alpha is 0..1 in CSS and 0..255 here. Absent means opaque, which covers `rgb()`.
        let a = part
            .next()
            .and_then(|t| t.parse::<f64>().ok())
            .map_or(255, |f| (f * 255.0).round().clamp(0.0, 255.0) as u8);
        return Some(Color { r, g, b, a });
    }

    let hex = s.strip_prefix('#').unwrap_or(s);
    // #rgb is not #00000rgb. Expanding it here rather than letting from_str_radix read it as
    // one number, which is how `#f00` used to come out a dark blue.
    let expanded = if hex.len() == 3 {
        hex.chars().flat_map(|c| [c, c]).collect::<String>()
    } else {
        hex.to_string()
    };
    if expanded.len() != 6 && expanded.len() != 8 {
        return None;
    }
    let n = u32::from_str_radix(&expanded, 16).ok()?;
    if expanded.len() == 8 {
        return Some(Color::from_rgb(n >> 8, (n & 0xff) as u8));
    }
    Some(Color::from_rgb(n, 255))
}

struct Seg {
    anchor: (f64, f64),
    handle_in: (f64, f64),
    handle_out: (f64, f64),
}

/// A paper.js segment is either bare `[x,y]` (no handles) or
/// `[[ax,ay],[hInX,hInY],[hOutX,hOutY]]` with handles RELATIVE to the anchor.
fn parse_seg(v: &Value) -> Seg {
    let arr = v.as_array().cloned().unwrap_or_default();
    if arr.first().map(Value::is_number).unwrap_or(false) {
        let x = arr.first().and_then(Value::as_f64).unwrap_or(0.0);
        let y = arr.get(1).and_then(Value::as_f64).unwrap_or(0.0);
        return Seg {
            anchor: (x, y),
            handle_in: (0.0, 0.0),
            handle_out: (0.0, 0.0),
        };
    }
    let pt = |i: usize| {
        arr.get(i)
            .and_then(Value::as_array)
            .map(|p| {
                (
                    p.first().and_then(Value::as_f64).unwrap_or(0.0),
                    p.get(1).and_then(Value::as_f64).unwrap_or(0.0),
                )
            })
            .unwrap_or((0.0, 0.0))
    };
    Seg {
        anchor: pt(0),
        handle_in: pt(1),
        handle_out: pt(2),
    }
}

/// Flatten segments (lines + cubic beziers) into an absolute-coordinate polyline.
fn flatten_segments(segs: &[Value], closed: bool) -> Vec<(f64, f64)> {
    let parsed: Vec<Seg> = segs.iter().map(parse_seg).collect();
    let n = parsed.len();
    if n == 0 {
        return vec![];
    }
    let mut pts = vec![parsed[0].anchor];
    let spans = if closed { n } else { n - 1 };
    for i in 0..spans {
        let a = &parsed[i];
        let b = &parsed[(i + 1) % n];
        let p0 = a.anchor;
        let p3 = b.anchor;
        let p1 = (p0.0 + a.handle_out.0, p0.1 + a.handle_out.1);
        let p2 = (p3.0 + b.handle_in.0, p3.1 + b.handle_in.1);
        if a.handle_out == (0.0, 0.0) && b.handle_in == (0.0, 0.0) {
            pts.push(p3); // straight edge
        } else {
            const STEPS: usize = 24;
            for s in 1..=STEPS {
                let t = s as f64 / STEPS as f64;
                pts.push(cubic(p0, p1, p2, p3, t));
            }
        }
    }
    // A closed path's last sample lands back on the start; drop the duplicate.
    if closed && pts.len() > 1 {
        let first = pts[0];
        let last = *pts.last().unwrap();
        if (first.0 - last.0).abs() < 1e-6 && (first.1 - last.1).abs() < 1e-6 {
            pts.pop();
        }
    }
    pts
}

fn cubic(p0: (f64, f64), p1: (f64, f64), p2: (f64, f64), p3: (f64, f64), t: f64) -> (f64, f64) {
    let u = 1.0 - t;
    let (uu, tt) = (u * u, t * t);
    let (a, b, c, d) = (uu * u, 3.0 * uu * t, 3.0 * u * tt, tt * t);
    (
        a * p0.0 + b * p1.0 + c * p2.0 + d * p3.0,
        a * p0.1 + b * p1.1 + c * p2.1 + d * p3.1,
    )
}
