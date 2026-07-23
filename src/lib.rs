//! twip — a compiler from Wick (`.wick`) documents to SWF.
//!
//! Phase 0 (hello-square): no `.wick` parsing yet. This hand-builds a single
//! red square that tweens across the stage, emits real SWF via the `swf` crate,
//! and is structurally round-trip tested (parse the bytes back, assert the tag
//! shape — the "structural oracle" layer from HANDOFF.md). Visual truth is
//! Ruffle rendering the same bytes.

pub mod wick;

use anyhow::Result;
use std::collections::BTreeMap;
use swf::{
    Color, Compression, FillStyle, Fixed8, Header, Matrix, PlaceObject, PlaceObjectAction, Point,
    PointDelta, Rectangle, Shape, ShapeFlag, ShapeRecord, ShapeStyles, StyleChangeData, Tag, Twips,
    write_swf,
};
use wick::Contour;

/// Returns the crate version.
pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

const STAGE_W: f64 = 550.0;
const STAGE_H: f64 = 400.0;
const SIDE: f64 = 40.0;
// Enough frames that each step is small (~10px) — 24 looked choppy. Ping-pong (below) also
// keeps the loop seamless, so no hard snap-back.
const FRAMES: u16 = 96;
const SQUARE_ID: u16 = 1;
const DEPTH: u16 = 1;

/// A solid red square, `SIDE` pixels, with its top-left at the shape origin.
fn red_square() -> Shape {
    let bounds = Rectangle {
        x_min: Twips::ZERO,
        x_max: Twips::from_pixels(SIDE),
        y_min: Twips::ZERO,
        y_max: Twips::from_pixels(SIDE),
    };
    Shape {
        version: 4, // DefineShape4: RGBA fills + nonzero winding flag (see HANDOFF.md)
        id: SQUARE_ID,
        shape_bounds: bounds,
        edge_bounds: bounds,
        flags: ShapeFlag::NON_ZERO_WINDING_RULE,
        styles: ShapeStyles {
            fill_styles: vec![swf::FillStyle::Color(Color::from_rgb(0xff0000, 255))],
            line_styles: vec![],
        },
        shape: vec![
            ShapeRecord::StyleChange(Box::new(StyleChangeData {
                move_to: Some(Point::from_pixels(0.0, 0.0)),
                fill_style_0: None,
                fill_style_1: Some(1), // 1-based index into fill_styles; fill on the right of the edge
                line_style: None,
                new_styles: None,
            })),
            ShapeRecord::StraightEdge {
                delta: PointDelta::from_pixels(SIDE, 0.0),
            },
            ShapeRecord::StraightEdge {
                delta: PointDelta::from_pixels(0.0, SIDE),
            },
            ShapeRecord::StraightEdge {
                delta: PointDelta::from_pixels(-SIDE, 0.0),
            },
            ShapeRecord::StraightEdge {
                delta: PointDelta::from_pixels(0.0, -SIDE),
            },
        ],
    }
}

/// A minimal `PlaceObject` tag: just an action, depth, and a transform matrix.
fn place(action: PlaceObjectAction, matrix: Matrix, depth: u16) -> Tag<'static> {
    Tag::PlaceObject(Box::new(PlaceObject {
        version: 2,
        action,
        depth,
        matrix: Some(matrix),
        color_transform: None,
        ratio: None,
        name: None,
        clip_depth: None,
        class_name: None,
        filters: None,
        background_color: None,
        blend_mode: None,
        clip_actions: None,
        has_image: false,
        is_bitmap_cached: None,
        is_visible: None,
        amf_data: None,
    }))
}

/// Builds the hello-square SWF and returns the encoded bytes.
pub fn hello_square_swf() -> Vec<u8> {
    let mut tags: Vec<Tag> = vec![Tag::DefineShape(Box::new(red_square()))];

    let y = (STAGE_H - SIDE) / 2.0;
    for i in 0..FRAMES {
        // Seamless ping-pong: a triangle wave over the whole loop (0 -> 1 -> 0), so frame 0
        // and the frame just before the loop both sit near x=0 and the wrap is continuous.
        let t = f64::from(i) / f64::from(FRAMES); // 0.0 ..< 1.0
        let triangle = 1.0 - (1.0 - 2.0 * t).abs(); // 0 at ends, 1 at the midpoint
        let x = triangle * (STAGE_W - SIDE);
        let matrix = Matrix::translate(Twips::from_pixels(x), Twips::from_pixels(y));
        let action = if i == 0 {
            PlaceObjectAction::Place(SQUARE_ID)
        } else {
            PlaceObjectAction::Modify
        };
        tags.push(place(action, matrix, DEPTH));
        tags.push(Tag::ShowFrame);
    }

    let header = Header {
        compression: Compression::None,
        version: 8, // SWF8: PRESS clip events etc. are available later; fine for v0
        stage_size: Rectangle {
            x_min: Twips::ZERO,
            x_max: Twips::from_pixels(STAGE_W),
            y_min: Twips::ZERO,
            y_max: Twips::from_pixels(STAGE_H),
        },
        frame_rate: Fixed8::from_f64(24.0),
        num_frames: FRAMES,
    };

    let mut out = Vec::new();
    write_swf(&header, &tags, &mut out).expect("write_swf into a Vec cannot fail");
    out
}

/// Convert one flattened contour into a filled `DefineShape4`.
fn contour_to_shape(id: u16, contour: &Contour) -> Shape {
    // Absolute pixels -> twips (i32) first, then take deltas, so rounding can't drift.
    let twips: Vec<(i32, i32)> = contour
        .points
        .iter()
        .map(|&(x, y)| (Twips::from_pixels(x).get(), Twips::from_pixels(y).get()))
        .collect();

    let (mut x_min, mut x_max, mut y_min, mut y_max) = (i32::MAX, i32::MIN, i32::MAX, i32::MIN);
    for &(x, y) in &twips {
        x_min = x_min.min(x);
        x_max = x_max.max(x);
        y_min = y_min.min(y);
        y_max = y_max.max(y);
    }
    let bounds = Rectangle {
        x_min: Twips::new(x_min),
        x_max: Twips::new(x_max),
        y_min: Twips::new(y_min),
        y_max: Twips::new(y_max),
    };

    let mut records = vec![ShapeRecord::StyleChange(Box::new(StyleChangeData {
        move_to: Some(Point::new(Twips::new(twips[0].0), Twips::new(twips[0].1))),
        fill_style_0: None,
        fill_style_1: Some(1),
        line_style: None,
        new_styles: None,
    }))];
    for i in 0..twips.len() {
        let (cx, cy) = twips[i];
        let (nx, ny) = twips[(i + 1) % twips.len()]; // last edge closes back to the start
        records.push(ShapeRecord::StraightEdge {
            delta: PointDelta::new(Twips::new(nx - cx), Twips::new(ny - cy)),
        });
    }

    Shape {
        version: 4,
        id,
        shape_bounds: bounds,
        edge_bounds: bounds,
        flags: ShapeFlag::NON_ZERO_WINDING_RULE,
        styles: ShapeStyles {
            fill_styles: vec![FillStyle::Color(contour.fill)],
            line_styles: vec![],
        },
        shape: records,
    }
}

/// Depth band per layer. The front layer (Wick index 0) gets the highest band so
/// it draws on top. v1 assumption: fewer than ~60 layers, fewer than 1000 shapes
/// per layer per frame.
const DEPTH_BAND: u16 = 1000;

/// Compile a parsed document into an SWF timeline (frame-by-frame).
pub fn compile_document(doc: &wick::Document) -> Result<Vec<u8>> {
    let num_layers = doc.layers.len();

    // Give every contour a unique shape id and emit all DefineShapes upfront.
    let mut tags: Vec<Tag> = Vec::new();
    let mut next_id: u16 = 1;
    let mut ids: Vec<Vec<Vec<u16>>> = Vec::with_capacity(num_layers);
    for layer in &doc.layers {
        let mut layer_ids = Vec::with_capacity(layer.frames.len());
        for frame in &layer.frames {
            let mut frame_ids = Vec::with_capacity(frame.contours.len());
            for contour in &frame.contours {
                let id = next_id;
                next_id += 1;
                tags.push(Tag::DefineShape(Box::new(contour_to_shape(id, contour))));
                frame_ids.push(id);
            }
            layer_ids.push(frame_ids);
        }
        ids.push(layer_ids);
    }

    let total: u16 = doc
        .layers
        .iter()
        .flat_map(|l| l.frames.iter())
        .map(|f| f.end)
        .max()
        .unwrap_or(1)
        .max(1);

    // Front layer (li=0) must land above the back layers.
    let depth_base = |li: usize| -> u16 { (num_layers - li) as u16 * DEPTH_BAND };

    // Walk the playhead, emitting place/remove deltas against the display list.
    let mut current: BTreeMap<u16, u16> = BTreeMap::new(); // depth -> character id
    for frame_no in 1..=total {
        let mut desired: BTreeMap<u16, u16> = BTreeMap::new();
        for (li, layer) in doc.layers.iter().enumerate() {
            if let Some(fi) = layer
                .frames
                .iter()
                .position(|fr| fr.start <= frame_no && frame_no <= fr.end)
            {
                let base = depth_base(li);
                for (ci, &id) in ids[li][fi].iter().enumerate() {
                    desired.insert(base + ci as u16 + 1, id);
                }
            }
        }
        // Remove characters whose depth is now empty or holds a different id.
        for (&depth, &cur_id) in &current {
            if desired.get(&depth) != Some(&cur_id) {
                tags.push(Tag::RemoveObject(swf::RemoveObject {
                    depth,
                    character_id: None,
                }));
            }
        }
        // Place new or changed characters (removes above already cleared the slot).
        for (&depth, &id) in &desired {
            if current.get(&depth) != Some(&id) {
                tags.push(place(PlaceObjectAction::Place(id), Matrix::IDENTITY, depth));
            }
        }
        tags.push(Tag::ShowFrame);
        current = desired;
    }

    let header = Header {
        compression: Compression::None,
        version: 8,
        stage_size: Rectangle {
            x_min: Twips::ZERO,
            x_max: Twips::from_pixels(doc.width),
            y_min: Twips::ZERO,
            y_max: Twips::from_pixels(doc.height),
        },
        frame_rate: Fixed8::from_f64(24.0),
        num_frames: total,
    };

    let mut out = Vec::new();
    write_swf(&header, &tags, &mut out)?;
    Ok(out)
}

/// Compile the bytes of a `.wick` file into an SWF.
pub fn compile_wick(wick_bytes: &[u8]) -> Result<Vec<u8>> {
    compile_document(&wick::parse_wick(wick_bytes)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Structural oracle: emit, parse back with the same crate, assert the tag shape.
    #[test]
    fn hello_square_roundtrips() {
        let data = hello_square_swf();
        assert_eq!(&data[..3], b"FWS", "uncompressed SWF signature");

        let buf = swf::decompress_swf(&data[..]).expect("decompress");
        let parsed = swf::parse_swf(&buf).expect("parse");

        let show_frames = parsed
            .tags
            .iter()
            .filter(|t| matches!(t, Tag::ShowFrame))
            .count();
        let define_shapes = parsed
            .tags
            .iter()
            .filter(|t| matches!(t, Tag::DefineShape(_)))
            .count();
        let place_objects = parsed
            .tags
            .iter()
            .filter(|t| matches!(t, Tag::PlaceObject(_)))
            .count();

        assert_eq!(define_shapes, 1, "one shape defined");
        assert_eq!(show_frames, usize::from(FRAMES), "one ShowFrame per frame");
        assert_eq!(
            place_objects,
            usize::from(FRAMES),
            "one PlaceObject per frame (1 Place + rest Modify)"
        );
    }

    /// Phase 1: the real fixture compiles to two placed shapes on one frame.
    #[test]
    fn compiles_test1_wick() {
        let bytes = include_bytes!("../fixtures/test1.wick");
        let swf = compile_wick(bytes).expect("compile test1.wick");

        let buf = swf::decompress_swf(&swf[..]).expect("decompress");
        let parsed = swf::parse_swf(&buf).expect("parse");

        let shapes = parsed
            .tags
            .iter()
            .filter(|t| matches!(t, Tag::DefineShape(_)))
            .count();
        let places = parsed
            .tags
            .iter()
            .filter(|t| matches!(t, Tag::PlaceObject(_)))
            .count();
        let show_frames = parsed
            .tags
            .iter()
            .filter(|t| matches!(t, Tag::ShowFrame))
            .count();

        assert_eq!(shapes, 2, "black ellipse + green rectangle");
        assert_eq!(places, 2, "each shape placed once");
        assert_eq!(show_frames, 1, "single static frame");
    }

    /// Phase 1b: a two-keyframe flipbook removes the old shape and places the new.
    #[test]
    fn frame_by_frame_timeline() {
        use wick::{Contour, Document, Frame, Layer};

        let triangle = |x: f64| Contour {
            points: vec![(x, 0.0), (x + 10.0, 0.0), (x + 5.0, 10.0)],
            fill: swf::Color::from_rgb(0xff0000, 255),
        };
        let doc = Document {
            width: 100.0,
            height: 100.0,
            layers: vec![Layer {
                frames: vec![
                    Frame {
                        start: 1,
                        end: 1,
                        contours: vec![triangle(0.0)],
                    },
                    Frame {
                        start: 2,
                        end: 2,
                        contours: vec![triangle(50.0)],
                    },
                ],
            }],
        };

        let swf = compile_document(&doc).expect("compile document");
        let buf = swf::decompress_swf(&swf[..]).expect("decompress");
        let parsed = swf::parse_swf(&buf).expect("parse");

        let count = |f: &dyn Fn(&Tag) -> bool| parsed.tags.iter().filter(|t| f(t)).count();
        assert_eq!(count(&|t| matches!(t, Tag::DefineShape(_))), 2, "two shapes");
        assert_eq!(count(&|t| matches!(t, Tag::ShowFrame)), 2, "two frames");
        assert_eq!(
            count(&|t| matches!(t, Tag::PlaceObject(_))),
            2,
            "place A on frame 1, B on frame 2"
        );
        assert_eq!(
            count(&|t| matches!(t, Tag::RemoveObject(_))),
            1,
            "remove A when B replaces it at the same depth"
        );
    }
}
