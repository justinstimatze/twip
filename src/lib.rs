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
    Color, ColorTransform, Compression, FillStyle, Fixed8, Fixed16, Header, Matrix, PlaceObject,
    PlaceObjectAction, Point, PointDelta, Rectangle, Shape, ShapeFlag, ShapeRecord, ShapeStyles,
    StyleChangeData, Tag, Twips, write_swf,
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

/// An affine transform plus opacity — the interpolable state of a Wick clip.
#[derive(Clone, Copy)]
pub struct Transform {
    pub x: f64,
    pub y: f64,
    pub scale_x: f64,
    pub scale_y: f64,
    pub rotation_deg: f64,
    pub opacity: f64,
}

impl Transform {
    /// The SWF matrix for this transform (scale, then rotation, then translation).
    pub fn matrix(&self) -> Matrix {
        let r = self.rotation_deg.to_radians();
        Matrix {
            a: Fixed16::from_f64(self.scale_x * r.cos()),
            b: Fixed16::from_f64(self.scale_x * r.sin()),
            c: Fixed16::from_f64(-self.scale_y * r.sin()),
            d: Fixed16::from_f64(self.scale_y * r.cos()),
            tx: Twips::from_pixels(self.x),
            ty: Twips::from_pixels(self.y),
        }
    }

    /// A CXFORM that multiplies alpha by this transform's opacity.
    pub fn color_transform(&self) -> ColorTransform {
        ColorTransform {
            r_multiply: Fixed8::ONE,
            g_multiply: Fixed8::ONE,
            b_multiply: Fixed8::ONE,
            a_multiply: Fixed8::from_f64(self.opacity),
            r_add: 0,
            g_add: 0,
            b_add: 0,
            a_add: 0,
        }
    }
}

/// Per-property linear interpolation between two transforms — Wick's default lerp.
/// Fidelity to the 27 Wick easing functions is deferred until a real tween fixture.
pub fn lerp_transform(a: &Transform, b: &Transform, t: f64) -> Transform {
    let l = |from: f64, to: f64| from + (to - from) * t;
    Transform {
        x: l(a.x, b.x),
        y: l(a.y, b.y),
        scale_x: l(a.scale_x, b.scale_x),
        scale_y: l(a.scale_y, b.scale_y),
        rotation_deg: l(a.rotation_deg, b.rotation_deg),
        opacity: l(a.opacity, b.opacity),
    }
}

/// A `PlaceObject` carrying a full transform: matrix plus an opacity CXFORM.
fn place_transformed(action: PlaceObjectAction, transform: &Transform, depth: u16) -> Tag<'static> {
    Tag::PlaceObject(Box::new(PlaceObject {
        version: 2,
        action,
        depth,
        matrix: Some(transform.matrix()),
        color_transform: Some(transform.color_transform()),
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

/// Phase 1c demo: bake a motion tween (slide + scale + rotate + fade) onto a
/// centered square, ping-ponging so the loop is seamless. No `.wick` parsing —
/// this verifies the matrix + CXFORM interpolation renders smoothly in Ruffle.
pub fn tween_demo_swf() -> Vec<u8> {
    const FRAMES: u16 = 48;
    let contour = wick::Contour {
        points: vec![(-20.0, -20.0), (20.0, -20.0), (20.0, 20.0), (-20.0, 20.0)],
        fill: Color::from_rgb(0xff3030, 255),
    };
    let mut tags: Vec<Tag> = vec![Tag::DefineShape(Box::new(contour_to_shape(1, &contour)))];

    let start = Transform {
        x: 90.0,
        y: 200.0,
        scale_x: 1.0,
        scale_y: 1.0,
        rotation_deg: 0.0,
        opacity: 1.0,
    };
    let end = Transform {
        x: 430.0,
        y: 200.0,
        scale_x: 2.5,
        scale_y: 2.5,
        rotation_deg: 360.0,
        opacity: 0.15,
    };

    for i in 0..FRAMES {
        let phase = f64::from(i) / f64::from(FRAMES);
        let t = 1.0 - (1.0 - 2.0 * phase).abs(); // triangle 0->1->0, seamless loop
        let transform = lerp_transform(&start, &end, t);
        let action = if i == 0 {
            PlaceObjectAction::Place(1)
        } else {
            PlaceObjectAction::Modify
        };
        tags.push(place_transformed(action, &transform, 1));
        tags.push(Tag::ShowFrame);
    }

    let header = Header {
        compression: Compression::None,
        version: 8,
        stage_size: Rectangle {
            x_min: Twips::ZERO,
            x_max: Twips::from_pixels(550.0),
            y_min: Twips::ZERO,
            y_max: Twips::from_pixels(400.0),
        },
        frame_rate: Fixed8::from_f64(24.0),
        num_frames: FRAMES,
    };
    let mut out = Vec::new();
    write_swf(&header, &tags, &mut out).expect("write tween demo");
    out
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

/// One thing to place at a depth: a character id with the matrix + optional opacity
/// CXFORM to place it with. Loose shapes use identity + no cxform; clips carry their
/// own transform.
#[derive(Clone)]
struct Placement {
    id: u16,
    matrix: Matrix,
    cxform: Option<ColorTransform>,
}

/// A `PlaceObject` from a [`Placement`].
fn place_placement(action: PlaceObjectAction, p: &Placement, depth: u16) -> Tag<'static> {
    Tag::PlaceObject(Box::new(PlaceObject {
        version: 2,
        action,
        depth,
        matrix: Some(p.matrix),
        color_transform: p.cxform,
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

/// Compile a timeline (a list of layers) into its control-tag stream (Place/Remove/
/// ShowFrame), pushing any shape/sprite DEFINITIONS onto the shared `defs` list in
/// dependency order (children before the DefineSprite that uses them). Recurses for
/// nested clips. SWF requires all DefineShape/DefineSprite tags at the root, before
/// use — post-order recursion gives exactly that ordering.
fn compile_timeline(
    layers: &[wick::Layer],
    next_id: &mut u16,
    defs: &mut Vec<Tag<'static>>,
) -> Vec<Tag<'static>> {
    let num_layers = layers.len();

    // Per (layer, frame): the ordered placements that frame wants live. Building this
    // first also emits the definitions (shapes now, sprites via recursion).
    let mut slots: Vec<Vec<Vec<Placement>>> = Vec::with_capacity(num_layers);
    for layer in layers {
        let mut layer_slots = Vec::with_capacity(layer.frames.len());
        for frame in &layer.frames {
            let mut placements = Vec::new();
            for contour in &frame.contours {
                let id = *next_id;
                *next_id += 1;
                defs.push(Tag::DefineShape(Box::new(contour_to_shape(id, contour))));
                placements.push(Placement {
                    id,
                    matrix: Matrix::IDENTITY,
                    cxform: None,
                });
            }
            for clip in &frame.clips {
                let body = compile_timeline(&clip.layers, next_id, defs);
                let num_frames = body
                    .iter()
                    .filter(|t| matches!(t, Tag::ShowFrame))
                    .count() as u16;
                let id = *next_id;
                *next_id += 1;
                defs.push(Tag::DefineSprite(swf::Sprite {
                    id,
                    num_frames: num_frames.max(1),
                    tags: body,
                }));
                placements.push(Placement {
                    id,
                    matrix: clip.transform.matrix(),
                    cxform: Some(clip.transform.color_transform()),
                });
            }
            layer_slots.push(placements);
        }
        slots.push(layer_slots);
    }

    let total: u16 = layers
        .iter()
        .flat_map(|l| l.frames.iter())
        .map(|f| f.end)
        .max()
        .unwrap_or(1)
        .max(1);

    // Front layer (li=0) must land above the back layers.
    let depth_base = |li: usize| -> u16 { (num_layers - li) as u16 * DEPTH_BAND };

    // Walk the playhead, emitting place/remove deltas against the display list.
    let mut control: Vec<Tag<'static>> = Vec::new();
    let mut current: BTreeMap<u16, Placement> = BTreeMap::new(); // depth -> placement
    for frame_no in 1..=total {
        let mut desired: BTreeMap<u16, Placement> = BTreeMap::new();
        for (li, layer) in layers.iter().enumerate() {
            if let Some(fi) = layer
                .frames
                .iter()
                .position(|fr| fr.start <= frame_no && frame_no <= fr.end)
            {
                let base = depth_base(li);
                for (ci, placement) in slots[li][fi].iter().enumerate() {
                    desired.insert(base + ci as u16 + 1, placement.clone());
                }
            }
        }
        // Remove characters whose depth is now empty or holds a different id.
        for (&depth, cur) in &current {
            if desired.get(&depth).map(|d| d.id) != Some(cur.id) {
                control.push(Tag::RemoveObject(swf::RemoveObject {
                    depth,
                    character_id: None,
                }));
            }
        }
        // Place new or changed characters (removes above already cleared the slot).
        for (&depth, placement) in &desired {
            if current.get(&depth).map(|c| c.id) != Some(placement.id) {
                control.push(place_placement(
                    PlaceObjectAction::Place(placement.id),
                    placement,
                    depth,
                ));
            }
        }
        control.push(Tag::ShowFrame);
        current = desired;
    }
    control
}

/// Compile a parsed document into an SWF timeline (frame-by-frame, with nested clips).
pub fn compile_document(doc: &wick::Document) -> Result<Vec<u8>> {
    let mut next_id: u16 = 1;
    let mut tags: Vec<Tag> = Vec::new();
    let control = compile_timeline(&doc.layers, &mut next_id, &mut tags);
    let total: u16 = control
        .iter()
        .filter(|t| matches!(t, Tag::ShowFrame))
        .count()
        .try_into()
        .unwrap_or(u16::MAX);
    tags.extend(control);

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
        num_frames: total.max(1),
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

    /// Phase 1b parser: a real frame-by-frame `.wick` (3 keyframes over 12 playhead
    /// positions, one layer) drawn in wickeditor.com and exported by the engine.
    #[test]
    fn compiles_frame_by_frame_wick() {
        let bytes = include_bytes!("../fixtures/frame-by-frame.wick");
        let swf = compile_wick(bytes).expect("compile frame-by-frame.wick");
        let buf = swf::decompress_swf(&swf[..]).expect("decompress");
        let parsed = swf::parse_swf(&buf).expect("parse");
        let count = |f: &dyn Fn(&Tag) -> bool| parsed.tags.iter().filter(|t| f(t)).count();

        assert_eq!(
            count(&|t| matches!(t, Tag::DefineShape(_))),
            3,
            "one rect per keyframe"
        );
        assert_eq!(
            count(&|t| matches!(t, Tag::ShowFrame)),
            12,
            "playhead spans frames 1..=12"
        );
        assert_eq!(
            count(&|t| matches!(t, Tag::PlaceObject(_))),
            3,
            "place at f1, f5, f9"
        );
        assert_eq!(
            count(&|t| matches!(t, Tag::RemoveObject(_))),
            2,
            "remove the outgoing shape at each keyframe boundary"
        );
    }

    /// Phase 1 depth mapping: a real two-layer `.wick`. Wick layer index 0 is frontmost,
    /// which must map to the HIGHER SWF depth band (higher depth = drawn on top).
    #[test]
    fn compiles_multi_layer_wick() {
        let bytes = include_bytes!("../fixtures/multi-layer.wick");
        let swf = compile_wick(bytes).expect("compile multi-layer.wick");
        let buf = swf::decompress_swf(&swf[..]).expect("decompress");
        let parsed = swf::parse_swf(&buf).expect("parse");

        let mut depths: Vec<u16> = parsed
            .tags
            .iter()
            .filter_map(|t| match t {
                Tag::PlaceObject(po) => Some(po.depth),
                _ => None,
            })
            .collect();
        depths.sort_unstable();
        // Two layers, one shape each: back layer at band 1, front layer at band 2.
        assert_eq!(
            depths,
            vec![DEPTH_BAND + 1, 2 * DEPTH_BAND + 1],
            "front Wick layer (index 0) placed in the higher depth band"
        );
    }

    /// Phase 1d parser: a real nested-clip `.wick` (a clip placed on the root frame,
    /// the clip's OWN timeline a 2-keyframe animation) drawn in wickeditor.com. Two
    /// Timelines and two Clips in the JSON; the root Clip becomes the document, the
    /// nested one a DefineSprite.
    #[test]
    fn compiles_nested_clip_wick() {
        let bytes = include_bytes!("../fixtures/nested-clip.wick");
        let swf = compile_wick(bytes).expect("compile nested-clip.wick");
        let buf = swf::decompress_swf(&swf[..]).expect("decompress");
        let parsed = swf::parse_swf(&buf).expect("parse");

        let sprites: Vec<&swf::Sprite> = parsed
            .tags
            .iter()
            .filter_map(|t| match t {
                Tag::DefineSprite(s) => Some(s),
                _ => None,
            })
            .collect();
        assert_eq!(sprites.len(), 1, "the nested clip -> one DefineSprite");
        assert_eq!(sprites[0].num_frames, 2, "clip's own 2-keyframe timeline");

        // Both nested shapes hoist to the root as DefineShape.
        assert_eq!(
            parsed
                .tags
                .iter()
                .filter(|t| matches!(t, Tag::DefineShape(_)))
                .count(),
            2,
            "both nested shapes defined at the root"
        );

        // The root is a single frame that places the sprite once, at the clip's (200, 150).
        assert_eq!(parsed.header.num_frames(), 1, "root is one frame");
        let root_places: Vec<&PlaceObject> = parsed
            .tags
            .iter()
            .filter_map(|t| match t {
                Tag::PlaceObject(po) => Some(po.as_ref()),
                _ => None,
            })
            .collect();
        assert_eq!(root_places.len(), 1, "root places the sprite once");
        let m = root_places[0].matrix.expect("placement has a matrix");
        assert_eq!(m.tx.get(), Twips::from_pixels(200.0).get(), "clip x -> tx");
        assert_eq!(m.ty.get(), Twips::from_pixels(150.0).get(), "clip y -> ty");
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
                        clips: vec![],
                    },
                    Frame {
                        start: 2,
                        end: 2,
                        contours: vec![triangle(50.0)],
                        clips: vec![],
                    },
                ],
            }],
        };

        let swf = compile_document(&doc).expect("compile document");
        let buf = swf::decompress_swf(&swf[..]).expect("decompress");
        let parsed = swf::parse_swf(&buf).expect("parse");

        let count = |f: &dyn Fn(&Tag) -> bool| parsed.tags.iter().filter(|t| f(t)).count();
        assert_eq!(
            count(&|t| matches!(t, Tag::DefineShape(_))),
            2,
            "two shapes"
        );
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

    /// Phase 1d: a nested clip compiles to a DefineSprite (its own timeline) that the
    /// root places once, carrying the clip's transform. Definitions hoist to the root.
    #[test]
    fn nested_clip_emits_sprite() {
        use wick::{Clip, Contour, Document, Frame, Layer};

        let tri = |x: f64| Contour {
            points: vec![(x, 0.0), (x + 10.0, 0.0), (x + 5.0, 10.0)],
            fill: swf::Color::from_rgb(0x00ff00, 255),
        };
        // A clip whose OWN timeline is a 2-keyframe animation, placed at (100, 50).
        let clip = Clip {
            transform: Transform {
                x: 100.0,
                y: 50.0,
                scale_x: 1.0,
                scale_y: 1.0,
                rotation_deg: 0.0,
                opacity: 1.0,
            },
            layers: vec![Layer {
                frames: vec![
                    Frame {
                        start: 1,
                        end: 1,
                        contours: vec![tri(0.0)],
                        clips: vec![],
                    },
                    Frame {
                        start: 2,
                        end: 2,
                        contours: vec![tri(20.0)],
                        clips: vec![],
                    },
                ],
            }],
        };
        let doc = Document {
            width: 200.0,
            height: 200.0,
            layers: vec![Layer {
                frames: vec![Frame {
                    start: 1,
                    end: 1,
                    contours: vec![],
                    clips: vec![clip],
                }],
            }],
        };

        let swf = compile_document(&doc).expect("compile nested clip");
        let buf = swf::decompress_swf(&swf[..]).expect("decompress");
        let parsed = swf::parse_swf(&buf).expect("parse");

        let sprites: Vec<&swf::Sprite> = parsed
            .tags
            .iter()
            .filter_map(|t| match t {
                Tag::DefineSprite(s) => Some(s),
                _ => None,
            })
            .collect();
        assert_eq!(sprites.len(), 1, "one clip -> one DefineSprite");
        assert_eq!(sprites[0].num_frames, 2, "the sprite's own 2-keyframe timeline");
        // The sprite body is the nested control stream: 2 shapes' worth of places + 2 ShowFrames.
        let inner_shows = sprites[0]
            .tags
            .iter()
            .filter(|t| matches!(t, Tag::ShowFrame))
            .count();
        assert_eq!(inner_shows, 2, "sprite timeline shows two frames");

        // Definitions hoist to the root; both nested shapes are DefineShape at top level.
        assert_eq!(
            parsed
                .tags
                .iter()
                .filter(|t| matches!(t, Tag::DefineShape(_)))
                .count(),
            2,
            "both nested shapes defined at the root"
        );

        // The root places the sprite once, with the clip's translation (100px -> 2000 twips).
        let root_places: Vec<&PlaceObject> = parsed
            .tags
            .iter()
            .filter_map(|t| match t {
                Tag::PlaceObject(po) => Some(po.as_ref()),
                _ => None,
            })
            .collect();
        assert_eq!(root_places.len(), 1, "root places the sprite once");
        let m = root_places[0].matrix.expect("placement has a matrix");
        assert_eq!(m.tx.get(), Twips::from_pixels(100.0).get(), "clip x -> tx");
        assert_eq!(m.ty.get(), Twips::from_pixels(50.0).get(), "clip y -> ty");
        assert_eq!(parsed.header.num_frames(), 1, "root timeline is one frame");
    }

    /// Phase 1c: lerp is per-property linear.
    #[test]
    fn lerp_midpoint() {
        let a = Transform {
            x: 0.0,
            y: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
            rotation_deg: 0.0,
            opacity: 1.0,
        };
        let b = Transform {
            x: 100.0,
            y: 0.0,
            scale_x: 3.0,
            scale_y: 3.0,
            rotation_deg: 180.0,
            opacity: 0.0,
        };
        let m = lerp_transform(&a, &b, 0.5);
        assert!((m.x - 50.0).abs() < 1e-9);
        assert!((m.scale_x - 2.0).abs() < 1e-9);
        assert!((m.rotation_deg - 90.0).abs() < 1e-9);
        assert!((m.opacity - 0.5).abs() < 1e-9);
    }

    /// Phase 1c: the baked tween places a matrix + CXFORM on every frame.
    #[test]
    fn tween_demo_has_matrix_and_cxform() {
        let data = tween_demo_swf();
        let buf = swf::decompress_swf(&data[..]).expect("decompress");
        let parsed = swf::parse_swf(&buf).expect("parse");

        let show_frames = parsed
            .tags
            .iter()
            .filter(|t| matches!(t, Tag::ShowFrame))
            .count();
        assert_eq!(show_frames, 48, "48 baked frames");

        let place = parsed
            .tags
            .iter()
            .find_map(|t| match t {
                Tag::PlaceObject(p) => Some(p),
                _ => None,
            })
            .expect("a PlaceObject");
        assert!(place.matrix.is_some(), "carries a transform matrix");
        assert!(place.color_transform.is_some(), "carries an opacity CXFORM");
    }
}
