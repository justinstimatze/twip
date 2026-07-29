//! Parse a `.wick` document (zip + `project.json`) into flat contours
//! (fill and/or stroke) ready to become SWF shapes.
//!
//! Scope: static shapes (fills and strokes) plus nested clips (recursive timelines).
//! Curves are flattened to polylines; the format details were ground-truthed
//! against a real save (see HANDOFF.md "Known gaps #1"): `objects` is a flat
//! UUID-keyed map, parents reference children by UUID, and `Selection` objects
//! are editor UI state to skip. The walk is root-down (project -> root Clip ->
//! Timeline -> ...) so multiple timelines (one per clip) resolve correctly.

use anyhow::{Context, Result, anyhow};
use serde_json::Value;
use std::io::{Cursor, Read};
use swf::Color;

/// A parsed document: stage size (pixels), playback rate, and the timeline's layers.
pub struct Document {
    pub width: f64,
    pub height: f64,
    /// Frames per second, straight from the project. The SWF header carries this, so getting
    /// it wrong plays the whole movie at the wrong speed while every frame is still correct.
    pub framerate: f64,
    /// Layers in Wick order — index 0 is frontmost (depth is resolved at compile).
    pub layers: Vec<Layer>,
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
    /// Captured now; only linear is applied until the easing table lands (item 6).
    pub easing: String,
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

    let layers = parse_timeline(timeline, objects)?;
    Ok(Document {
        width,
        height,
        framerate,
        layers,
    })
}

type Objects = serde_json::Map<String, Value>;

/// Resolve an object's `children` UUIDs to the objects they name (missing ones dropped).
fn child_objects<'a>(v: &Value, objects: &'a Objects) -> impl Iterator<Item = &'a Value> {
    children(v)
        .into_iter()
        .filter_map(move |uuid| objects.get(&uuid))
}

/// Parse a Timeline object into its layers (Wick order; index 0 = frontmost).
fn parse_timeline(timeline: &Value, objects: &Objects) -> Result<Vec<Layer>> {
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
            for child in child_objects(frame_obj, objects) {
                match classname(child) {
                    Some("Path") => {
                        if let Some(contour) = path_to_contour(child)? {
                            contours.push(contour);
                        }
                    }
                    // Button is a Clip subclass; its extra state (states, script) is
                    // ignored for now — it still renders as its clip timeline.
                    Some("Clip" | "Button") => clips.push(parse_clip(child, objects)?),
                    Some("Tween") => tweens.push(parse_tween(child)),
                    _ => {}
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
fn parse_clip(clip: &Value, objects: &Objects) -> Result<Clip> {
    let transform = parse_transform(clip);
    let timeline = child_objects(clip, objects)
        .find(|v| classname(v) == Some("Timeline"))
        .ok_or_else(|| anyhow!("Clip has no Timeline"))?;
    let layers = parse_timeline(timeline, objects)?;
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
    }
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

fn path_to_contour(path: &Value) -> Result<Option<Contour>> {
    // Path.json = [class, props] (raw paper.js exportJSON). class is "Path" for a
    // single path or "CompoundPath" for a brush stroke with holes; Raster/PointText
    // are later phases.
    let json = path
        .get("json")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("Path.json not an array"))?;
    let props = json
        .get(1)
        .and_then(Value::as_object)
        .ok_or_else(|| anyhow!("Path props missing"))?;
    match json.first().and_then(Value::as_str) {
        Some("Path") => single_path_to_contour(props),
        Some("CompoundPath") => compound_to_contour(props),
        _ => Ok(None),
    }
}

fn single_path_to_contour(props: &serde_json::Map<String, Value>) -> Result<Option<Contour>> {
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
    let fill = props
        .get("fillColor")
        .map(parse_color)
        .filter(|_| points.len() >= 3);
    let stroke = parse_stroke(props).filter(|_| points.len() >= 2);
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
fn compound_to_contour(props: &serde_json::Map<String, Value>) -> Result<Option<Contour>> {
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
    let fill = props.get("fillColor").map(parse_color);
    let stroke = parse_stroke(props);
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
fn parse_stroke(props: &serde_json::Map<String, Value>) -> Option<Stroke> {
    let color = props.get("strokeColor").map(parse_color)?;
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

/// paper.js colors are `[r,g,b]`/`[r,g,b,a]` floats in 0..1, or a hex string.
fn parse_color(v: &Value) -> Color {
    if let Some(arr) = v.as_array() {
        let ch = |i: usize| {
            arr.get(i)
                .and_then(Value::as_f64)
                .map(|f| (f * 255.0).round().clamp(0.0, 255.0) as u8)
        };
        let r = ch(0).unwrap_or(0);
        let g = ch(1).unwrap_or(0);
        let b = ch(2).unwrap_or(0);
        let a = ch(3).unwrap_or(255);
        Color::from_rgb((u32::from(r) << 16) | (u32::from(g) << 8) | u32::from(b), a)
    } else if let Some(s) = v.as_str() {
        let hex = u32::from_str_radix(s.trim_start_matches('#'), 16).unwrap_or(0);
        Color::from_rgb(hex, 255)
    } else {
        Color::from_rgb(0, 255)
    }
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
