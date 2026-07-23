//! Parse a `.wick` document (zip + `project.json`) into flat, filled contours
//! ready to become SWF shapes.
//!
//! Phase 1 scope: static shapes, fills only, a single main timeline (no nested
//! clips yet). Curves are flattened to polylines; the format details were
//! ground-truthed against a real save (see HANDOFF.md "Known gaps #1"):
//! `objects` is a flat UUID-keyed map, parents reference children by UUID, and
//! `Selection` objects are editor UI state to skip.

use anyhow::{Context, Result, anyhow};
use serde_json::Value;
use std::io::{Cursor, Read};
use swf::Color;

/// A parsed document: stage size (pixels) plus the timeline's layers.
pub struct Document {
    pub width: f64,
    pub height: f64,
    /// Layers in Wick order — index 0 is frontmost (depth is resolved at compile).
    pub layers: Vec<Layer>,
}

/// One timeline layer: a sequence of keyframes.
pub struct Layer {
    pub frames: Vec<Frame>,
}

/// One keyframe, occupying frame numbers `start..=end` (1-indexed), holding shapes.
pub struct Frame {
    pub start: u16,
    pub end: u16,
    pub contours: Vec<Contour>,
}

/// One closed contour with a solid fill, in absolute stage pixels (y-down).
pub struct Contour {
    /// Polyline vertices; the contour closes from the last back to the first.
    pub points: Vec<(f64, f64)>,
    pub fill: Color,
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

    let objects = root
        .get("objects")
        .and_then(Value::as_object)
        .ok_or_else(|| anyhow!("no objects map"))?;

    // This fixture has a single main Timeline (nested clips are a later phase).
    let timeline = objects
        .values()
        .find(|v| classname(v) == Some("Timeline"))
        .ok_or_else(|| anyhow!("no Timeline object"))?;

    // Keep Wick layer order (index 0 = frontmost); depth is resolved at compile.
    let mut layers = Vec::new();
    for layer_uuid in children(timeline) {
        let Some(layer_obj) = objects.get(&layer_uuid) else {
            continue;
        };
        let mut frames = Vec::new();
        for frame_uuid in children(layer_obj) {
            let Some(frame_obj) = objects.get(&frame_uuid) else {
                continue;
            };
            let start = frame_obj
                .get("start")
                .and_then(Value::as_u64)
                .unwrap_or(1) as u16;
            let end = frame_obj
                .get("end")
                .and_then(Value::as_u64)
                .unwrap_or(u64::from(start)) as u16;
            let mut contours = Vec::new();
            for child_uuid in children(frame_obj) {
                let Some(child) = objects.get(&child_uuid) else {
                    continue;
                };
                if classname(child) == Some("Path")
                    && let Some(contour) = path_to_contour(child)?
                {
                    contours.push(contour);
                }
            }
            frames.push(Frame {
                start,
                end,
                contours,
            });
        }
        layers.push(Layer { frames });
    }

    Ok(Document {
        width,
        height,
        layers,
    })
}

fn path_to_contour(path: &Value) -> Result<Option<Contour>> {
    // Path.json = ["Path", { segments, closed, fillColor, ... }] (raw paper.js exportJSON).
    let json = path
        .get("json")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("Path.json not an array"))?;
    if json.first().and_then(Value::as_str) != Some("Path") {
        return Ok(None); // CompoundPath / Raster / PointText — later phases
    }
    let props = json
        .get(1)
        .and_then(Value::as_object)
        .ok_or_else(|| anyhow!("Path props missing"))?;

    let fill = match props.get("fillColor") {
        Some(v) => parse_color(v),
        None => return Ok(None), // stroke-only path — fills come first
    };
    let segs = props
        .get("segments")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("Path has no segments"))?;
    let closed = props
        .get("closed")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    let points = flatten_segments(segs, closed);
    if points.len() < 3 {
        return Ok(None);
    }
    Ok(Some(Contour { points, fill }))
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
