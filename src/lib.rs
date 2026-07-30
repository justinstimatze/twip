//! twip — a compiler from Wick (`.wick`) documents to SWF.
//!
//! Phase 0 (hello-square): no `.wick` parsing yet. This hand-builds a single
//! red square that tweens across the stage, emits real SWF via the `swf` crate,
//! and is structurally round-trip tested (parse the bytes back, assert the tag
//! shape — the "structural oracle" layer from docs/testing.md). Visual truth is
//! Ruffle rendering the same bytes.

pub mod import;
pub mod script;
pub mod wick;

use anyhow::Result;
use std::collections::BTreeMap;
use swf::{
    ClipAction, ClipActions, ClipEventFlag, Color, ColorTransform, Compression, FillStyle, Fixed8,
    Fixed16, Header, LineStyle, Matrix, PlaceObject, PlaceObjectAction, Point, PointDelta,
    Rectangle, Shape, ShapeFlag, ShapeRecord, ShapeStyles, StyleChangeData, Tag, Twips, write_swf,
};
use wick::{Contour, Script};

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
        version: 4, // DefineShape4: RGBA fills + nonzero winding flag (see docs/wick-format.md)
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
    /// Signed skew in degrees: the extra angle the y-axis is rotated by, on top of
    /// `rotation_deg`. Zero for every transform the upstream editor writes.
    pub skew_deg: f64,
    pub opacity: f64,
}

impl Transform {
    /// The SWF matrix for this transform (scale, then rotation, then translation).
    ///
    /// Skew rotates the y basis vector by `rotation + skew` while x stays at `rotation`
    /// — the fork's own `Transformation.toMatrix()` (engine/src/Transformation.js:102),
    /// which is what its renderer feeds paper.js. At `skew_deg == 0` the two axes share
    /// an angle and this collapses to a plain scale+rotate.
    pub fn matrix(&self) -> Matrix {
        let rx = self.rotation_deg.to_radians();
        let ry = (self.rotation_deg + self.skew_deg).to_radians();
        Matrix {
            a: Fixed16::from_f64(self.scale_x * rx.cos()),
            b: Fixed16::from_f64(self.scale_x * rx.sin()),
            c: Fixed16::from_f64(-self.scale_y * ry.sin()),
            d: Fixed16::from_f64(self.scale_y * ry.cos()),
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
        skew_deg: l(a.skew_deg, b.skew_deg),
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
        holes: vec![],
        closed: true,
        fill: Some(wick::Fill::Solid(Color::from_rgb(0xff3030, 255))),
        stroke: None,
    };
    let mut tags: Vec<Tag> = vec![Tag::DefineShape(Box::new(contour_to_shape(1, &contour)))];

    let start = Transform {
        x: 90.0,
        y: 200.0,
        scale_x: 1.0,
        scale_y: 1.0,
        rotation_deg: 0.0,
        skew_deg: 0.0,
        opacity: 1.0,
    };
    let end = Transform {
        x: 430.0,
        y: 200.0,
        scale_x: 2.5,
        scale_y: 2.5,
        rotation_deg: 360.0,
        skew_deg: 0.0,
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

/// How many colour stops a `DefineShape4` gradient can hold (SWF19 p.136: NumGradients is 1
/// to 15). The older shape tags stop at 8; twip emits `DefineShape4`, so this is the number.
pub const MAX_GRADIENT_STOPS: usize = 15;

/// Half the side of SWF's gradient square, in twips.
///
/// Every gradient in the format is stated over one fixed box — 32768 twips on a side, centred
/// on the origin — and a matrix maps that box onto the shape. A linear ramp runs along x from
/// `-GRADIENT_HALF` to `+GRADIENT_HALF`; a radial one is a circle of radius `GRADIENT_HALF`
/// about the centre. Nothing about a shape's own coordinates appears in a gradient record;
/// the matrix carries all of it. SWF19 p.135.
const GRADIENT_HALF: f64 = 16384.0;

/// Map SWF's gradient square onto the two points paper.js states a gradient with.
///
/// The two points mean different things per kind, which is the whole of the difference here.
/// For a linear gradient they are the ends of the ramp, so the square's x axis has to land on
/// the segment from one to the other: rotate to the segment's angle, scale so the square's
/// full width covers its length, and translate to its midpoint. For a radial gradient the
/// origin is the centre and the destination is a point on the circle, so there is no rotation
/// to apply — scale the unit circle to the radius and translate to the centre.
///
/// The y scale is set equal to the x scale rather than left at 1. It is invisible for a linear
/// gradient, whose ramp ignores y entirely, but a degenerate y would make the matrix
/// non-invertible, and a player that inverts it to sample the ramp gets nothing.
fn gradient_matrix(g: &wick::Gradient) -> Matrix {
    let (ox, oy) = g.origin;
    let (dx, dy) = g.destination;
    let (vx, vy) = (dx - ox, dy - oy);
    let length = vx.hypot(vy);

    // A zero-length gradient has no direction to point and no size to scale to. Paint it as a
    // hairline rather than dividing by zero — the ramp collapses to its last stop, which is
    // what a player shows for a degenerate gradient anyway.
    let length = if length < f64::EPSILON { 1.0 } else { length };

    let spin = |cos: f64, sin: f64, scale: f64, tx: f64, ty: f64| Matrix {
        a: Fixed16::from_f64(cos * scale),
        b: Fixed16::from_f64(sin * scale),
        c: Fixed16::from_f64(-sin * scale),
        d: Fixed16::from_f64(cos * scale),
        tx: Twips::from_pixels(tx),
        ty: Twips::from_pixels(ty),
    };

    if g.radial {
        let scale = Twips::from_pixels(length).get() as f64 / GRADIENT_HALF;
        // A circle is the same in every orientation, so a radial gradient would not need one
        // — except that SWF states a focal point along the gradient square's *x axis* and
        // nowhere else. Aiming x at the highlight is what lets the bright spot land where the
        // author put it rather than somewhere off to the stage's right.
        let (cos, sin) = match g.highlight {
            Some((hx, hy)) if (hx - ox).hypot(hy - oy) > f64::EPSILON => {
                let (fx, fy) = (hx - ox, hy - oy);
                let d = fx.hypot(fy);
                (fx / d, fy / d)
            }
            _ => (1.0, 0.0),
        };
        return spin(cos, sin, scale, ox, oy);
    }

    // Linear: the square's full width (2 * GRADIENT_HALF) spans the ramp, and its x axis runs
    // from origin to destination.
    let scale = Twips::from_pixels(length).get() as f64 / (2.0 * GRADIENT_HALF);
    spin(
        vx / length,
        vy / length,
        scale,
        (ox + dx) / 2.0,
        (oy + dy) / 2.0,
    )
}

/// A paper.js gradient as a SWF fill style.
///
/// Both spread and interpolation are the defaults the older shape tags require anyway (SWF19
/// p.135: for DefineShape/2/3 they *must* be 0), and paper.js has no concept matching either —
/// its ramps pad, which is `Pad`.
///
/// A radial gradient whose highlight is off-centre becomes a `FocalGradient`. SWF states the
/// focal point as a fraction of the radius along the gradient square's x axis, in [-1, 1], so
/// only the component along the ramp direction survives — an off-axis highlight is projected
/// onto it rather than dropped, since projecting keeps the bright spot on the side the author
/// put it.
fn fill_to_style(fill: &wick::Fill) -> FillStyle {
    use swf::{GradientInterpolation, GradientRecord, GradientSpread};

    let g = match fill {
        wick::Fill::Solid(color) => return FillStyle::Color(*color),
        wick::Fill::Gradient(g) => g,
    };

    let mut stops: Vec<_> = g.stops.clone();
    stops.sort_by(|a, b| a.0.total_cmp(&b.0));
    let gradient = swf::Gradient {
        matrix: gradient_matrix(g),
        spread: GradientSpread::Pad,
        interpolation: GradientInterpolation::Rgb,
        records: stops
            .iter()
            // Extra stops beyond the format's ceiling are reported by the reader.
            .take(MAX_GRADIENT_STOPS)
            .map(|&(offset, color)| GradientRecord {
                ratio: (offset.clamp(0.0, 1.0) * 255.0).round() as u8,
                color,
            })
            .collect(),
    };

    if !g.radial {
        return FillStyle::LinearGradient(gradient);
    }
    let Some((hx, hy)) = g.highlight else {
        return FillStyle::RadialGradient(gradient);
    };

    let (ox, oy) = g.origin;
    let radius = (g.destination.0 - ox).hypot(g.destination.1 - oy);
    if radius < f64::EPSILON {
        return FillStyle::RadialGradient(gradient);
    }
    // `gradient_matrix` has already aimed the square's x axis at the highlight, so what is
    // left to say is how far along it sits, as a fraction of the radius. Ruffle's own shader
    // reads it that way: it remaps the square to [-1, 1] and offsets from `(focal_point, 0)`.
    let offset = (hx - ox).hypot(hy - oy) / radius;
    FillStyle::FocalGradient {
        gradient,
        focal_point: Fixed8::from_f64(offset.clamp(0.0, 1.0)),
    }
}

/// Build the SWF LineStyle2 for a parsed stroke.
fn stroke_to_line_style(stroke: &wick::Stroke, close: bool) -> LineStyle {
    use swf::{LineCapStyle, LineJoinStyle};
    let cap = match stroke.cap {
        wick::StrokeCap::Butt => LineCapStyle::None,
        wick::StrokeCap::Round => LineCapStyle::Round,
        wick::StrokeCap::Square => LineCapStyle::Square,
    };
    let join = match stroke.join {
        wick::StrokeJoin::Round => LineJoinStyle::Round,
        wick::StrokeJoin::Bevel => LineJoinStyle::Bevel,
        wick::StrokeJoin::Miter => LineJoinStyle::Miter(Fixed8::from_f64(stroke.miter_limit)),
    };
    LineStyle::new()
        .with_width(Twips::from_pixels(stroke.width))
        .with_color(stroke.color)
        .with_start_cap(cap)
        .with_end_cap(cap)
        .with_join_style(join)
        .with_allow_close(close)
}

/// Planarize a filled region's rings under the non-zero rule via i_overlay: resolve
/// self-intersections and normalize winding so holes come back wound opposite to their
/// outer (index 0 of each output shape is the outer boundary). Returns every output
/// ring flattened across all resulting shapes, in twips. `keep_all_points` preserves
/// input vertices (no collinear thinning) so twip geometry is stable.
fn planarize(rings: &[Vec<(i32, i32)>]) -> Vec<Vec<(i32, i32)>> {
    use i_overlay::core::fill_rule::FillRule;
    use i_overlay::core::overlay::IntOverlayOptions;
    use i_overlay::core::simplify::Simplify;
    use i_overlay::i_float::int::point::IntPoint;

    let contours: Vec<Vec<IntPoint>> = rings
        .iter()
        .map(|r| r.iter().map(|&(x, y)| IntPoint::new(x, y)).collect())
        .collect();
    let shapes = contours.simplify(FillRule::NonZero, IntOverlayOptions::keep_all_points());
    let out: Vec<Vec<(i32, i32)>> = shapes
        .into_iter()
        .flatten()
        .map(|contour| contour.into_iter().map(|p| (p.x, p.y)).collect())
        .collect();
    // A degenerate input (e.g. all collinear) can simplify to nothing; fall back to the
    // raw rings so the region still draws rather than vanishing.
    if out.is_empty() { rings.to_vec() } else { out }
}

/// Convert one flattened contour into a `DefineShape4` with its fill and/or stroke.
/// A CompoundPath contributes hole rings alongside the outer ring; those go through
/// `planarize` (i_overlay, non-zero) so the holes render empty. A plain single-ring
/// contour is emitted directly, preserving its exact vertices.
fn contour_to_shape(id: u16, contour: &Contour) -> Shape {
    // Absolute pixels -> twips (i32) first, then take deltas, so rounding can't drift.
    let to_twips = |ring: &[(f64, f64)]| -> Vec<(i32, i32)> {
        ring.iter()
            .map(|&(x, y)| (Twips::from_pixels(x).get(), Twips::from_pixels(y).get()))
            .collect()
    };
    let outer = to_twips(&contour.points);

    // A fill always closes the area; an open stroke stops at the last vertex.
    let close = contour.fill.is_some() || contour.closed;

    // Only holed regions (CompoundPaths) need planarization; a simple ring is emitted
    // as-is so its geometry and edge count stay exact.
    let rings: Vec<Vec<(i32, i32)>> = if contour.holes.is_empty() {
        vec![outer]
    } else {
        let mut all = vec![outer];
        all.extend(contour.holes.iter().map(|h| to_twips(h)));
        planarize(&all)
    };

    let (mut x_min, mut x_max, mut y_min, mut y_max) = (i32::MAX, i32::MIN, i32::MAX, i32::MIN);
    for &(x, y) in rings.iter().flatten() {
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

    let fill_idx = contour.fill.as_ref().map(|_| 1); // 1-based into fill_styles
    let line_idx = contour.stroke.as_ref().map(|_| 1); // 1-based into line_styles

    // Emit one ring: a move-to that re-declares the styles, then its edges. Only the
    // first (outer) ring honors `close` for the open-stroke case; planarized holes and
    // extra outers are always closed.
    let mut records = Vec::new();
    let mut push_ring = |ring: &[(i32, i32)], ring_closes: bool| {
        records.push(ShapeRecord::StyleChange(Box::new(StyleChangeData {
            move_to: Some(Point::new(Twips::new(ring[0].0), Twips::new(ring[0].1))),
            fill_style_0: None,
            fill_style_1: fill_idx,
            line_style: line_idx,
            new_styles: None,
        })));
        let last = if ring_closes {
            ring.len()
        } else {
            ring.len() - 1
        };
        for i in 0..last {
            let (cx, cy) = ring[i];
            let (nx, ny) = ring[(i + 1) % ring.len()]; // wraps to the start only when closing
            records.push(ShapeRecord::StraightEdge {
                delta: PointDelta::new(Twips::new(nx - cx), Twips::new(ny - cy)),
            });
        }
    };
    for (i, ring) in rings.iter().enumerate() {
        push_ring(ring, if i == 0 { close } else { true });
    }

    Shape {
        version: 4,
        id,
        shape_bounds: bounds,
        edge_bounds: bounds,
        flags: ShapeFlag::NON_ZERO_WINDING_RULE,
        styles: ShapeStyles {
            fill_styles: contour
                .fill
                .as_ref()
                .map(|f| vec![fill_to_style(f)])
                .unwrap_or_default(),
            line_styles: contour
                .stroke
                .as_ref()
                .map(|s| vec![stroke_to_line_style(s, close)])
                .unwrap_or_default(),
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
/// own transform. `PartialEq` drives the frame-to-frame diff: a same-id placement whose
/// matrix or cxform changed (a tween in motion) becomes a `Modify`, not a re-`Place`.
#[derive(Clone, PartialEq)]
struct Placement {
    id: u16,
    matrix: Matrix,
    cxform: Option<ColorTransform>,
}

/// A tween keyframe resolved to absolute-frame coordinates: hold `transform` at
/// `playhead_abs`, interpolating toward the next key. `easing` names the curve for
/// the segment that STARTS here.
#[derive(Clone)]
struct TweenKey {
    playhead_abs: u16,
    transform: Transform,
    full_rotations: i32,
    easing: String,
    bezier: Option<[f64; 4]>,
}

/// What a display-list slot holds across a keyframe's span: either a fixed placement
/// (loose shape, or a statically-held clip) or a tween track that resolves to a
/// different transform on each frame.
#[derive(Clone)]
enum Item {
    Fixed(Placement),
    Tween { id: u16, keys: Vec<TweenKey> },
}

/// Map a Wick easing name to an eased progress value. Translated verbatim from the
/// Wick engine's tween.js (`TWEEN.Easing`) as exposed through `Wick.Tween` — the 28
/// `easingType` strings in `VALID_EASING_TYPES`. Back and Bounce return values outside
/// [0, 1] on purpose (overshoot/undershoot); callers must not clamp. Unknown names fall
/// back to linear, matching the engine's `easingType || 'none'` default.
/// Progress through a segment's curve at time `k`, named or drawn.
///
/// `"custom"` with control points is the graph editor's curve; `"custom"` without them can
/// only come from a file that named the curve and lost the points, and eases linearly, which
/// is what `ease` does with a name it does not know.
fn ease_curve(easing: &str, bezier: Option<[f64; 4]>, k: f64) -> f64 {
    match (easing, bezier) {
        ("custom", Some(points)) => cubic_bezier_ease(points, k),
        _ => ease(easing, k),
    }
}

/// A cubic Bézier from (0,0) to (1,1) with control points `[x1, y1, x2, y2]`, evaluated as
/// progress against time.
///
/// The curve is parametric, so the x the caller has is not the parameter the curve is written
/// in: find the parameter whose x matches, then read that parameter's y. Newton converges in a
/// few steps for the curves anyone draws, and bisection catches the ones where it does not —
/// a nearly vertical segment, where the derivative is small enough that a Newton step
/// overshoots the interval.
///
/// y is unclamped on purpose, exactly as the Back and Bounce curves above are: a control point
/// above 1 overshoots the target and comes back, and one below 0 winds up first. Callers must
/// not clamp.
///
/// This is a transcription of `Wick.Tween.cubicBezierEase` in the engine, step for step and in
/// the same order, so the browser preview and the exported SWF draw one curve. Written any
/// other way the two would agree to about six digits and disagree in the seventh, which is
/// precisely the kind of drift `easing_matches_bezier_js` exists to refuse.
fn cubic_bezier_ease(bezier: [f64; 4], k: f64) -> f64 {
    if k <= 0.0 {
        return 0.0;
    }
    if k >= 1.0 {
        return 1.0;
    }

    let [x1, y1, x2, y2] = bezier;
    let cx = 3.0 * x1;
    let bx = 3.0 * (x2 - x1) - cx;
    let ax = 1.0 - cx - bx;
    let cy = 3.0 * y1;
    let by = 3.0 * (y2 - y1) - cy;
    let ay = 1.0 - cy - by;

    let sample_x = |t: f64| ((ax * t + bx) * t + cx) * t;
    let sample_y = |t: f64| ((ay * t + by) * t + cy) * t;
    let slope_x = |t: f64| (3.0 * ax * t + 2.0 * bx) * t + cx;

    let mut t = k;
    for _ in 0..8 {
        let error = sample_x(t) - k;
        if error.abs() < 1e-7 {
            return sample_y(t);
        }
        let slope = slope_x(t);
        if slope.abs() < 1e-6 {
            break;
        }
        t -= error / slope;
    }

    let (mut lo, mut hi) = (0.0f64, 1.0f64);
    t = k;
    while lo < hi {
        let x = sample_x(t);
        if (x - k).abs() < 1e-7 {
            return sample_y(t);
        }
        if k > x {
            lo = t;
        } else {
            hi = t;
        }
        let next = (hi + lo) / 2.0;
        if next == t {
            break;
        }
        t = next;
    }
    sample_y(t)
}

fn ease(easing: &str, k: f64) -> f64 {
    match easing {
        // Quadratic
        "in" => k * k,
        "out" => k * (2.0 - k),
        "in-out" => {
            let k = k * 2.0;
            if k < 1.0 {
                0.5 * k * k
            } else {
                let k = k - 1.0;
                -0.5 * (k * (k - 2.0) - 1.0)
            }
        }
        // Cubic
        "in-cubic" => k * k * k,
        "out-cubic" => {
            let k = k - 1.0;
            k * k * k + 1.0
        }
        "in-out-cubic" => {
            let k = k * 2.0;
            if k < 1.0 {
                0.5 * k * k * k
            } else {
                let k = k - 2.0;
                0.5 * (k * k * k + 2.0)
            }
        }
        // Quartic
        "in-quartic" => k * k * k * k,
        "out-quartic" => {
            let k = k - 1.0;
            1.0 - k * k * k * k
        }
        "in-out-quartic" => {
            let k = k * 2.0;
            if k < 1.0 {
                0.5 * k * k * k * k
            } else {
                let k = k - 2.0;
                -0.5 * (k * k * k * k - 2.0)
            }
        }
        // Quintic
        "in-quintic" => k * k * k * k * k,
        "out-quintic" => {
            let k = k - 1.0;
            k * k * k * k * k + 1.0
        }
        "in-out-quintic" => {
            let k = k * 2.0;
            if k < 1.0 {
                0.5 * k * k * k * k * k
            } else {
                let k = k - 2.0;
                0.5 * (k * k * k * k * k + 2.0)
            }
        }
        // Sinusoidal
        "in-sine" => 1.0 - (k * std::f64::consts::FRAC_PI_2).cos(),
        "out-sine" => (k * std::f64::consts::FRAC_PI_2).sin(),
        "in-out-sine" => 0.5 * (1.0 - (std::f64::consts::PI * k).cos()),
        // Exponential
        "in-exp" => {
            if k == 0.0 {
                0.0
            } else {
                1024f64.powf(k - 1.0)
            }
        }
        "out-exp" => {
            if k == 1.0 {
                1.0
            } else {
                1.0 - 2f64.powf(-10.0 * k)
            }
        }
        "in-out-exp" => {
            if k == 0.0 {
                0.0
            } else if k == 1.0 {
                1.0
            } else {
                let k = k * 2.0;
                if k < 1.0 {
                    0.5 * 1024f64.powf(k - 1.0)
                } else {
                    0.5 * (-(2f64.powf(-10.0 * (k - 1.0))) + 2.0)
                }
            }
        }
        // Circular
        "in-circle" => 1.0 - (1.0 - k * k).sqrt(),
        "out-circle" => {
            let k = k - 1.0;
            (1.0 - k * k).sqrt()
        }
        "in-out-circle" => {
            let k = k * 2.0;
            if k < 1.0 {
                -0.5 * ((1.0 - k * k).sqrt() - 1.0)
            } else {
                let k = k - 2.0;
                0.5 * ((1.0 - k * k).sqrt() + 1.0)
            }
        }
        // Back
        "in-back" => {
            let s = 1.70158;
            k * k * ((s + 1.0) * k - s)
        }
        "out-back" => {
            let s = 1.70158;
            let k = k - 1.0;
            k * k * ((s + 1.0) * k + s) + 1.0
        }
        "in-out-back" => {
            let s = 1.70158 * 1.525;
            let k = k * 2.0;
            if k < 1.0 {
                0.5 * (k * k * ((s + 1.0) * k - s))
            } else {
                let k = k - 2.0;
                0.5 * (k * k * ((s + 1.0) * k + s) + 2.0)
            }
        }
        // Bounce
        "in-bounce" => 1.0 - ease("out-bounce", 1.0 - k),
        "out-bounce" => {
            if k < 1.0 / 2.75 {
                7.5625 * k * k
            } else if k < 2.0 / 2.75 {
                let k = k - 1.5 / 2.75;
                7.5625 * k * k + 0.75
            } else if k < 2.5 / 2.75 {
                let k = k - 2.25 / 2.75;
                7.5625 * k * k + 0.9375
            } else {
                let k = k - 2.625 / 2.75;
                7.5625 * k * k + 0.984375
            }
        }
        "in-out-bounce" => {
            if k < 0.5 {
                ease("in-bounce", k * 2.0) * 0.5
            } else {
                ease("out-bounce", k * 2.0 - 1.0) * 0.5 + 0.5
            }
        }
        // "none" and any unknown name
        _ => k,
    }
}

/// Interpolate a tween track to the transform it holds at document playhead `pos`.
/// Clamps to the first/last key outside the tween's span; within a segment, eases `t`
/// then lerps, adding the segment's `full_rotations` whole turns to the rotation.
///
/// `pos` is fractional rather than a frame index because the exported movie samples this
/// curve more finely than the document draws it (see `upsample_factor`). A tween is a
/// continuous function of the playhead; the document's framerate is only the rate the
/// author chose to *draw* at, and there is no reason the export has to ask at the same
/// points. Whole positions still land exactly where the integer version did.
fn interp_tween(keys: &[TweenKey], pos: f64) -> Transform {
    let first = &keys[0];
    let last = &keys[keys.len() - 1];
    if pos <= f64::from(first.playhead_abs) {
        return first.transform;
    }
    if pos >= f64::from(last.playhead_abs) {
        return last.transform;
    }
    let i = keys
        .iter()
        .rposition(|k| f64::from(k.playhead_abs) <= pos)
        .unwrap_or(0);
    let a = &keys[i];
    let b = &keys[i + 1];
    let span = f64::from(b.playhead_abs - a.playhead_abs);
    let raw = (pos - f64::from(a.playhead_abs)) / span;
    let t = ease_curve(&a.easing, a.bezier, raw);
    let mut end = b.transform;
    end.rotation_deg += 360.0 * f64::from(a.full_rotations);
    lerp_transform(&a.transform, &end, t)
}

impl Item {
    /// The placement this slot wants at document playhead `pos`.
    fn resolve(&self, pos: f64) -> Placement {
        match self {
            Item::Fixed(p) => p.clone(),
            Item::Tween { id, keys } => {
                let t = interp_tween(keys, pos);
                Placement {
                    id: *id,
                    matrix: t.matrix(),
                    cxform: Some(t.color_transform()),
                }
            }
        }
    }
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

/// Compile the scripts whose `name` is in `events`, returning their ops in source order plus
/// a message for each script that could not be compiled.
///
/// Per script rather than per statement, because [`script::compile`] refuses a whole script
/// on the first thing it does not understand — half a script is worse than none when the
/// half that failed was a loop's body or a condition.
fn compile_actions(scripts: &[Script], events: &[&str]) -> (Vec<script::Op>, Vec<String>) {
    let mut ops = Vec::new();
    let mut refused = Vec::new();
    for s in scripts {
        if !events.contains(&s.name.as_str()) || s.src.trim().is_empty() {
            continue;
        }
        match script::compile(&s.src) {
            Ok(compiled) => ops.extend(compiled),
            Err(why) => refused.push(format!("{}: {}", s.name, why.message)),
        }
    }
    (ops, refused)
}

/// Frame actions: a keyframe's `default`/`load` scripts. Both names mean "at this frame"
/// here — SWF has no per-tick frame script, so a `stop()` in either compiles the same.
fn recognize_frame_actions(scripts: &[Script]) -> (Vec<script::Op>, Vec<String>) {
    compile_actions(scripts, &["default", "load"])
}

/// Clip click handlers: a clip's `mousepressed`/`mouseclick` scripts. Both map to a SWF
/// `PRESS` clip event (docs/wick-format.md); twip does not distinguish press from click.
fn recognize_clip_actions(scripts: &[Script]) -> (Vec<script::Op>, Vec<String>) {
    compile_actions(scripts, &["mousepressed", "mouseclick"])
}

/// Compile a timeline (a list of layers) into its control-tag stream (Place/Remove/
/// ShowFrame), pushing any shape/sprite DEFINITIONS onto the shared `defs` list in
/// dependency order (children before the DefineSprite that uses them). Recurses for
/// nested clips. SWF requires all DefineShape/DefineSprite tags at the root, before
/// use — post-order recursion gives exactly that ordering.
///
/// Collects two kinds of behavior for the caller to attach (both need owned AVM1
/// bytes that outlive the borrowed tags): `frame_actions` maps an absolute frame
/// number to a keyframe's recognized commands (→ a `DoAction` before that frame's
/// `ShowFrame`), and `clip_handlers` maps a clip's character id to its recognized
/// click commands (→ `PRESS` clip actions on that sprite's initial `PlaceObject`).
fn compile_timeline(
    layers: &[wick::Layer],
    next_id: &mut u16,
    defs: &mut Vec<Tag<'static>>,
    frame_actions: &mut BTreeMap<u16, Vec<script::Op>>,
    clip_handlers: &mut BTreeMap<u16, Vec<script::Op>>,
    upsample: u16,
) -> Vec<Tag<'static>> {
    let num_layers = layers.len();

    // Per (layer, frame): the ordered items that frame wants live. Building this first
    // also emits the definitions (shapes now, sprites via recursion). Each item resolves
    // to a placement per frame — fixed for shapes/static clips, interpolated for tweens.
    let mut slots: Vec<Vec<Vec<Item>>> = Vec::with_capacity(num_layers);
    for layer in layers {
        let mut layer_slots = Vec::with_capacity(layer.frames.len());
        for frame in &layer.frames {
            // Frame scripts fire when the playhead ENTERS the keyframe (Flash frame
            // action), so key the actions by the keyframe's start. Multiple layers'
            // scripts on the same start-frame concatenate.
            let (cmds, unrecognized) = recognize_frame_actions(&frame.scripts);
            if !unrecognized.is_empty() {
                eprintln!(
                    "twip: {} uncompiled frame-script statement(s) on frame {}: {}",
                    unrecognized.len(),
                    frame.start,
                    unrecognized.join("; ")
                );
            }
            if !cmds.is_empty() {
                frame_actions.entry(frame.start).or_default().extend(cmds);
            }

            let mut items = Vec::new();
            for contour in &frame.contours {
                let id = *next_id;
                *next_id += 1;
                defs.push(Tag::DefineShape(Box::new(contour_to_shape(id, contour))));
                items.push(Item::Fixed(Placement {
                    id,
                    matrix: Matrix::IDENTITY,
                    cxform: None,
                }));
            }
            // Wick puts at most one clip on a tweened frame; the tween track drives that
            // clip. Any further clips (unusual) are placed statically at their own transform.
            for (ci, clip) in frame.clips.iter().enumerate() {
                // A nested clip's frame scripts / click handlers belong inside its
                // DefineSprite body, which would force the whole (currently 'static)
                // tag pipeline to hold borrowed tags — deferred. Collect + warn.
                let mut nested_actions: BTreeMap<u16, Vec<script::Op>> = BTreeMap::new();
                let mut nested_handlers: BTreeMap<u16, Vec<script::Op>> = BTreeMap::new();
                // The same factor as the root: a sprite's timeline advances one frame per
                // movie frame, so a nested clip left at 1x would run at a fraction of the
                // speed its document says once the root is upsampled.
                let body = compile_timeline(
                    &clip.layers,
                    next_id,
                    defs,
                    &mut nested_actions,
                    &mut nested_handlers,
                    upsample,
                );
                if !nested_actions.is_empty() || !nested_handlers.is_empty() {
                    eprintln!(
                        "twip: note: scripts inside a nested clip are not yet compiled \
                         ({} frame + {} click handler(s) skipped)",
                        nested_actions.len(),
                        nested_handlers.len()
                    );
                }
                let num_frames = body.iter().filter(|t| matches!(t, Tag::ShowFrame)).count() as u16;
                let id = *next_id;
                *next_id += 1;
                defs.push(Tag::DefineSprite(swf::Sprite {
                    id,
                    num_frames: num_frames.max(1),
                    tags: body,
                }));
                // A recognized click handler on THIS (root-level) clip attaches to its
                // initial Place tag in compile_document — the character id is the key.
                let (chandlers, cunrec) = recognize_clip_actions(&clip.scripts);
                if !cunrec.is_empty() {
                    eprintln!(
                        "twip: {} uncompiled clip-script statement(s) on a clip: {}",
                        cunrec.len(),
                        cunrec.join("; ")
                    );
                }
                if !chandlers.is_empty() {
                    clip_handlers.insert(id, chandlers);
                }
                if ci == 0 && !frame.tweens.is_empty() {
                    let keys = frame
                        .tweens
                        .iter()
                        .map(|tw| TweenKey {
                            playhead_abs: frame.start + tw.playhead - 1,
                            transform: tw.transform,
                            full_rotations: tw.full_rotations,
                            easing: tw.easing.clone(),
                            bezier: tw.bezier,
                        })
                        .collect();
                    items.push(Item::Tween { id, keys });
                } else {
                    items.push(Item::Fixed(Placement {
                        id,
                        matrix: clip.transform.matrix(),
                        cxform: Some(clip.transform.color_transform()),
                    }));
                }
            }
            layer_slots.push(items);
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
    //
    // Each document frame becomes `upsample` movie frames. Which *drawing* is on screen is
    // still chosen by the document frame — two hand-drawn cels have nothing to interpolate
    // between them, so a cel simply holds for the whole group. What does move within the
    // group is a tween, which gets asked for its transform at fractional playhead positions.
    // That is the whole trick: authoring cadence and playback smoothness stop being the same
    // number, so 12fps can mean "each drawing lasts a twelfth of a second" without also
    // meaning "motion updates twelve times a second".
    let mut control: Vec<Tag<'static>> = Vec::new();
    let mut current: BTreeMap<u16, Placement> = BTreeMap::new(); // depth -> placement
    let step = 1.0 / f64::from(upsample);
    for frame_no in 1..=total {
        for sub in 0..upsample {
            let pos = f64::from(frame_no) + f64::from(sub) * step;
            let mut desired: BTreeMap<u16, Placement> = BTreeMap::new();
            for (li, layer) in layers.iter().enumerate() {
                if let Some(fi) = layer
                    .frames
                    .iter()
                    .position(|fr| fr.start <= frame_no && frame_no <= fr.end)
                {
                    let base = depth_base(li);
                    for (ci, item) in slots[li][fi].iter().enumerate() {
                        desired.insert(base + ci as u16 + 1, item.resolve(pos));
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
            // Place new characters, and Modify held ones whose transform changed this frame
            // (a tween in motion). Removes above already cleared depths that changed id.
            for (&depth, placement) in &desired {
                match current.get(&depth) {
                    Some(cur) if cur.id == placement.id => {
                        if cur != placement {
                            control.push(place_placement(
                                PlaceObjectAction::Modify,
                                placement,
                                depth,
                            ));
                        }
                    }
                    _ => control.push(place_placement(
                        PlaceObjectAction::Place(placement.id),
                        placement,
                        depth,
                    )),
                }
            }
            control.push(Tag::ShowFrame);
            current = desired;
        }
    }
    control
}

/// How many movie frames to emit per document frame, so the export lands as close to
/// `TARGET_PLAYBACK_FPS` as a whole multiple allows.
///
/// Whole multiples only, and that is a real limit rather than an implementation shortcut: a
/// hand-drawn cel has to hold for a whole number of movie frames or some cels last longer
/// than others. It means the rates that divide 60 — 12, 15, 20, 30, 60 — land exactly on it,
/// while 24 goes to 48 and keeps its judder on a 60Hz display. 24 remains the rate to avoid.
///
/// Never exceeds the target: `floor`, not `round`, so 45fps stays 45 rather than climbing to
/// 90 and asking a 60Hz display for frames it cannot show.
fn upsample_factor(framerate: f64) -> u16 {
    const TARGET_PLAYBACK_FPS: f64 = 60.0;
    if !framerate.is_finite() || framerate <= 0.0 {
        return 1;
    }
    let k = (TARGET_PLAYBACK_FPS / framerate).floor();
    if !k.is_finite() || k < 1.0 {
        return 1;
    }
    // Cap so framerate * k can never overflow the header's Fixed8 ceiling.
    k.min(u16::MAX as f64) as u16
}

/// Rebuild a sprite's initial `PlaceObject` with a `PRESS` clip action carrying
/// `action_data`. Destructures the owned (`'static`) place tag and reconstructs it
/// borrowing the arena bytes, so only this one tag takes the shorter lifetime.
fn place_with_clip_actions<'a>(po: PlaceObject<'static>, action_data: &'a [u8]) -> Tag<'a> {
    let PlaceObject {
        version,
        action,
        depth,
        matrix,
        color_transform,
        ratio,
        name,
        clip_depth,
        class_name,
        filters,
        background_color,
        blend_mode,
        clip_actions: _,
        has_image,
        is_bitmap_cached,
        is_visible,
        amf_data,
    } = po;
    Tag::PlaceObject(Box::new(PlaceObject {
        version,
        action,
        depth,
        matrix,
        color_transform,
        ratio,
        name,
        clip_depth,
        class_name,
        filters,
        background_color,
        blend_mode,
        clip_actions: Some(ClipActions {
            all_event_flags: ClipEventFlag::PRESS,
            records: vec![ClipAction {
                events: ClipEventFlag::PRESS,
                key_code: None,
                action_data,
            }],
        }),
        has_image,
        is_bitmap_cached,
        is_visible,
        amf_data,
    }))
}

/// Compiler settings that belong to the person exporting rather than to the document.
///
/// Start from `Default` and override what you mean to change, so a knob added later arrives
/// already set to the behaviour the caller had before it existed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Options {
    /// Resample each document frame into several movie frames (see `upsample_factor`).
    ///
    /// On by default because it is what makes a 12fps document play smoothly. Turn it off to
    /// get one movie frame per document frame at exactly the document's rate — which is what
    /// you want when the frame numbers have to line up with something outside twip, or when a
    /// deliberately coarse look is the point.
    pub upsample: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self { upsample: true }
    }
}

/// Compile a parsed document into an SWF timeline (frame-by-frame, with nested clips).
///
/// Recognized frame scripts become `DoAction` tags spliced before their keyframe's
/// `ShowFrame`; recognized clip click scripts become `PRESS` clip actions on the
/// sprite's initial `PlaceObject`.
pub fn compile_document(doc: &wick::Document) -> Result<Vec<u8>> {
    compile_document_with(doc, &Options::default())
}

/// `compile_document` with the export settings spelled out.
pub fn compile_document_with(doc: &wick::Document, opts: &Options) -> Result<Vec<u8>> {
    let mut next_id: u16 = 1;
    let mut defs: Vec<Tag> = Vec::new();
    let mut frame_cmds: BTreeMap<u16, Vec<script::Op>> = BTreeMap::new();
    let mut clip_cmds: BTreeMap<u16, Vec<script::Op>> = BTreeMap::new();
    let upsample = if opts.upsample {
        upsample_factor(doc.framerate)
    } else {
        1
    };
    let control = compile_timeline(
        &doc.layers,
        &mut next_id,
        &mut defs,
        &mut frame_cmds,
        &mut clip_cmds,
        upsample,
    );

    // Frame numbers are document frames everywhere above and movie frames from here down, so
    // this is the one place the two coordinate systems meet.
    //
    // Both the keys and the goto TARGETS have to move. A key says which movie frame gets the
    // DoAction: document frame d is the first of its group, so (d-1)*k+1. A `GotoFrame`
    // payload is already 0-based (see `parse_goto`), which makes its remap the tidier f*k —
    // and forgetting it would be quiet rather than loud, sending `gotoAndPlay(10)` to a frame
    // a fifth of the way into the movie with everything else still looking right.
    if upsample > 1 {
        let k = u32::from(upsample);
        let shift = |f: u16| -> u16 { (u32::from(f) * k).min(u32::from(u16::MAX)) as u16 };
        let retarget = |mut ops: Vec<script::Op>| -> Vec<script::Op> {
            script::retarget(&mut ops, k);
            ops
        };
        frame_cmds = frame_cmds
            .into_iter()
            .map(|(d, cmds)| (shift(d.saturating_sub(1)) + 1, retarget(cmds)))
            .collect();
        clip_cmds = clip_cmds
            .into_iter()
            .map(|(id, cmds)| (id, retarget(cmds)))
            .collect();
    }

    let total: u16 = control
        .iter()
        .filter(|t| matches!(t, Tag::ShowFrame))
        .count()
        .try_into()
        .unwrap_or(u16::MAX);

    // Serialize recognized commands to owned AVM1 buffers. Both arenas outlive the
    // borrowed tags assembled below (all local to this function, so the borrow is
    // sound without a codebase-wide lifetime): `action_arena` keyed by frame number,
    // `clip_arena` by character id.
    let serialize = |m: BTreeMap<u16, Vec<script::Op>>| -> BTreeMap<u16, Vec<u8>> {
        m.into_iter()
            .filter_map(|(k, cmds)| {
                let bytes = script::emit(&cmds);
                (!bytes.is_empty()).then_some((k, bytes))
            })
            .collect()
    };
    let action_arena = serialize(frame_cmds);
    let clip_arena = serialize(clip_cmds);

    // The stage colour, first, because that is where a player looks for it: ruffle's reader
    // scans only the first few tags for SetBackgroundColor and treats a later one as ordinary
    // stream. Without the tag a movie gets the player's default — white — so every .wick
    // compiled before this exported onto white however dark its stage was in the editor, and
    // the editor has offered a Background Color control the whole time.
    //
    // Definitions next, then the control stream: a DoAction spliced before the ShowFrame of
    // each frame that carries one, and a PRESS clip action attached to the initial Place of
    // each clip that carries one. `Tag<'static>` tags coerce to the arenas' borrow lifetime
    // on push.
    let mut tags: Vec<Tag> = vec![Tag::SetBackgroundColor(doc.background)];
    tags.extend(defs);
    let mut frame_no: u16 = 0;
    for tag in control {
        match tag {
            Tag::ShowFrame => {
                frame_no += 1;
                if let Some(bytes) = action_arena.get(&frame_no) {
                    tags.push(Tag::DoAction(bytes.as_slice()));
                }
                tags.push(Tag::ShowFrame);
            }
            Tag::PlaceObject(po) => {
                let handler = match &po.action {
                    PlaceObjectAction::Place(id) => clip_arena.get(id),
                    _ => None,
                };
                match handler {
                    Some(bytes) => tags.push(place_with_clip_actions(*po, bytes.as_slice())),
                    None => tags.push(Tag::PlaceObject(po)),
                }
            }
            other => tags.push(other),
        }
    }

    // SWF stores the frame rate as a signed 8.8 fixed-point, so the format tops out at
    // Fixed8::MAX and `from_f64` saturates above it rather than failing. Saturating quietly is
    // the worst of the options here: the editor clamps a project's framerate at 9999
    // (engine/src/base/Project.js), so 200 is reachable from the settings dialog, and it would
    // preview at one speed and export at another with nothing said. Refusing is louder and
    // lands everywhere — compile_wick's error reaches the CLI, the desktop shell and the
    // browser's toast alike, while a wrong speed reaches none of them.
    let ceiling = Fixed8::MAX.to_f64();
    if doc.framerate > ceiling {
        anyhow::bail!(
            "framerate {} is above the {} fps an SWF header can hold (it is a signed 8.8 \
             fixed-point); lower the project's framerate in its settings",
            doc.framerate,
            ceiling
        );
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
        // The document's rate times the factor, so a 12fps document plays as a 60fps movie
        // whose every fifth frame is the one the author drew.
        frame_rate: Fixed8::from_f64(doc.framerate * f64::from(upsample)),
        num_frames: total.max(1),
    };

    let mut out = Vec::new();
    write_swf(&header, &tags, &mut out)?;
    Ok(out)
}

/// Compile the bytes of a `.wick` file into an SWF.
pub fn compile_wick(wick_bytes: &[u8]) -> Result<Vec<u8>> {
    compile_wick_with(wick_bytes, &Options::default())
}

/// `compile_wick` with the export settings spelled out.
pub fn compile_wick_with(wick_bytes: &[u8], opts: &Options) -> Result<Vec<u8>> {
    Ok(compile_wick_reporting(wick_bytes, opts)?.0)
}

/// Compile, and say what the document held that the movie does not.
///
/// The separate entry point rather than a changed return type: every caller that only wants
/// bytes keeps working, and the two that face a person — the CLI and the export button —
/// opt in. See [`wick::Skipped`] for why silence was the wrong default.
pub fn compile_wick_reporting(
    wick_bytes: &[u8],
    opts: &Options,
) -> Result<(Vec<u8>, wick::Skipped)> {
    let doc = wick::parse_wick(wick_bytes)?;
    let swf = compile_document_with(&doc, opts)?;
    Ok((swf, doc.skipped))
}

#[cfg(test)]
mod tests {
    use super::*;
    use swf::avm1::types::{Action, GotoFrame};

    /// Movie frames a document of `doc_frames` frames at `rate` compiles to.
    ///
    /// Every assertion about the emitted stream has to say which of the two coordinate
    /// systems it means, since the compiler upsamples each document frame to
    /// `upsample_factor(rate)` movie frames. Written as a product so the document-level
    /// number — the one that matches what the fixture actually contains — stays readable.
    fn movie(doc_frames: usize, rate: f64) -> usize {
        doc_frames * upsample_factor(rate) as usize
    }

    /// Every committed fixture was authored at 12fps, which upsamples ×5 to 60.
    const FIXTURE_FPS: f64 = 12.0;

    /// The header rate a document at `rate` compiles to.
    fn movie_fps(rate: f64) -> f32 {
        (rate * f64::from(upsample_factor(rate))) as f32
    }

    /// Placements a tween spanning `doc_frames` document frames produces at `rate`.
    ///
    /// Deliberately not `movie()`. The span's last key sits on its last *document* frame, so
    /// the movie frames after it resample the same clamped transform, and the compiler emits
    /// no `PlaceObject` for a placement equal to the one already on screen. What's left is
    /// one sample per step across the gaps, plus the one that starts them.
    fn tween_samples(doc_frames: usize, rate: f64) -> usize {
        (doc_frames - 1) * upsample_factor(rate) as usize + 1
    }

    /// Compile with upsampling off, for tests whose subject is something else and whose
    /// assertions read better in document frames.
    fn compile_flat(doc: &wick::Document) -> Result<Vec<u8>> {
        compile_document_with(doc, &Options { upsample: false })
    }

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
        assert_eq!(
            show_frames,
            movie(1, FIXTURE_FPS),
            "single static frame, upsampled"
        );
        assert_eq!(
            parsed.header.frame_rate().to_f32(),
            movie_fps(FIXTURE_FPS),
            "the fixture's own rate times the factor, not a hardcoded default"
        );

        // Both engine-authored paths carry strokeColor:[0,0,0] + strokeCap:"round"
        // with strokeWidth omitted (paper.js default 1). Each shape must now have a
        // fill AND a black round-capped hairline stroke.
        use swf::LineCapStyle;
        for tag in &parsed.tags {
            if let Tag::DefineShape(shape) = tag {
                assert_eq!(
                    shape.styles.fill_styles.len(),
                    1,
                    "each shape keeps its fill"
                );
                assert_eq!(
                    shape.styles.line_styles.len(),
                    1,
                    "each shape gains a stroke"
                );
                let ls = &shape.styles.line_styles[0];
                assert_eq!(
                    ls.width(),
                    Twips::from_pixels(1.0),
                    "default strokeWidth 1px"
                );
                assert_eq!(
                    *ls.fill_style(),
                    FillStyle::Color(Color::from_rgb(0x000000, 255)),
                    "black stroke"
                );
                assert_eq!(ls.start_cap(), LineCapStyle::Round, "strokeCap round");
                assert_eq!(ls.end_cap(), LineCapStyle::Round);
            }
        }
    }

    /// Item 8: a CompoundPath donut (outer 200x200 square + oppositely-wound 80x80
    /// hole) parses, planarizes, and compiles to ONE shape carrying two rings — the
    /// hole survives so the fill has a window.
    #[test]
    fn compiles_brush_donut_wick() {
        let bytes = include_bytes!("../fixtures/brush-donut.wick");
        let swf = compile_wick(bytes).expect("compile brush-donut.wick");
        let buf = swf::decompress_swf(&swf[..]).expect("decompress");
        let parsed = swf::parse_swf(&buf).expect("parse");

        let shapes: Vec<&Shape> = parsed
            .tags
            .iter()
            .filter_map(|t| match t {
                Tag::DefineShape(s) => Some(&**s),
                _ => None,
            })
            .collect();
        assert_eq!(shapes.len(), 1, "the donut is one filled shape");
        let shape = shapes[0];
        assert_eq!(shape.styles.fill_styles.len(), 1, "one fill");

        // Each ring begins with a move-to StyleChange; a donut has two (outer + hole).
        let move_tos = shape
            .shape
            .iter()
            .filter(|r| matches!(r, ShapeRecord::StyleChange(s) if s.move_to.is_some()))
            .count();
        assert_eq!(move_tos, 2, "outer ring + one hole ring");
        assert_eq!(straight_edges(shape), 8, "two 4-sided rings");
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
            movie(12, FIXTURE_FPS),
            "playhead spans frames 1..=12, upsampled"
        );
        // Still three, not thirty-six: a cel holds across its group of movie frames, and the
        // compiler only places when the drawing on screen actually changes.
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

    /// Item 10 milestone A end-to-end: a real `.wick` (frame-by-frame with a
    /// `stop();` default script on keyframe 1) emits one `DoAction` carrying `Stop`,
    /// placed before frame 1's `ShowFrame`.
    #[test]
    fn compiles_frame_stop_wick() {
        let bytes = include_bytes!("../fixtures/frame-stop.wick");
        let swf = compile_wick(bytes).expect("compile frame-stop.wick");
        let buf = swf::decompress_swf(&swf[..]).expect("decompress");
        let parsed = swf::parse_swf(&buf).expect("parse");

        let do_actions: Vec<&[u8]> = parsed
            .tags
            .iter()
            .filter_map(|t| match t {
                Tag::DoAction(b) => Some(*b),
                _ => None,
            })
            .collect();
        assert_eq!(do_actions.len(), 1, "exactly one frame carries a stop()");
        assert_eq!(decode_actions(do_actions[0]), vec![Action::Stop]);

        // The DoAction sits before the first ShowFrame (frame 1's keyframe).
        let do_idx = parsed
            .tags
            .iter()
            .position(|t| matches!(t, Tag::DoAction(_)))
            .unwrap();
        let first_sf = parsed
            .tags
            .iter()
            .position(|t| matches!(t, Tag::ShowFrame))
            .unwrap();
        assert!(
            do_idx < first_sf,
            "stop() runs on frame 1, before its ShowFrame"
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
        assert_eq!(
            sprites[0].num_frames as usize,
            movie(2, FIXTURE_FPS),
            "clip's own 2-keyframe timeline, upsampled with the root"
        );

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
        assert_eq!(
            parsed.header.num_frames() as usize,
            movie(1, FIXTURE_FPS),
            "root is one document frame, upsampled"
        );
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

    /// The rest of the header, for the reason the framerate bug existed: these fields are
    /// written once and never appear in the tag stream, so the structural oracle walking tags
    /// cannot see them and the goldens rendering one frame cannot either. Framerate sat in
    /// that gap for the project's whole life. Everything else living there gets an assertion
    /// here so the gap is covered rather than re-discovered one field at a time.
    #[test]
    fn header_carries_the_document_not_defaults() {
        use wick::{Contour, Document, Frame, Layer};

        let doc = Document {
            width: 640.0,
            height: 360.0,
            framerate: 30.0,
            background: swf::Color::WHITE,
            layers: vec![Layer {
                frames: vec![
                    Frame {
                        start: 1,
                        end: 3,
                        contours: vec![Contour {
                            points: vec![(0.0, 0.0), (10.0, 0.0), (5.0, 10.0)],
                            holes: vec![],
                            closed: true,
                            fill: Some(wick::Fill::Solid(swf::Color::from_rgb(0x00ff00, 255))),
                            stroke: None,
                        }],
                        clips: vec![],
                        scripts: Vec::new(),
                        tweens: vec![],
                    },
                    Frame {
                        start: 4,
                        end: 5,
                        contours: vec![Contour {
                            points: vec![(20.0, 0.0), (30.0, 0.0), (25.0, 10.0)],
                            holes: vec![],
                            closed: true,
                            fill: Some(wick::Fill::Solid(swf::Color::from_rgb(0x0000ff, 255))),
                            stroke: None,
                        }],
                        clips: vec![],
                        scripts: Vec::new(),
                        tweens: vec![],
                    },
                ],
            }],
            skipped: Default::default(),
        };

        let swf_bytes = compile_document(&doc).expect("compile");
        let buf = swf::decompress_swf(&swf_bytes[..]).expect("decompress");
        let parsed = swf::parse_swf(&buf).expect("parse");
        let header = &parsed.header;

        // Stage size. Nothing asserted this before, so a document's dimensions reached the
        // header on trust alone — the same standing this framerate had.
        let stage = header.stage_size();
        assert_eq!(stage.x_min, Twips::ZERO, "stage starts at the origin");
        assert_eq!(stage.y_min, Twips::ZERO);
        assert_eq!(
            stage.x_max,
            Twips::from_pixels(640.0),
            "width -> stage x_max"
        );
        assert_eq!(
            stage.y_max,
            Twips::from_pixels(360.0),
            "height -> stage y_max"
        );

        // SWF 8: PRESS clip events need 6+, and DefineShape4 and LineStyle2 are already in
        // use. Dropping below 8 silently loses click handlers.
        assert_eq!(header.version(), 8, "version 8 is what clip PRESS requires");
        assert_eq!(header.compression(), swf::Compression::None);

        // num_frames is caller-supplied rather than derived by the writer, so it can disagree
        // with the number of frames actually emitted. A player trusts the header: too high
        // stalls on blank frames, too low truncates the movie. Both render every individual
        // frame correctly, which is exactly why neither oracle would notice.
        let show_frames = parsed
            .tags
            .iter()
            .filter(|t| matches!(t, Tag::ShowFrame))
            .count();
        assert_eq!(
            show_frames,
            movie(5, 30.0),
            "frames 1..=5 across two keyframes, upsampled"
        );
        assert_eq!(
            header.num_frames() as usize,
            show_frames,
            "header count must equal the ShowFrames actually written"
        );
    }

    /// The header rate must be whatever the document says, not a constant. It was
    /// hardcoded to 24 while every fixture is 12, so everything twip ever exported played at
    /// double speed — every frame correct, the whole movie wrong. Asserting against a real
    /// fixture alone would pass again if someone swapped one constant for another, so this
    /// picks a rate no default would produce.
    #[test]
    fn header_framerate_comes_from_the_document() {
        use wick::{Contour, Document, Frame, Layer};

        // Contour is not Clone, so build a fresh one per iteration.
        let dot = || Contour {
            points: vec![(0.0, 0.0), (10.0, 0.0), (5.0, 10.0)],
            holes: vec![],
            closed: true,
            fill: Some(wick::Fill::Solid(swf::Color::from_rgb(0xff0000, 255))),
            stroke: None,
        };
        for rate in [12.0, 24.0, 30.0, 59.94] {
            let doc = Document {
                width: 100.0,
                height: 100.0,
                framerate: rate,
                background: swf::Color::WHITE,
                layers: vec![Layer {
                    frames: vec![Frame {
                        start: 1,
                        end: 1,
                        contours: vec![dot()],
                        clips: vec![],
                        scripts: Vec::new(),
                        tweens: vec![],
                    }],
                }],
                skipped: Default::default(),
            };
            let swf = compile_document(&doc).expect("compile");
            let buf = swf::decompress_swf(&swf[..]).expect("decompress");
            let parsed = swf::parse_swf(&buf).expect("parse");
            // Fixed8 has 1/256 resolution, so 59.94 lands within a fraction of a frame. The
            // rates here upsample by 5, 2, 2 and 1 respectively, so the factor is part of
            // what's under test rather than a constant multiplier.
            assert!(
                (parsed.header.frame_rate().to_f32() - movie_fps(rate)).abs() < 0.01,
                "header carried {} for a document at {rate}, expected {}",
                parsed.header.frame_rate().to_f32(),
                movie_fps(rate)
            );
        }
    }

    /// A framerate the header cannot hold has to fail loudly, because the alternative is
    /// silent: `Fixed8::from_f64` saturates, and the editor lets a project go to 9999. The
    /// pair matters more than either half — 127 must still compile, or "refuse above the
    /// ceiling" would be indistinguishable from "refuse anything unusual".
    #[test]
    fn framerate_above_the_header_ceiling_is_refused() {
        use wick::{Contour, Document, Frame, Layer};

        let doc = |rate: f64| Document {
            width: 100.0,
            height: 100.0,
            framerate: rate,
            background: swf::Color::WHITE,
            layers: vec![Layer {
                frames: vec![Frame {
                    start: 1,
                    end: 1,
                    contours: vec![Contour {
                        points: vec![(0.0, 0.0), (10.0, 0.0), (5.0, 10.0)],
                        holes: vec![],
                        closed: true,
                        fill: Some(wick::Fill::Solid(swf::Color::from_rgb(0xff0000, 255))),
                        stroke: None,
                    }],
                    clips: vec![],
                    scripts: Vec::new(),
                    tweens: vec![],
                }],
            }],
            skipped: Default::default(),
        };

        let ceiling = Fixed8::MAX.to_f64();
        let err = compile_document(&doc(200.0)).expect_err("200 fps cannot be stored");
        let msg = format!("{err:#}");
        assert!(msg.contains("200"), "the message must name the rate: {msg}");
        assert!(
            msg.contains(&format!("{ceiling}")),
            "the message must name the ceiling: {msg}"
        );

        // Right at the ceiling still compiles, and round-trips to itself.
        let swf = compile_document(&doc(ceiling)).expect("the ceiling itself is representable");
        let buf = swf::decompress_swf(&swf[..]).expect("decompress");
        let parsed = swf::parse_swf(&buf).expect("parse");
        assert_eq!(parsed.header.frame_rate().to_f64(), ceiling);
    }

    #[test]
    fn frame_by_frame_timeline() {
        use wick::{Contour, Document, Frame, Layer};

        let triangle = |x: f64| Contour {
            points: vec![(x, 0.0), (x + 10.0, 0.0), (x + 5.0, 10.0)],
            holes: vec![],
            closed: true,
            fill: Some(wick::Fill::Solid(swf::Color::from_rgb(0xff0000, 255))),
            stroke: None,
        };
        let doc = Document {
            width: 100.0,
            height: 100.0,
            framerate: 12.0,
            background: swf::Color::WHITE,
            layers: vec![Layer {
                frames: vec![
                    Frame {
                        start: 1,
                        end: 1,
                        contours: vec![triangle(0.0)],
                        clips: vec![],
                        scripts: Vec::new(),
                        tweens: vec![],
                    },
                    Frame {
                        start: 2,
                        end: 2,
                        contours: vec![triangle(50.0)],
                        clips: vec![],
                        scripts: Vec::new(),
                        tweens: vec![],
                    },
                ],
            }],
            skipped: Default::default(),
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
        assert_eq!(
            count(&|t| matches!(t, Tag::ShowFrame)),
            movie(2, 12.0),
            "two frames, upsampled"
        );
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

    fn straight_edges(shape: &Shape) -> usize {
        shape
            .shape
            .iter()
            .filter(|r| matches!(r, ShapeRecord::StraightEdge { .. }))
            .count()
    }

    fn first_style_change(shape: &Shape) -> &StyleChangeData {
        match &shape.shape[0] {
            ShapeRecord::StyleChange(s) => s,
            _ => panic!("first record is not a style change"),
        }
    }

    #[test]
    fn stroke_only_open_path_emits_line_no_fill() {
        use swf::{LineCapStyle, LineJoinStyle};
        // An open 3-point polyline with a stroke and no fill: line style set, no fill
        // style, and no closing edge (2 edges for 3 points, not 3).
        let contour = Contour {
            points: vec![(0.0, 0.0), (50.0, 0.0), (50.0, 50.0)],
            holes: vec![],
            closed: false,
            fill: None,
            stroke: Some(wick::Stroke {
                color: Color::from_rgb(0xff0000, 255),
                width: 4.0,
                cap: wick::StrokeCap::Round,
                join: wick::StrokeJoin::Bevel,
                miter_limit: 10.0,
            }),
        };
        let shape = contour_to_shape(7, &contour);

        assert!(shape.styles.fill_styles.is_empty(), "no fill");
        assert_eq!(shape.styles.line_styles.len(), 1, "one line style");
        let ls = &shape.styles.line_styles[0];
        assert_eq!(ls.width(), Twips::from_pixels(4.0));
        assert_eq!(
            *ls.fill_style(),
            FillStyle::Color(Color::from_rgb(0xff0000, 255))
        );
        assert_eq!(ls.start_cap(), LineCapStyle::Round);
        assert_eq!(ls.end_cap(), LineCapStyle::Round);
        assert_eq!(ls.join_style(), LineJoinStyle::Bevel);
        assert!(
            !ls.allow_close(),
            "open path does not auto-close the stroke"
        );

        let sc = first_style_change(&shape);
        assert_eq!(sc.fill_style_1, None, "no fill index");
        assert_eq!(sc.line_style, Some(1), "line style index 1");
        assert_eq!(straight_edges(&shape), 2, "3 points, open -> 2 edges");
    }

    #[test]
    fn filled_stroked_closed_path_emits_both() {
        use swf::{LineCapStyle, LineJoinStyle};
        // A closed square with both a fill and a stroke: both style arrays populated,
        // both indices on the style change, and a closing edge (4 edges for 4 points).
        let contour = Contour {
            points: vec![(0.0, 0.0), (40.0, 0.0), (40.0, 40.0), (0.0, 40.0)],
            holes: vec![],
            closed: true,
            fill: Some(wick::Fill::Solid(Color::from_rgb(0x00ff00, 255))),
            stroke: Some(wick::Stroke {
                color: Color::from_rgb(0x000000, 255),
                width: 2.0,
                cap: wick::StrokeCap::Butt,
                join: wick::StrokeJoin::Miter,
                miter_limit: 10.0,
            }),
        };
        let shape = contour_to_shape(8, &contour);

        assert_eq!(shape.styles.fill_styles.len(), 1, "one fill");
        assert_eq!(shape.styles.line_styles.len(), 1, "one line");
        let ls = &shape.styles.line_styles[0];
        assert_eq!(ls.width(), Twips::from_pixels(2.0));
        assert_eq!(
            ls.start_cap(),
            LineCapStyle::None,
            "paper.js butt -> SWF no cap"
        );
        assert_eq!(
            ls.join_style(),
            LineJoinStyle::Miter(Fixed8::from_f64(10.0))
        );
        assert!(ls.allow_close(), "closed path auto-closes the stroke");

        let sc = first_style_change(&shape);
        assert_eq!(sc.fill_style_1, Some(1), "fill index 1");
        assert_eq!(sc.line_style, Some(1), "line index 1");
        assert_eq!(straight_edges(&shape), 4, "4 points, closed -> 4 edges");
    }

    // Twice the signed area of a twip ring (shoelace). Sign encodes winding; magnitude
    // distinguishes the big outer boundary from a small hole.
    fn signed_area2(ring: &[(i32, i32)]) -> i64 {
        let n = ring.len();
        let mut a: i64 = 0;
        for i in 0..n {
            let (x0, y0) = ring[i];
            let (x1, y1) = ring[(i + 1) % n];
            a += i64::from(x0) * i64::from(y1) - i64::from(x1) * i64::from(y0);
        }
        a
    }

    #[test]
    fn planarize_makes_donut_hole() {
        // Outer square and an OPPOSITELY-wound inner square (how paper.js/potrace encode
        // a hole). Under non-zero, i_overlay must return the outer plus a hole wound the
        // other way -- not a solid-filled square.
        let outer = vec![(0, 0), (100, 0), (100, 100), (0, 100)];
        let hole = vec![(30, 30), (30, 70), (70, 70), (70, 30)]; // reversed orientation
        let rings = planarize(&[outer, hole]);

        assert_eq!(rings.len(), 2, "outer boundary + one hole survive");
        let a0 = signed_area2(&rings[0]);
        let a1 = signed_area2(&rings[1]);
        assert!(
            a0.signum() != a1.signum(),
            "outer and hole wind opposite ({a0} vs {a1})"
        );
        assert!(a0.abs() > a1.abs(), "index 0 is the larger outer boundary");
        assert_eq!(a1.abs(), 2 * 40 * 40, "the 40x40 hole is preserved");
    }

    #[test]
    fn planarize_splits_figure_eight() {
        // A self-crossing bowtie as a single contour. Under non-zero, i_overlay resolves
        // the crossing into two separate lobes (two output shapes -> two rings here).
        let bowtie = vec![(0, 0), (10, 10), (10, 0), (0, 10)];
        let rings = planarize(&[bowtie]);
        assert_eq!(rings.len(), 2, "crossing resolved into two lobes");
        for r in &rings {
            assert!(r.len() >= 3, "each lobe is a real polygon");
        }
    }

    /// Phase 1d: a nested clip compiles to a DefineSprite (its own timeline) that the
    /// root places once, carrying the clip's transform. Definitions hoist to the root.
    #[test]
    fn nested_clip_emits_sprite() {
        use wick::{Clip, Contour, Document, Frame, Layer};

        let tri = |x: f64| Contour {
            points: vec![(x, 0.0), (x + 10.0, 0.0), (x + 5.0, 10.0)],
            holes: vec![],
            closed: true,
            fill: Some(wick::Fill::Solid(swf::Color::from_rgb(0x00ff00, 255))),
            stroke: None,
        };
        // A clip whose OWN timeline is a 2-keyframe animation, placed at (100, 50).
        let clip = Clip {
            scripts: Vec::new(),
            transform: Transform {
                x: 100.0,
                y: 50.0,
                scale_x: 1.0,
                scale_y: 1.0,
                rotation_deg: 0.0,
                skew_deg: 0.0,
                opacity: 1.0,
            },
            layers: vec![Layer {
                frames: vec![
                    Frame {
                        start: 1,
                        end: 1,
                        contours: vec![tri(0.0)],
                        clips: vec![],
                        scripts: Vec::new(),
                        tweens: vec![],
                    },
                    Frame {
                        start: 2,
                        end: 2,
                        contours: vec![tri(20.0)],
                        clips: vec![],
                        scripts: Vec::new(),
                        tweens: vec![],
                    },
                ],
            }],
        };
        let doc = Document {
            width: 200.0,
            height: 200.0,
            framerate: 12.0,
            background: swf::Color::WHITE,
            layers: vec![Layer {
                frames: vec![Frame {
                    start: 1,
                    end: 1,
                    contours: vec![],
                    clips: vec![clip],
                    scripts: Vec::new(),
                    tweens: vec![],
                }],
            }],
            skipped: Default::default(),
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
        assert_eq!(
            sprites[0].num_frames as usize,
            movie(2, FIXTURE_FPS),
            "the sprite's own 2-keyframe timeline, upsampled with the root"
        );
        // A sprite that kept its document-frame count would drift against a root running k
        // times faster, so the nested control stream has to be resampled too.
        let inner_shows = sprites[0]
            .tags
            .iter()
            .filter(|t| matches!(t, Tag::ShowFrame))
            .count();
        assert_eq!(
            inner_shows,
            movie(2, FIXTURE_FPS),
            "sprite timeline shows two document frames' worth"
        );

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
        assert_eq!(
            parsed.header.num_frames() as usize,
            movie(1, FIXTURE_FPS),
            "root timeline is one document frame"
        );
    }

    /// Phase 1e parser: a real motion-tween `.wick` drawn via the Wick engine. One clip
    /// tweened across a 24-frame span from (90, 300) scale 1 opacity 1 to (460, 100)
    /// scale 2.5 opacity 0.3. Validates the tween parser against Wick's own serialization
    /// (playheadPosition frame-relative, transform absolute — confirmed against the engine).
    /// The only fixture written by the engine that actually ships. Every other one came off
    /// wickeditor.com in 2021 (`wickengine 2021.1.22.14.13.2`); this one says
    /// `2026.7.24.16.26.12`, authored through the real Rectangle tool and the engine's own
    /// `createTween` by `editor/dev/make-fixture.mjs`. Without it the parser is only ever
    /// tested against a serialization no code in this repo produces, so a field that moved in
    /// five years of fork history would mis-parse every real save while the suite stayed green.
    #[test]
    fn compiles_editor_authored_wick() {
        let bytes = include_bytes!("../fixtures/editor-tween.wick");
        let swf = compile_wick(bytes).expect("compile a save from the shipping engine");
        let buf = swf::decompress_swf(&swf[..]).expect("decompress");
        let parsed = swf::parse_swf(&buf).expect("parse");
        let count = |f: &dyn Fn(&Tag) -> bool| parsed.tags.iter().filter(|t| f(t)).count();

        // The project's own settings, not the compiler's defaults.
        assert_eq!(
            parsed.header.num_frames() as usize,
            movie(24, FIXTURE_FPS),
            "frames 1..=24, upsampled"
        );
        assert_eq!(
            parsed.header.frame_rate().to_f32(),
            (FIXTURE_FPS * f64::from(upsample_factor(FIXTURE_FPS))) as f32,
            "12fps document plays as a 60fps movie"
        );
        assert_eq!(
            parsed.header.stage_size().x_max,
            Twips::from_pixels(720.0),
            "the editor's default stage is 720x480, not the compiler's 550x400"
        );

        // createTween wraps the lone path in a Clip, so the shape rides inside a sprite.
        assert_eq!(
            count(&|t| matches!(t, Tag::DefineShape(_))),
            1,
            "one rectangle"
        );
        let sprites: Vec<_> = parsed
            .tags
            .iter()
            .filter_map(|t| match t {
                Tag::DefineSprite(s) => Some(s),
                _ => None,
            })
            .collect();
        assert_eq!(sprites.len(), 1, "the clip createTween wrapped it in");

        // A tween animates by re-placing the same depth every frame.
        let places: Vec<_> = parsed
            .tags
            .iter()
            .filter_map(|t| match t {
                Tag::PlaceObject(p) => Some(p),
                _ => None,
            })
            .collect();
        let n = tween_samples(24, FIXTURE_FPS);
        assert_eq!(
            places.len(),
            n,
            "one placement per movie frame across the span"
        );

        // Endpoints come from the tween objects the engine wrote: x 269.3 -> 589.3.
        let tx = |i: usize| places[i].matrix.expect("placement has a matrix").tx;
        assert_eq!(tx(0), Twips::from_pixels(269.3), "first key's x");
        assert_eq!(tx(n - 1), Twips::from_pixels(589.3), "last key's x");

        // The first key eases out-bounce, so the path between the endpoints must not be the
        // straight line. This is the assertion that proves easingType survived the modern
        // serialization — dropping it to 'none' leaves both endpoints correct and only the
        // interior wrong, which is precisely what nothing else here would catch.
        //
        // Compare against the real linear curve at each frame, not against the midpoint of
        // the endpoints: frame 12 of a 24-frame span sits at t=11/23, so it differs from that
        // midpoint under any easing at all and asserting on it proves nothing. Checked by
        // forcing `ease` to return k and confirming this fails.
        let (x0, x1) = (269.3_f64, 589.3_f64);
        let worst = (0..n)
            .map(|i| {
                let linear = x0 + (x1 - x0) * (i as f64) / (n - 1) as f64;
                (tx(i).to_pixels() - linear).abs()
            })
            .fold(0.0_f64, f64::max);
        assert!(
            worst > 5.0,
            "out-bounce should depart from the straight line by more than 5px somewhere; \
             worst departure was {worst:.2}px, which is what a dropped easingType looks like"
        );
    }

    /// A curve drawn in the graph editor, carried by a real save, arriving in the movie.
    ///
    /// `custom-easing.wick` was authored by `editor/dev/make-fixture.mjs` through the shipping
    /// engine, so it holds a `bezier` field written by the same code the browser preview eases
    /// with. That field exists nowhere upstream — this is the whole of the divergence, and
    /// this test is where it either survives the trip or does not.
    ///
    /// The control points [0.9, 0.05, 0.95, 0.4] hold the motion back and let it go late, so
    /// the curve runs well BELOW the straight line for most of the span. Asserting on a
    /// signed departure rather than an absolute one is deliberate: `worst > 5.0` alone would
    /// also pass for out-bounce, for in-back, and for any other easing that merely is not
    /// linear, so it would not notice `bezier` being dropped and the tween falling back to a
    /// named curve. Below the line, by a lot, is this curve and not another.
    #[test]
    fn compiles_custom_easing_wick() {
        let bytes = include_bytes!("../fixtures/custom-easing.wick");
        let swf = compile_wick(bytes).expect("compile a save carrying a drawn curve");
        let buf = swf::decompress_swf(&swf[..]).expect("decompress");
        let parsed = swf::parse_swf(&buf).expect("parse");

        let places: Vec<_> = parsed
            .tags
            .iter()
            .filter_map(|t| match t {
                Tag::PlaceObject(p) => Some(p),
                _ => None,
            })
            .collect();
        let n = tween_samples(24, FIXTURE_FPS);
        assert_eq!(
            places.len(),
            n,
            "one placement per movie frame across the span"
        );

        let tx = |i: usize| {
            places[i]
                .matrix
                .expect("placement has a matrix")
                .tx
                .to_pixels()
        };
        let (x0, x1) = (tx(0), tx(n - 1));
        assert!(
            (x1 - x0).abs() > 100.0,
            "the fixture moves the clip a long way: {x0} -> {x1}"
        );

        // How far behind the straight line the motion runs, at its worst.
        let mut lag = 0.0_f64;
        for i in 0..n {
            let linear = x0 + (x1 - x0) * (i as f64) / (n - 1) as f64;
            lag = lag.max(linear - tx(i));
        }
        assert!(
            lag > 40.0,
            "a curve that holds until late should trail the straight line by a wide margin; \
             worst lag was {lag:.2}px, which is what a dropped bezier looks like"
        );

        // And the curve the file names is the curve the engine drew, sample for sample.
        // The placements above are the compiler's own arithmetic; these three numbers come
        // from `Wick.Tween.cubicBezierEase` running in a browser against this same curve, so
        // this is the independent statement that the two implementations agree rather than
        // Rust confirming its own opinion.
        let curve = [0.9, 0.05, 0.95, 0.4];
        for (k, want) in [(0.25_f64, 0.024645_f64), (0.5, 0.082697), (0.75, 0.220556)] {
            let got = cubic_bezier_ease(curve, k);
            assert!(
                (got - want).abs() < 1e-6,
                "the fixture's curve at {k} is {got}, the engine says {want}"
            );
        }
    }

    #[test]
    fn compiles_motion_tween_wick() {
        let bytes = include_bytes!("../fixtures/motion-tween.wick");
        let swf = compile_wick(bytes).expect("compile motion-tween.wick");
        let buf = swf::decompress_swf(&swf[..]).expect("decompress");
        let parsed = swf::parse_swf(&buf).expect("parse");
        let count = |f: &dyn Fn(&Tag) -> bool| parsed.tags.iter().filter(|t| f(t)).count();

        assert_eq!(
            parsed.header.num_frames() as usize,
            movie(24, FIXTURE_FPS),
            "24-frame tween span, upsampled"
        );
        assert_eq!(
            count(&|t| matches!(t, Tag::DefineSprite(_))),
            1,
            "the tweened clip -> one sprite"
        );
        assert_eq!(
            count(&|t| matches!(t, Tag::DefineShape(_))),
            1,
            "the clip's blue square, hoisted to the root"
        );
        assert_eq!(
            count(&|t| matches!(t, Tag::ShowFrame)),
            movie(24, FIXTURE_FPS),
            "24 document frames' worth"
        );
        assert_eq!(
            count(&|t| matches!(t, Tag::RemoveObject(_))),
            0,
            "same sprite held throughout — never removed"
        );
        // One Place (frame 1) + a Modify every subsequent movie frame as the tween moves.
        assert_eq!(
            count(&|t| matches!(t, Tag::PlaceObject(_))),
            tween_samples(24, FIXTURE_FPS),
            "place once, then modify per movie frame"
        );

        let places: Vec<&PlaceObject> = parsed
            .tags
            .iter()
            .filter_map(|t| match t {
                Tag::PlaceObject(po) => Some(po.as_ref()),
                _ => None,
            })
            .collect();
        // The first is the Place at the tween's start transform.
        assert!(
            matches!(places[0].action, PlaceObjectAction::Place(_)),
            "first is a Place"
        );
        assert_eq!(
            places[0].matrix.unwrap().tx.get(),
            Twips::from_pixels(90.0).get(),
            "frame 1 x = 90"
        );
        assert_eq!(
            places[0].color_transform.unwrap().a_multiply,
            Fixed8::from_f64(1.0),
            "frame 1 opacity 1.0"
        );
        // The last lands on the tween's end transform.
        let last = places[places.len() - 1];
        assert!(
            matches!(last.action, PlaceObjectAction::Modify),
            "subsequent frames are Modify"
        );
        assert_eq!(
            last.matrix.unwrap().tx.get(),
            Twips::from_pixels(460.0).get(),
            "frame 24 x = 460"
        );
        assert_eq!(
            last.color_transform.unwrap().a_multiply,
            Fixed8::from_f64(0.3),
            "frame 24 opacity 0.3"
        );

        // Everything above looks only at the two ends, and this tween is built so that the
        // ends cannot show a whole class of error. It rotates 0 -> 180 degrees, so
        // sin(rotation) is zero at BOTH endpoints: the matrix b and c terms are 0 on frame 1
        // and frame 24 and nonzero on all 22 frames between. Emit them transposed, or with a
        // sign flip, or drop the rotation entirely, and every assertion above still passes.
        //
        // So walk the whole span against the interpolation the tween describes rather than
        // spot-checking a middle frame. Easing is 'none' here, so t is linear in the frame
        // index; the transform channels come from the fixture's two keys (x 90->460,
        // y 300->100, scale 1->2.5, rotation 0->180, opacity 1->0.3).
        //
        // The walk runs over movie frames, so four of every five values it checks are
        // positions no document frame names. That is the point: it is the assertion that
        // upsampling resamples the curve rather than holding each drawn frame k times.
        let lerp = |a: f64, b: f64, t: f64| a + (b - a) * t;
        let last_i = (places.len() - 1) as f64;
        for (i, place) in places.iter().enumerate() {
            let t = i as f64 / last_i;
            let s = lerp(1.0, 2.5, t);
            let rot = lerp(0.0, 180.0, t).to_radians();
            let m = place.matrix.expect("every frame carries a matrix");
            // Fixed16 is 1/65536, Twips 1/20 px; the slack is for the conversion, not the math.
            let close = |got: f64, want: f64, what: &str| {
                assert!(
                    (got - want).abs() < 1e-4,
                    "frame {} {what}: got {got}, want {want}",
                    i + 1
                );
            };
            close(m.a.to_f64(), s * rot.cos(), "a = scale*cos");
            close(m.b.to_f64(), s * rot.sin(), "b = scale*sin");
            close(m.c.to_f64(), -s * rot.sin(), "c = -scale*sin");
            close(m.d.to_f64(), s * rot.cos(), "d = scale*cos");
            assert_eq!(
                m.tx,
                Twips::from_pixels(lerp(90.0, 460.0, t)),
                "frame {} x",
                i + 1
            );
            assert_eq!(
                m.ty,
                Twips::from_pixels(lerp(300.0, 100.0, t)),
                "frame {} y",
                i + 1
            );
            assert_eq!(
                place.color_transform.expect("cxform").a_multiply,
                Fixed8::from_f64(lerp(1.0, 0.3, t)),
                "frame {} opacity",
                i + 1
            );
        }

        // The premise the loop rests on: b really is zero at both ends and not in between,
        // so the endpoint assertions above genuinely cannot see these terms.
        assert_eq!(places[0].matrix.unwrap().b, Fixed16::from_f64(0.0));
        assert!(last.matrix.unwrap().b.to_f64().abs() < 1e-4);
        // Halfway is rotation 90 degrees, where sin is 1 and scale is 1.75.
        assert!(
            places[places.len() / 2].matrix.unwrap().b.to_f64().abs() > 0.9,
            "mid-span b is large, which is what the ends hide"
        );
    }

    /// Phase 1e: a motion tween on a clip. Two tween keys (x=0 at playhead 1, x=100 at
    /// playhead 5) over a 5-frame span → the sprite is placed once and Modified each frame
    /// with a linearly interpolated x: 0, 25, 50, 75, 100 pixels.
    // The oracle table below holds tween.js output verbatim; some values happen to be
    // math constants (out-sine at t=0.5 is 1/sqrt(2)). They must stay as the literal the
    // engine produced, not be swapped for a std constant, so silence approx_constant.
    #[allow(clippy::approx_constant)]
    #[test]
    fn easing_matches_tween_js() {
        // Oracle values sampled from the Wick engine's own tween.js (`TWEEN.Easing`) at
        // t = 0, 0.25, 0.5, 0.75, 1. That file is vendored at `editor/engine/lib/Tween.js`;
        // regenerate by evaluating it and reading `TWEEN.Easing` at those same five t.
        let ts = [0.0f64, 0.25, 0.5, 0.75, 1.0];
        #[rustfmt::skip]
        let cases: &[(&str, [f64; 5])] = &[
            ("none", [0.000000000000, 0.250000000000, 0.500000000000, 0.750000000000, 1.000000000000]),
            ("in", [0.000000000000, 0.062500000000, 0.250000000000, 0.562500000000, 1.000000000000]),
            ("out", [0.000000000000, 0.437500000000, 0.750000000000, 0.937500000000, 1.000000000000]),
            ("in-out", [0.000000000000, 0.125000000000, 0.500000000000, 0.875000000000, 1.000000000000]),
            ("in-cubic", [0.000000000000, 0.015625000000, 0.125000000000, 0.421875000000, 1.000000000000]),
            ("out-cubic", [0.000000000000, 0.578125000000, 0.875000000000, 0.984375000000, 1.000000000000]),
            ("in-out-cubic", [0.000000000000, 0.062500000000, 0.500000000000, 0.937500000000, 1.000000000000]),
            ("in-quartic", [0.000000000000, 0.003906250000, 0.062500000000, 0.316406250000, 1.000000000000]),
            ("out-quartic", [0.000000000000, 0.683593750000, 0.937500000000, 0.996093750000, 1.000000000000]),
            ("in-out-quartic", [0.000000000000, 0.031250000000, 0.500000000000, 0.968750000000, 1.000000000000]),
            ("in-quintic", [0.000000000000, 0.000976562500, 0.031250000000, 0.237304687500, 1.000000000000]),
            ("out-quintic", [0.000000000000, 0.762695312500, 0.968750000000, 0.999023437500, 1.000000000000]),
            ("in-out-quintic", [0.000000000000, 0.015625000000, 0.500000000000, 0.984375000000, 1.000000000000]),
            ("in-sine", [0.000000000000, 0.076120467489, 0.292893218813, 0.617316567635, 1.000000000000]),
            ("out-sine", [0.000000000000, 0.382683432365, 0.707106781187, 0.923879532511, 1.000000000000]),
            ("in-out-sine", [0.000000000000, 0.146446609407, 0.500000000000, 0.853553390593, 1.000000000000]),
            ("in-exp", [0.000000000000, 0.005524271728, 0.031250000000, 0.176776695297, 1.000000000000]),
            ("out-exp", [0.000000000000, 0.823223304703, 0.968750000000, 0.994475728272, 1.000000000000]),
            ("in-out-exp", [0.000000000000, 0.015625000000, 0.500000000000, 0.984375000000, 1.000000000000]),
            ("in-circle", [0.000000000000, 0.031754163448, 0.133974596216, 0.338562172234, 1.000000000000]),
            ("out-circle", [0.000000000000, 0.661437827766, 0.866025403784, 0.968245836552, 1.000000000000]),
            ("in-out-circle", [0.000000000000, 0.066987298108, 0.500000000000, 0.933012701892, 1.000000000000]),
            ("in-back", [0.000000000000, -0.064136562500, -0.087697500000, 0.182590312500, 1.000000000000]),
            ("out-back", [0.000000000000, 0.817409687500, 1.087697500000, 1.064136562500, 1.000000000000]),
            ("in-out-back", [0.000000000000, -0.099681843750, 0.500000000000, 1.099681843750, 1.000000000000]),
            ("in-bounce", [0.000000000000, 0.027343750000, 0.234375000000, 0.527343750000, 1.000000000000]),
            ("out-bounce", [0.000000000000, 0.472656250000, 0.765625000000, 0.972656250000, 1.000000000000]),
            ("in-out-bounce", [0.000000000000, 0.117187500000, 0.500000000000, 0.882812500000, 1.000000000000]),
        ];
        for (name, expected) in cases {
            for (i, &t) in ts.iter().enumerate() {
                let got = ease(name, t);
                assert!(
                    (got - expected[i]).abs() < 1e-9,
                    "ease({name:?}, {t}) = {got}, tween.js = {}",
                    expected[i]
                );
            }
        }
        // Unknown names fall back to linear, like the engine's `easingType || 'none'`.
        assert_eq!(ease("bogus", 0.42), 0.42);
    }

    /// The drawn curve has to be the same curve in both places, or the graph editor shows one
    /// motion and the exported movie plays another.
    ///
    /// Oracle values sampled from `Wick.Tween.cubicBezierEase` running in a browser against
    /// the built engine; regenerate by evaluating that function at these same seven t. The
    /// last two curves are the ones worth having: an overshoot, which must be allowed to
    /// exceed 1 the way out-back does, and a nearly vertical rise, where Newton's derivative
    /// gets small enough to hand over to bisection. A solver that quietly clamped or gave up
    /// would still look right on the first six.
    #[test]
    fn easing_matches_bezier_js() {
        let ts = [0.0f64, 0.125, 0.25, 0.5, 0.75, 0.875, 1.0];
        #[rustfmt::skip]
        let cases: &[([f64; 4], [f64; 7])] = &[
            // ease-in-out (the default)
            ([0.42, 0.00, 0.58, 1.00], [0.000000000000, 0.031114036910, 0.129161900569, 0.500000000000, 0.870838099431, 0.968885963090, 1.000000000000]),
            // linear as a curve
            ([0.00, 0.00, 1.00, 1.00], [0.000000000000, 0.125000000008, 0.250000001431, 0.500000000000, 0.749999998569, 0.874999999992, 1.000000000000]),
            // ease-in
            ([0.42, 0.00, 1.00, 1.00], [0.000000000000, 0.025984598530, 0.093464650994, 0.315356812506, 0.621861869174, 0.801419984040, 1.000000000000]),
            // ease-out
            ([0.00, 0.00, 0.58, 1.00], [0.000000000000, 0.198580015960, 0.378138130826, 0.684643187494, 0.906535349006, 0.974015401470, 1.000000000000]),
            // CSS ease
            ([0.25, 0.10, 0.25, 1.00], [0.000000000000, 0.136888414854, 0.408510593016, 0.802403387695, 0.960458978349, 0.990969002600, 1.000000000000]),
            // overshoot past 1
            ([0.34, 1.56, 0.64, 1.00], [0.000000000000, 0.488203825824, 0.816289114743, 1.087400670219, 1.059646859960, 1.018962237753, 1.000000000000]),
            // anticipate below 0
            ([0.36, -0.64, 0.66, -0.56], [0.000000000000, -0.195105773259, -0.325718175476, -0.331034431570, 0.093135733907, 0.485866987492, 1.000000000000]),
            // near-vertical, where Newton gives up
            ([0.00, 0.90, 0.02, 1.00], [0.000000000000, 0.829118930493, 0.919591002821, 0.980180668994, 0.996819874455, 0.999346644135, 1.000000000000]),
        ];
        for (bezier, expected) in cases {
            for (i, &t) in ts.iter().enumerate() {
                let got = cubic_bezier_ease(*bezier, t);
                assert!(
                    (got - expected[i]).abs() < 1e-9,
                    "cubic_bezier_ease({bezier:?}, {t}) = {got}, the engine says {}",
                    expected[i]
                );
            }
        }

        // Overshoot is the point of allowing y outside [0, 1]; a clamp here would pass every
        // sample above and still flatten the motion the author drew.
        let peak = (0..=100)
            .map(|i| cubic_bezier_ease([0.34, 1.56, 0.64, 1.0], f64::from(i) / 100.0))
            .fold(f64::MIN, f64::max);
        assert!(
            peak > 1.05,
            "overshoot curve peaked at {peak}, expected past 1"
        );
    }

    /// A tween from a file written before custom curves existed, which is every .wick anyone
    /// has today. No `bezier` key, so nothing to read; the named easing decides, exactly as it
    /// did. The failure this refuses is a compiler that treats a missing field as a reason to
    /// give up on the curve and go linear.
    #[test]
    fn a_tween_without_a_bezier_eases_by_name() {
        for name in ["none", "in-out", "out-bounce", "in-back"] {
            for t in [0.0f64, 0.25, 0.5, 0.75, 1.0] {
                assert_eq!(
                    ease_curve(name, None, t),
                    ease(name, t),
                    "{name} at {t} changed when bezier went missing"
                );
            }
        }
        // And a file naming the curve without carrying its points is linear, not a panic.
        assert_eq!(ease_curve("custom", None, 0.42), 0.42);
    }

    /// The stage colour has to be in the movie, and early in it.
    ///
    /// A player that finds no SetBackgroundColor uses its own default, which is white — so
    /// this was invisible on every fixture in the tree, all of which are white stages, while
    /// the editor's Background Color control wrote to a field the compiler dropped. Position
    /// is part of the assertion because ruffle scans only the first few tags for it.
    #[test]
    fn the_stage_color_reaches_the_movie() {
        let json = fixture_json_with_background(Some("rgb(17,34,51)"));
        let doc = wick::parse_wick(&rewrap_test1(&json)).expect("parse patched test1");
        assert_eq!(
            doc.background,
            swf::Color {
                r: 17,
                g: 34,
                b: 51,
                a: 255
            }
        );

        let swf = compile_document(&doc).expect("compile");
        let buf = swf::decompress_swf(&swf[..]).expect("decompress");
        let parsed = swf::parse_swf(&buf).expect("parse");

        let at = parsed
            .tags
            .iter()
            .position(|t| matches!(t, Tag::SetBackgroundColor(_)))
            .expect("no SetBackgroundColor tag in the movie");
        let first_show = parsed
            .tags
            .iter()
            .position(|t| matches!(t, Tag::ShowFrame))
            .expect("no ShowFrame");
        assert_eq!(at, 0, "the background tag must lead the stream");
        assert!(at < first_show);

        match &parsed.tags[at] {
            Tag::SetBackgroundColor(c) => {
                assert_eq!((c.r, c.g, c.b), (17, 34, 51), "wrong stage colour")
            }
            other => panic!("expected SetBackgroundColor, got {other:?}"),
        }
    }

    /// A .wick that never said, which is what a hand-written or hand-trimmed one looks like.
    /// White rather than black: it is the engine's own constructor default, and it is what
    /// every movie compiled before this tag existed already showed.
    #[test]
    fn a_project_without_a_background_is_white() {
        let doc = wick::parse_wick(&rewrap_test1(&fixture_json_with_background(None)))
            .expect("parse test1 with no backgroundColor");
        assert_eq!(doc.background, swf::Color::WHITE);

        // And so is one whose colour is a string nothing can read, rather than the black that
        // `unwrap_or(0)` on a failed hex parse would have given.
        let doc = wick::parse_wick(&rewrap_test1(&fixture_json_with_background(Some(
            "chartreuse",
        ))))
        .expect("parse test1 with an unreadable backgroundColor");
        assert_eq!(doc.background, swf::Color::WHITE);
    }

    /// A gradient reaches the movie, and reaches it the right way round.
    ///
    /// The golden render is what proves a gradient looks right; this is what says why. SWF
    /// states every gradient over one fixed square and carries a matrix mapping that square
    /// onto the shape, so all the meaning is in six numbers, and a matrix that is wrong by a
    /// rotation or a factor of two still writes a structurally perfect `DefineShape4`.
    ///
    /// The conventions asserted here were read off Ruffle's own tessellator and gradient
    /// shader rather than inferred from the specification, because Ruffle is the only player
    /// twip targets and therefore the only opinion that decides: `swf_to_gl_matrix` inverts
    /// this matrix and divides by 32768, and `find_t` samples `uv.x` for a linear ramp and
    /// `length(uv * 2 - 1)` for a radial one.
    #[test]
    fn a_gradient_maps_onto_swfs_gradient_square() {
        let ramp = vec![
            (0.0, Color::from_rgb(0xef4a2f, 255)),
            (1.0, Color::from_rgb(0x64b6df, 255)),
        ];
        let linear = wick::Gradient {
            stops: ramp.clone(),
            radial: false,
            // 200px along +x, so the ramp is axis-aligned and the numbers are readable.
            origin: (100.0, 100.0),
            destination: (300.0, 100.0),
            highlight: None,
        };

        let m = gradient_matrix(&linear);
        // The square is 32768 twips wide and the ramp is 200px = 4000 twips.
        assert!((m.a.to_f64() - 4000.0 / 32768.0).abs() < 1e-6, "{:?}", m.a);
        assert_eq!(m.b, Fixed16::ZERO, "no rotation for a gradient along +x");
        // Translation is the ramp's midpoint, since the square is centred on its own origin.
        assert_eq!(m.tx, Twips::from_pixels(200.0));
        assert_eq!(m.ty, Twips::from_pixels(100.0));

        // Straight down instead: same scale, rotated a quarter turn.
        let down = wick::Gradient {
            destination: (100.0, 300.0),
            ..linear.clone()
        };
        let m = gradient_matrix(&down);
        assert!((m.a.to_f64() - 0.0).abs() < 1e-3, "{:?}", m.a);
        assert!((m.b.to_f64() - 4000.0 / 32768.0).abs() < 1e-6, "{:?}", m.b);

        // Radial: the destination is a point on the circle, so the square's *half* width is
        // the radius — half the scale a linear gradient of the same length would take.
        let radial = wick::Gradient {
            radial: true,
            ..linear.clone()
        };
        let m = gradient_matrix(&radial);
        assert!((m.a.to_f64() - 4000.0 / 16384.0).abs() < 1e-6, "{:?}", m.a);
        assert_eq!(
            m.tx,
            Twips::from_pixels(100.0),
            "centred on the origin, not the midpoint"
        );

        assert!(matches!(
            fill_to_style(&wick::Fill::Gradient(linear.clone())),
            FillStyle::LinearGradient(_)
        ));
        assert!(matches!(
            fill_to_style(&wick::Fill::Gradient(radial.clone())),
            FillStyle::RadialGradient(_)
        ));

        // A highlight makes it focal, and the matrix has to rotate even though a circle does
        // not care: SWF states the focal point along the square's x axis and nowhere else, so
        // without the rotation the bright spot slides off toward stage-right instead of
        // toward wherever the author dragged it.
        let focal = wick::Gradient {
            highlight: Some((100.0, 150.0)),
            ..radial.clone()
        };
        let m = gradient_matrix(&focal);
        assert!(
            (m.b.to_f64() - 4000.0 / 16384.0).abs() < 1e-6,
            "x aims at the highlight"
        );
        match fill_to_style(&wick::Fill::Gradient(focal)) {
            // 50px along a 200px radius.
            FillStyle::FocalGradient { focal_point, .. } => {
                assert!(
                    (focal_point.to_f64() - 0.25).abs() < 0.01,
                    "{focal_point:?}"
                );
            }
            other => panic!("expected a focal gradient, got {other:?}"),
        }

        // The ramp itself: paper's 0..1 offsets become SWF's 0..255 ratios.
        let FillStyle::LinearGradient(g) = fill_to_style(&wick::Fill::Gradient(linear)) else {
            panic!("expected a linear gradient");
        };
        assert_eq!(
            g.records.iter().map(|r| r.ratio).collect::<Vec<_>>(),
            vec![0, 255]
        );
    }

    /// A document holding a gradient compiles at all.
    ///
    /// This is not a subtle case and it did not fail subtly. paper.js stores a gradient once
    /// in a shared dictionary and references it by key, which changes the shape of the whole
    /// export: a path with only solid colours is `[class, props]`, and one carrying a
    /// gradient is `[["dictionary", {…}], [class, props]]`. Reading `json[1]` as the props
    /// map without noticing got an array, and the error was `Path props missing` — so a
    /// project with one gradient anywhere in it did not export a movie without the gradient,
    /// it did not export at all.
    #[test]
    fn a_document_with_a_gradient_compiles() {
        let bytes = include_bytes!("../fixtures/gradients.wick");
        let (swf, skipped) =
            compile_wick_reporting(bytes, &Options::default()).expect("gradients.wick compiles");
        assert!(
            skipped.is_empty(),
            "nothing left behind: {}",
            skipped.describe()
        );

        let doc = wick::parse_wick(bytes).expect("parse");
        let fills: Vec<_> = doc
            .layers
            .iter()
            .flat_map(|l| l.frames.iter())
            .flat_map(|f| f.contours.iter())
            .filter_map(|c| c.fill.as_ref())
            .collect();
        assert_eq!(fills.len(), 3, "three gradient-filled rectangles");
        assert!(
            fills.iter().all(|f| matches!(f, wick::Fill::Gradient(_))),
            "every one of them a gradient, not a solid fallback",
        );

        // And the movie carries all three as gradient fill styles rather than flat colours,
        // which is the half a byte count cannot tell you.
        let buf = swf::decompress_swf(&swf[..]).expect("decompress");
        let parsed = swf::parse_swf(&buf).expect("parse");
        let styles: Vec<_> = parsed
            .tags
            .iter()
            .filter_map(|t| match t {
                Tag::DefineShape(s) => Some(s.styles.fill_styles.clone()),
                _ => None,
            })
            .flatten()
            .collect();
        assert_eq!(styles.len(), 3);
        assert_eq!(
            styles
                .iter()
                .filter(|f| matches!(
                    f,
                    FillStyle::LinearGradient(_)
                        | FillStyle::RadialGradient(_)
                        | FillStyle::FocalGradient { .. }
                ))
                .count(),
            3,
            "got {styles:?}",
        );
    }

    /// The export names what it left behind.
    ///
    /// This is the case for a whole class of quiet failure rather than for four particular
    /// classnames. The editor ships a text tool, image import and sound import; the compiler
    /// reads none of them; and until this, drawing with any of them and pressing export
    /// produced a movie missing that work, a success message, and nothing else.
    ///
    /// The compile still succeeds, which is the other half. Refusing a project because one
    /// title card cannot come along is the worse of the two failures.
    #[test]
    fn the_export_says_what_it_left_behind() {
        let bytes = rewrap_test1(&fixture_json_with_unsupported());
        let doc = wick::parse_wick(&bytes).expect("parse test1 with unsupported content");

        assert_eq!(
            doc.skipped.kinds().collect::<Vec<_>>(),
            vec![("image", 1), ("sound", 1), ("text object", 1)],
        );
        assert_eq!(doc.skipped.total(), 3);
        assert_eq!(doc.skipped.describe(), "1 image, 1 sound, 1 text object");

        // Reported through the entry point the CLI and the export button actually call, and
        // the movie is still a movie.
        let (swf, skipped) =
            compile_wick_reporting(&bytes, &Options::default()).expect("compile anyway");
        assert!(
            swf.len() > 100,
            "still produced a movie: {} bytes",
            swf.len()
        );
        assert_eq!(skipped, doc.skipped);

        // A document the compiler can carry whole says nothing at all — the warning has to
        // stay rare enough to mean something.
        let clean = wick::parse_wick(include_bytes!("../fixtures/test1.wick")).expect("parse");
        assert!(clean.skipped.is_empty(), "{}", clean.skipped.describe());
        assert_eq!(clean.skipped.describe(), "");
    }

    /// Plurals, since the report is read by a person and `1 text objects` is a typo with a
    /// stack trace. A name the walk read off the document keeps whatever form it arrived in.
    #[test]
    fn the_report_counts_in_english() {
        let bytes = rewrap_test1(&fixture_json_with_unsupported());
        let mut json: serde_json::Value = serde_json::from_slice(&{
            use std::io::Read;
            let mut zip = zip::ZipArchive::new(std::io::Cursor::new(&bytes[..])).expect("zip");
            let mut s = Vec::new();
            zip.by_name("project.json")
                .expect("project.json")
                .read_to_end(&mut s)
                .expect("read");
            s
        })
        .expect("parse");

        // A second text object, so one kind is plural and the rest are not.
        let objects = json
            .get_mut("objects")
            .and_then(|o| o.as_object_mut())
            .expect("objects");
        objects.insert(
            "text-uuid-2".into(),
            serde_json::json!({ "classname": "Path", "json": ["PointText", {}] }),
        );
        let frame_uuid = objects
            .iter()
            .find(|(_, v)| v.get("classname").and_then(|c| c.as_str()) == Some("Frame"))
            .map(|(k, _)| k.clone())
            .expect("a Frame");
        objects[&frame_uuid]["children"]
            .as_array_mut()
            .expect("children")
            .push(serde_json::json!("text-uuid-2"));

        let doc = wick::parse_wick(&rewrap_test1(&serde_json::to_string(&json).expect("json")))
            .expect("parse");
        assert_eq!(doc.skipped.describe(), "1 image, 1 sound, 2 text objects");
    }

    /// Every string shape the format can hold. paper.js `toCSS()` writes `rgb(...)` when the
    /// colour is opaque and `rgba(...)` when it is not, and hex arrives from hand-editing —
    /// `#f00` included, which the old hex-only parser read as the number 0xf00 and rendered
    /// a dark blue.
    #[test]
    fn reads_every_css_color_the_format_writes() {
        let rgba = |r, g, b, a| swf::Color { r, g, b, a };
        let cases = [
            ("rgb(255,255,255)", rgba(255, 255, 255, 255)),
            ("rgb(0, 0, 0)", rgba(0, 0, 0, 255)),
            ("rgba(17,34,51,0.5)", rgba(17, 34, 51, 128)),
            ("rgba(17,34,51,1)", rgba(17, 34, 51, 255)),
            ("#112233", rgba(17, 34, 51, 255)),
            ("112233", rgba(17, 34, 51, 255)),
            ("#f00", rgba(255, 0, 0, 255)),
            ("#11223380", rgba(17, 34, 51, 128)),
        ];
        for (text, want) in cases {
            let got = wick::parse_css_color(text)
                .unwrap_or_else(|| panic!("{text} did not parse at all"));
            assert_eq!(got, want, "{text} parsed wrong");
        }
        for text in ["chartreuse", "", "rgb(1,2)", "#12345"] {
            assert!(
                wick::parse_css_color(text).is_none(),
                "{text} should not have parsed"
            );
        }
    }

    /// test1.wick's project.json with its `backgroundColor` replaced, or removed for `None`.
    fn fixture_json_with_background(color: Option<&str>) -> String {
        use std::io::Read;
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(
            &include_bytes!("../fixtures/test1.wick")[..],
        ))
        .expect("open test1.wick");
        let mut json = String::new();
        zip.by_name("project.json")
            .expect("project.json")
            .read_to_string(&mut json)
            .expect("read project.json");

        let mut root: serde_json::Value = serde_json::from_str(&json).expect("parse");
        let project = root
            .get_mut("project")
            .and_then(|p| p.as_object_mut())
            .expect("project object");
        match color {
            Some(c) => {
                project.insert(
                    "backgroundColor".into(),
                    serde_json::Value::String(c.into()),
                );
            }
            None => {
                project.remove("backgroundColor");
            }
        }
        root.to_string()
    }

    /// Zip a project.json back into something parse_wick will take.
    /// test1's project.json with a text object, a placed image and an attached sound added to
    /// its first frame — three things the editor can make and the compiler cannot carry.
    ///
    /// Synthesized rather than authored through the editor, because the point is the shapes
    /// the format uses, and those are stable: a text object and an image are both Wick
    /// `Path`s distinguished by the class inside `json`, and a sound is a UUID on the frame.
    ///
    /// A gradient used to be the fourth. It is not, since the compiler emits gradients now —
    /// `fixtures/gradients.wick` is the real thing, authored through paper.js, and the golden
    /// render is what checks it.
    fn fixture_json_with_unsupported() -> String {
        use std::io::Read;
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(
            &include_bytes!("../fixtures/test1.wick")[..],
        ))
        .expect("open test1.wick");
        let mut json = String::new();
        zip.by_name("project.json")
            .expect("project.json")
            .read_to_string(&mut json)
            .expect("read project.json");

        let mut root: serde_json::Value = serde_json::from_str(&json).expect("parse");
        let objects = root
            .get_mut("objects")
            .and_then(|o| o.as_object_mut())
            .expect("objects map");

        let frame_uuid = objects
            .iter()
            .find(|(_, v)| v.get("classname").and_then(|c| c.as_str()) == Some("Frame"))
            .map(|(k, _)| k.clone())
            .expect("test1 has a Frame");

        for (uuid, class) in [("text-uuid", "PointText"), ("raster-uuid", "Raster")] {
            objects.insert(
                uuid.into(),
                serde_json::json!({
                    "classname": "Path",
                    "json": [class, { "content": "hello", "point": [10.0, 10.0] }],
                }),
            );
        }

        let frame = objects
            .get_mut(&frame_uuid)
            .and_then(|f| f.as_object_mut())
            .expect("frame object");
        frame.insert("sound".into(), serde_json::json!("some-sound-asset-uuid"));
        let kids = frame
            .get_mut("children")
            .and_then(|c| c.as_array_mut())
            .expect("frame children");
        kids.push(serde_json::json!("text-uuid"));
        kids.push(serde_json::json!("raster-uuid"));

        serde_json::to_string(&root).expect("reserialize")
    }

    fn rewrap_test1(json: &str) -> Vec<u8> {
        use std::io::Write;
        let mut out = Vec::new();
        {
            let mut w = zip::ZipWriter::new(std::io::Cursor::new(&mut out));
            w.start_file(
                "project.json",
                zip::write::SimpleFileOptions::default()
                    .compression_method(zip::CompressionMethod::Stored),
            )
            .expect("start project.json");
            w.write_all(json.as_bytes()).expect("write project.json");
            w.finish().expect("finish zip");
        }
        out
    }

    #[test]
    fn tween_interpolates_clip_placement() {
        use wick::{Clip, Contour, Document, Frame, Layer, Tween};

        let dot = Contour {
            points: vec![(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)],
            holes: vec![],
            closed: true,
            fill: Some(wick::Fill::Solid(swf::Color::from_rgb(0x0000ff, 255))),
            stroke: None,
        };
        let clip = Clip {
            scripts: Vec::new(),
            transform: Transform {
                x: 0.0,
                y: 0.0,
                scale_x: 1.0,
                scale_y: 1.0,
                rotation_deg: 0.0,
                skew_deg: 0.0,
                opacity: 1.0,
            },
            layers: vec![Layer {
                frames: vec![Frame {
                    start: 1,
                    end: 1,
                    contours: vec![dot],
                    clips: vec![],
                    scripts: Vec::new(),
                    tweens: vec![],
                }],
            }],
        };
        let key = |playhead: u16, x: f64| Tween {
            playhead,
            transform: Transform {
                x,
                y: 0.0,
                scale_x: 1.0,
                scale_y: 1.0,
                rotation_deg: 0.0,
                skew_deg: 0.0,
                opacity: 1.0,
            },
            full_rotations: 0,
            easing: "none".to_string(),
            bezier: None,
        };
        let doc = Document {
            width: 200.0,
            height: 200.0,
            framerate: 12.0,
            background: swf::Color::WHITE,
            layers: vec![Layer {
                frames: vec![Frame {
                    start: 1,
                    end: 5,
                    contours: vec![],
                    clips: vec![clip],
                    scripts: Vec::new(),
                    tweens: vec![key(1, 0.0), key(5, 100.0)],
                }],
            }],
            skipped: Default::default(),
        };

        let swf = compile_document(&doc).expect("compile tween");
        let buf = swf::decompress_swf(&swf[..]).expect("decompress");
        let parsed = swf::parse_swf(&buf).expect("parse");

        assert_eq!(
            parsed.header.num_frames() as usize,
            movie(5, 12.0),
            "5-frame span, upsampled"
        );
        let count = |f: &dyn Fn(&Tag) -> bool| parsed.tags.iter().filter(|t| f(t)).count();
        assert_eq!(
            count(&|t| matches!(t, Tag::DefineSprite(_))),
            1,
            "the tweened clip -> one sprite"
        );

        // The placement's tx, in playhead order, is the interpolated x each frame.
        let txs: Vec<i32> = parsed
            .tags
            .iter()
            .filter_map(|t| match t {
                Tag::PlaceObject(po) => po.matrix.map(|m| m.tx.get()),
                _ => None,
            })
            .collect();
        // 21 samples, not 5. The document names frames 1..=5; the movie carries four more
        // between each named pair, and each has to land on the line the tween describes.
        // That is the difference between resampling the curve and holding each drawn frame
        // five times, and nothing else in the suite tells those two apart.
        let n = tween_samples(5, 12.0);
        assert_eq!(
            txs.len(),
            n,
            "one sample per movie frame up to the last key"
        );
        assert_eq!(
            txs[0],
            Twips::from_pixels(0.0).get(),
            "starts on the first key"
        );
        assert_eq!(
            txs[n - 1],
            Twips::from_pixels(100.0).get(),
            "ends on the last key"
        );
        for (i, &got) in txs.iter().enumerate() {
            // Within a twip: 1/20px against a 100px span, below what the format can express.
            let want = Twips::from_pixels(100.0 * i as f64 / (n - 1) as f64).get();
            assert!(
                (got - want).abs() <= 1,
                "movie frame {} x: got {got} twips, want {want}",
                i + 1
            );
        }
        // Holding a value across a document frame's worth of movie frames is the regression
        // this exists to catch, and it would sit inside no tolerance this test could name.
        assert!(
            txs.windows(2).all(|w| w[1] > w[0]),
            "every movie frame advances: {txs:?}"
        );
    }

    /// A goto payload names a movie frame, so upsampling has to scale it. Nothing about the
    /// rest of the output looks wrong when this is missed: `gotoAndStop(3)` simply lands a
    /// fifth of the way to where it meant to.
    #[test]
    fn upsampling_retargets_goto_payloads() {
        let swf = compile_document(&doc_with_frame_script("this.gotoAndStop(3);")).expect("c");
        let buf = swf::decompress_swf(&swf[..]).expect("decompress");
        let parsed = swf::parse_swf(&buf).expect("parse");
        let bytes = parsed
            .tags
            .iter()
            .find_map(|t| match t {
                Tag::DoAction(b) => Some(*b),
                _ => None,
            })
            .expect("a DoAction tag");
        // Document frame 3 is 0-based 2; at ×5 the same instant is 0-based 10.
        let k = i32::from(upsample_factor(FIXTURE_FPS));
        assert_eq!(
            decode_actions(bytes),
            vec![Action::GotoFrame(GotoFrame {
                frame: (2 * k) as u16
            })],
            "gotoAndStop(3) targets document frame 3's first movie frame"
        );
    }

    /// The opt-out. Someone matching twip's output against frame numbers from outside it —
    /// or after the coarse look on purpose — turns this off and gets exactly the document
    /// they drew, one movie frame per document frame at the rate they set.
    #[test]
    fn upsampling_can_be_turned_off() {
        let doc = doc_with_frame_script("this.gotoAndStop(3);");
        let flat = {
            let swf = compile_flat(&doc).expect("compile with upsampling off");
            let buf = swf::decompress_swf(&swf[..]).expect("decompress");
            swf::parse_swf(&buf).expect("parse").header
        };
        assert_eq!(
            flat.frame_rate().to_f32(),
            FIXTURE_FPS as f32,
            "the document's own rate, unscaled"
        );

        // Same document, same everything but the flag: this is what it opts out of.
        let up = {
            let swf = compile_document(&doc).expect("compile with upsampling on");
            let buf = swf::decompress_swf(&swf[..]).expect("decompress");
            swf::parse_swf(&buf).expect("parse").header
        };
        let k = u32::from(upsample_factor(FIXTURE_FPS));
        assert!(
            k > 1,
            "the fixture rate has to upsample or this proves nothing"
        );
        assert_eq!(
            u32::from(up.num_frames()),
            u32::from(flat.num_frames()) * k,
            "upsampling is the only difference between the two"
        );
    }

    #[test]
    fn easing_overshoot_reaches_placement() {
        // `out-back` overshoots to 1.0876975 at t=0.5 (oracle: tween.js Back.Out(0.5)).
        // Driving x 0->100 with it, the midpoint frame must land past x=100 -- something
        // impossible under linear easing and impossible if any stage clamps t to [0, 1].
        use wick::{Clip, Contour, Document, Frame, Layer, Tween};

        let dot = Contour {
            points: vec![(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)],
            holes: vec![],
            closed: true,
            fill: Some(wick::Fill::Solid(swf::Color::from_rgb(0x0000ff, 255))),
            stroke: None,
        };
        let ident = Transform {
            x: 0.0,
            y: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
            rotation_deg: 0.0,
            skew_deg: 0.0,
            opacity: 1.0,
        };
        let clip = Clip {
            scripts: Vec::new(),
            transform: ident,
            layers: vec![Layer {
                frames: vec![Frame {
                    start: 1,
                    end: 1,
                    contours: vec![dot],
                    clips: vec![],
                    scripts: Vec::new(),
                    tweens: vec![],
                }],
            }],
        };
        let key = |playhead: u16, x: f64, easing: &str| Tween {
            playhead,
            transform: Transform { x, ..ident },
            full_rotations: 0,
            easing: easing.to_string(),
            bezier: None,
        };
        let doc = Document {
            width: 200.0,
            height: 200.0,
            framerate: 12.0,
            background: swf::Color::WHITE,
            layers: vec![Layer {
                frames: vec![Frame {
                    start: 1,
                    end: 5,
                    contours: vec![],
                    clips: vec![clip],
                    scripts: Vec::new(),
                    tweens: vec![key(1, 0.0, "out-back"), key(5, 100.0, "none")],
                }],
            }],
            skipped: Default::default(),
        };

        // Upsampling off: the subject here is what the easing function returns at t=0.5, and
        // out-back is not monotonic, so on the upsampled stream two neighbouring samples can
        // round to the same twip near the turn and shift every index after it. The document
        // frames are where the overshoot is exactly nameable.
        let swf = compile_flat(&doc).expect("compile tween");
        let buf = swf::decompress_swf(&swf[..]).expect("decompress");
        let parsed = swf::parse_swf(&buf).expect("parse");

        let txs: Vec<i32> = parsed
            .tags
            .iter()
            .filter_map(|t| match t {
                Tag::PlaceObject(po) => po.matrix.map(|m| m.tx.get()),
                _ => None,
            })
            .collect();
        assert_eq!(txs.len(), 5, "one Place + four Modify");
        // Frame 3 of the 1..=5 span is t=0.5 -> x = 100 * 1.0876975 = 108.76975px.
        let mid = Twips::from_pixels(100.0 * 1.0876975).get();
        assert_eq!(txs[2], mid, "midpoint overshoots per out-back");
        assert!(
            txs[2] > txs[4],
            "overshoot ({}) exceeds the endpoint x=100px ({}) -- not clamped",
            txs[2],
            txs[4]
        );
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
            skew_deg: 0.0,
            opacity: 1.0,
        };
        let b = Transform {
            x: 100.0,
            y: 0.0,
            scale_x: 3.0,
            scale_y: 3.0,
            rotation_deg: 180.0,
            skew_deg: 0.0,
            opacity: 0.0,
        };
        let m = lerp_transform(&a, &b, 0.5);
        assert!((m.x - 50.0).abs() < 1e-9);
        assert!((m.scale_x - 2.0).abs() < 1e-9);
        assert!((m.rotation_deg - 90.0).abs() < 1e-9);
        assert!((m.opacity - 0.5).abs() < 1e-9);
    }

    // --- Tween semantics: twip uses per-property lerp, NOT the fork's matrix
    // round-trip (tweenMethod 'normal' = decompose -> lerp -> recompose). The two
    // agree exactly for well-behaved transforms; they diverge only where the fork's
    // round-trip is broken, and there twip is the correct one. These two tests pin
    // that intentional divergence so a future "match the fork" change can't silently
    // reintroduce the bug. See docs/wick-format.md; the engine's
    // corruption is reproduced verbatim in scripts/oracle-tween.js.

    /// A horizontal-flip tween (scaleX 1 -> -1) passes through scaleX 0. The fork's
    /// 'normal' path NaNs exactly there (0/0 in the matrix recompose) and flips the
    /// sign back to positive for scaleX < 0 (measured). twip lerps scaleX linearly
    /// through zero and keeps the sign, so the matrix is finite and a real mirror.
    #[test]
    fn negative_scale_flip_tween_stays_signed_and_finite() {
        let start = Transform {
            x: 0.0,
            y: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
            rotation_deg: 0.0,
            skew_deg: 0.0,
            opacity: 1.0,
        };
        let end = Transform {
            scale_x: -1.0,
            ..start
        };
        for (t, want_sx) in [
            (0.0, 1.0),
            (0.25, 0.5),
            (0.5, 0.0),
            (0.75, -0.5),
            (1.0, -1.0),
        ] {
            let mid = lerp_transform(&start, &end, t);
            assert!(
                (mid.scale_x - want_sx).abs() < 1e-9,
                "scaleX lerps linearly at t={t}"
            );
            // rotation=0, so matrix.a = scaleX*cos(0) = scaleX: the signed scale is kept,
            // not turned into a 180deg rotation the way the fork's decompose does.
            let a = mid.matrix().a.to_f64();
            assert!(a.is_finite(), "matrix.a finite at t={t}");
            assert!(
                (a - want_sx).abs() < 1e-9,
                "matrix.a keeps signed scaleX at t={t}"
            );
        }
    }

    /// A rotation tween 0 -> 180deg sweeps through 90deg, where the fork's decompose
    /// reconstruct misbehaves. twip lerps the angle directly, so cos/sin stay finite
    /// the whole way and the rotation is monotonic.
    #[test]
    fn rotation_tween_through_90_degrees_stays_finite() {
        let start = Transform {
            x: 0.0,
            y: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
            rotation_deg: 0.0,
            skew_deg: 0.0,
            opacity: 1.0,
        };
        let end = Transform {
            rotation_deg: 180.0,
            ..start
        };
        for t in [0.0, 0.25, 0.5, 0.75, 1.0] {
            let mid = lerp_transform(&start, &end, t);
            assert!(
                (mid.rotation_deg - 180.0 * t).abs() < 1e-9,
                "rotation lerps linearly at t={t}"
            );
            let m = mid.matrix();
            for v in [m.a.to_f64(), m.b.to_f64(), m.c.to_f64(), m.d.to_f64()] {
                assert!(v.is_finite(), "matrix component finite at t={t}");
            }
        }
        // At the midpoint (90deg) the fork's path is degenerate; twip gives a~0, b~1.
        let m = lerp_transform(&start, &end, 0.5).matrix();
        assert!(m.a.to_f64().abs() < 1e-9, "90deg: matrix.a ~ 0");
        assert!((m.b.to_f64() - 1.0).abs() < 1e-9, "90deg: matrix.b ~ 1");
    }

    /// Skew rotates the y basis vector by `rotation + skew` while x stays at `rotation`.
    /// Expected values are the fork's own `Transformation.toMatrix()` output, dumped by
    /// `node scripts/oracle-tween.js` (section 5) — not re-derived here.
    // The table holds that JS output verbatim; cos(45°) happens to be FRAC_1_SQRT_2, but it
    // must stay the literal the oracle printed rather than a std constant, so silence
    // approx_constant (same reasoning as easing_matches_tween_js).
    #[allow(clippy::approx_constant)]
    #[test]
    fn skew_matches_fork_to_matrix() {
        let base = Transform {
            x: 0.0,
            y: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
            rotation_deg: 0.0,
            skew_deg: 0.0,
            opacity: 1.0,
        };
        // (label, transform, a, b, c, d)
        let cases = [
            ("skew=0 is the identity", base, 1.0, 0.0, 0.0, 1.0),
            (
                "skew=30",
                Transform {
                    skew_deg: 30.0,
                    ..base
                },
                1.0,
                0.0,
                -0.5,
                0.866_025,
            ),
            (
                "skew=-30 mirrors c, leaves d",
                Transform {
                    skew_deg: -30.0,
                    ..base
                },
                1.0,
                0.0,
                0.5,
                0.866_025,
            ),
            (
                "scaleY scales the skewed axis",
                Transform {
                    skew_deg: 30.0,
                    scale_y: 2.0,
                    ..base
                },
                1.0,
                0.0,
                -1.0,
                1.732_051,
            ),
            (
                "rotation and skew compose",
                Transform {
                    rotation_deg: 45.0,
                    skew_deg: 30.0,
                    ..base
                },
                0.707_107,
                0.707_107,
                -0.965_926,
                0.258_819,
            ),
        ];
        for (label, tr, a, b, c, d) in cases {
            let m = tr.matrix();
            // Fixed16 is 1/65536, so ~1.6e-5 is the representable floor.
            for (got, want, name) in [
                (m.a.to_f64(), a, "a"),
                (m.b.to_f64(), b, "b"),
                (m.c.to_f64(), c, "c"),
                (m.d.to_f64(), d, "d"),
            ] {
                assert!(
                    (got - want).abs() < 2e-5,
                    "{label}: matrix.{name} = {got}, fork toMatrix gives {want}"
                );
            }
        }
        // The x basis is untouched by skew — that is what makes it a skew and not a rotation.
        let skewed = Transform {
            skew_deg: 30.0,
            ..base
        }
        .matrix();
        assert_eq!(skewed.a, base.matrix().a, "skew leaves matrix.a alone");
        assert_eq!(skewed.b, base.matrix().b, "skew leaves matrix.b alone");
    }

    /// Skew lerps per-property like every other channel (the fork's `tweenMethod:'skew'`
    /// branch lists it alongside x/y/scale/rotation/opacity — Tween.js:87).
    #[test]
    fn skew_tween_lerps_per_property() {
        let start = Transform {
            x: 0.0,
            y: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
            rotation_deg: 0.0,
            skew_deg: 0.0,
            opacity: 1.0,
        };
        let end = Transform {
            skew_deg: 30.0,
            ..start
        };
        for t in [0.0, 0.25, 0.5, 0.75, 1.0] {
            let mid = lerp_transform(&start, &end, t);
            assert!(
                (mid.skew_deg - 30.0 * t).abs() < 1e-9,
                "skew lerps linearly at t={t}"
            );
        }
        // Midpoint against the fork's toMatrix at skew=15 (oracle-tween.js section 5).
        let m = lerp_transform(&start, &end, 0.5).matrix();
        assert!(
            (m.c.to_f64() - -0.258_819).abs() < 2e-5,
            "midpoint matrix.c"
        );
        assert!((m.d.to_f64() - 0.965_926).abs() < 2e-5, "midpoint matrix.d");
    }

    /// End-to-end skew through the parser: `fixtures/skew-tween.wick` is
    /// `motion-tween.wick`'s real engine-exported object graph with both tween keys
    /// rewritten to isolate skew — x 90 -> 460, y 200, scale 1, rotation 0, opacity 1,
    /// skew 0 -> 30 over the same 24-frame span. (Hand-derived like brush-donut.wick;
    /// the upstream editor that exported motion-tween.wick omits `skew` entirely, which
    /// is exactly why the parser defaults it to 0.)
    #[test]
    fn compiles_skew_tween_wick() {
        let bytes = include_bytes!("../fixtures/skew-tween.wick");
        let swf = compile_wick(bytes).expect("compile skew-tween.wick");
        let buf = swf::decompress_swf(&swf[..]).expect("decompress");
        let parsed = swf::parse_swf(&buf).expect("parse");

        let places: Vec<&PlaceObject> = parsed
            .tags
            .iter()
            .filter_map(|t| match t {
                Tag::PlaceObject(po) => Some(po.as_ref()),
                _ => None,
            })
            .collect();
        assert_eq!(
            places.len(),
            tween_samples(24, FIXTURE_FPS),
            "one placement per movie frame of the span"
        );

        // Frame 1: skew 0 -> an unskewed matrix.
        let first = places[0].matrix.unwrap();
        assert!(first.c.to_f64().abs() < 2e-5, "frame 1 skew 0 -> c = 0");
        assert!((first.d.to_f64() - 1.0).abs() < 2e-5, "frame 1 d = scaleY");

        // Frame 24: skew 30 -> the fork's toMatrix values.
        let last = places[places.len() - 1].matrix.unwrap();
        assert!(
            (last.c.to_f64() - -0.5).abs() < 2e-5,
            "frame 24 skew 30 -> c"
        );
        assert!(
            (last.d.to_f64() - 0.866_025).abs() < 2e-5,
            "frame 24 skew 30 -> d"
        );
        assert!((last.a.to_f64() - 1.0).abs() < 2e-5, "skew never touches a");
        assert!(last.b.to_f64().abs() < 2e-5, "skew never touches b");

        // And it gets there monotonically — c decreases every frame, no snap.
        let cs: Vec<f64> = places
            .iter()
            .map(|p| p.matrix.unwrap().c.to_f64())
            .collect();
        for w in cs.windows(2) {
            assert!(w[1] < w[0], "c decreases monotonically: {w:?}");
        }
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

    // --- Item 10 milestone A: frame actions -----------------------------------

    /// Decode a `DoAction` byte buffer into its action records (dropping the
    /// terminating `Action::End`).
    fn decode_actions(bytes: &[u8]) -> Vec<Action<'_>> {
        let mut r = swf::avm1::read::Reader::new(bytes, 8);
        let mut out = Vec::new();
        while let Ok(action) = r.read_action() {
            if action == Action::End {
                break;
            }
            out.push(action);
        }
        out
    }

    /// Build a one-layer, one-frame document whose single keyframe carries `src`
    /// as a `default` frame script (plus a small square so there's something to draw).
    fn doc_with_frame_script(src: &str) -> wick::Document {
        use wick::{Contour, Document, Frame, Layer, Script};
        let square = Contour {
            points: vec![(0.0, 0.0), (40.0, 0.0), (40.0, 40.0), (0.0, 40.0)],
            holes: vec![],
            closed: true,
            fill: Some(wick::Fill::Solid(swf::Color::from_rgb(0x00ff00, 255))),
            stroke: None,
        };
        Document {
            width: 200.0,
            height: 200.0,
            framerate: 12.0,
            background: swf::Color::WHITE,
            layers: vec![Layer {
                frames: vec![Frame {
                    start: 1,
                    end: 1,
                    contours: vec![square],
                    clips: vec![],
                    tweens: vec![],
                    scripts: vec![Script {
                        name: "default".to_string(),
                        src: src.to_string(),
                    }],
                }],
            }],
            skipped: Default::default(),
        }
    }

    #[test]
    fn frame_stop_emits_doaction() {
        let swf = compile_document(&doc_with_frame_script("stop();")).expect("compile");
        let buf = swf::decompress_swf(&swf[..]).expect("decompress");
        let parsed = swf::parse_swf(&buf).expect("parse");

        let do_idx = parsed
            .tags
            .iter()
            .position(|t| matches!(t, Tag::DoAction(_)))
            .expect("a DoAction tag");
        let sf_idx = parsed
            .tags
            .iter()
            .position(|t| matches!(t, Tag::ShowFrame))
            .expect("a ShowFrame");
        assert!(do_idx < sf_idx, "DoAction precedes the frame's ShowFrame");

        let bytes = match &parsed.tags[do_idx] {
            Tag::DoAction(b) => *b,
            _ => unreachable!(),
        };
        assert_eq!(decode_actions(bytes), vec![Action::Stop], "stop() -> Stop");
    }

    /// What `gotoAndPlay(2)` parses to, with nothing between the source and the payload.
    /// Upsampling scales that payload, which is its own mechanism and tested separately in
    /// `upsampling_retargets_goto_payloads`.
    #[test]
    fn gotoandplay_emits_goto_and_play() {
        // gotoAndPlay(2): 1-indexed source -> 0-indexed GotoFrame{1}, then Play.
        let swf = compile_flat(&doc_with_frame_script("gotoAndPlay(2);")).expect("compile");
        let buf = swf::decompress_swf(&swf[..]).expect("decompress");
        let parsed = swf::parse_swf(&buf).expect("parse");

        let bytes = parsed
            .tags
            .iter()
            .find_map(|t| match t {
                Tag::DoAction(b) => Some(*b),
                _ => None,
            })
            .expect("a DoAction tag");
        assert_eq!(
            decode_actions(bytes),
            vec![Action::GotoFrame(GotoFrame { frame: 1 }), Action::Play],
            "gotoAndPlay(2) -> GotoFrame{{1}} + Play"
        );
    }

    #[test]
    fn gotoandstop_emits_bare_gotoframe() {
        let swf = compile_flat(&doc_with_frame_script("this.gotoAndStop(3);")).expect("compile");
        let buf = swf::decompress_swf(&swf[..]).expect("decompress");
        let parsed = swf::parse_swf(&buf).expect("parse");
        let bytes = parsed
            .tags
            .iter()
            .find_map(|t| match t {
                Tag::DoAction(b) => Some(*b),
                _ => None,
            })
            .expect("a DoAction tag");
        assert_eq!(
            decode_actions(bytes),
            vec![Action::GotoFrame(GotoFrame { frame: 2 })],
            "gotoAndStop(3) -> bare GotoFrame{{2}} (no Play)"
        );
    }

    #[test]
    fn unrecognized_script_is_skipped_not_fatal() {
        // A script outside the recognized vocabulary must not fail the compile, and
        // must emit no DoAction — the visuals still export.
        let swf = compile_document(&doc_with_frame_script(
            "var t = wickCustomThing(42); t.spin();",
        ))
        .expect("compile still succeeds");
        let buf = swf::decompress_swf(&swf[..]).expect("decompress");
        let parsed = swf::parse_swf(&buf).expect("parse");
        assert!(
            !parsed.tags.iter().any(|t| matches!(t, Tag::DoAction(_))),
            "no DoAction for an unrecognized script"
        );
        assert!(
            parsed.tags.iter().any(|t| matches!(t, Tag::DefineShape(_))),
            "the shape still exports"
        );
    }

    #[test]
    fn recognizer_parses_the_vocabulary() {
        use wick::Script;
        let s = |src: &str| {
            recognize_frame_actions(&[Script {
                name: "default".to_string(),
                src: src.to_string(),
            }])
        };
        assert_eq!(s("stop();").0, vec![script::Op::Stop]);
        assert_eq!(s("play()").0, vec![script::Op::Play]);
        assert_eq!(s("gotoAndPlay(5);").0, vec![script::Op::GotoAndPlay(4)]);
        assert_eq!(s("gotoAndStop(1);").0, vec![script::Op::GotoFrame(0)]);
        assert_eq!(
            s("gotoAndPlay(\"intro\");").0,
            vec![script::Op::GotoLabel("intro".to_string(), true)]
        );
        // Comments and blank lines are ignored; multiple statements accumulate.
        assert_eq!(
            s("// jump back\nstop(); play();").0,
            vec![script::Op::Stop, script::Op::Play]
        );
        // A script that is only recognized on the wrong event name is not a frame action.
        assert!(
            recognize_frame_actions(&[Script {
                name: "mousepressed".to_string(),
                src: "stop();".to_string(),
            }])
            .0
            .is_empty(),
            "mousepressed is a milestone-B clip event, not a frame action"
        );
        // What it cannot compile it names, with the script it came from — a whole script
        // rather than a statement, since a half-compiled one is the worse failure.
        let refused = s("frobnicate(9)").1;
        assert_eq!(refused.len(), 1);
        assert!(refused[0].starts_with("default: "), "{refused:?}");
        assert!(refused[0].contains("frobnicate"), "{refused:?}");
    }

    // --- Item 10 milestone B: clip PRESS click handlers -----------------------

    /// Find the first `PlaceObject` carrying clip actions and return its decoded
    /// `(events, actions)`.
    fn first_clip_action<'a>(parsed: &swf::Swf<'a>) -> (ClipEventFlag, Vec<Action<'a>>) {
        let po = parsed
            .tags
            .iter()
            .find_map(|t| match t {
                Tag::PlaceObject(po) if po.clip_actions.is_some() => Some(po),
                _ => None,
            })
            .expect("a PlaceObject with clip actions");
        let ca = po.clip_actions.as_ref().unwrap();
        let rec = &ca.records[0];
        (rec.events, decode_actions(rec.action_data))
    }

    #[test]
    fn recognize_clip_actions_reads_mouse_events() {
        use wick::Script;
        let mk = |name: &str| {
            recognize_clip_actions(&[Script {
                name: name.to_string(),
                src: "gotoAndPlay(1);".to_string(),
            }])
            .0
        };
        assert_eq!(mk("mousepressed"), vec![script::Op::GotoAndPlay(0)]);
        assert_eq!(mk("mouseclick"), vec![script::Op::GotoAndPlay(0)]);
        // A frame-event script is not a clip action.
        assert!(
            mk("default").is_empty(),
            "default is a frame script, not a click"
        );
    }

    #[test]
    fn clip_click_emits_press_action() {
        use wick::{Clip, Contour, Document, Frame, Layer, Script};
        let dot = Contour {
            points: vec![(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)],
            holes: vec![],
            closed: true,
            fill: Some(wick::Fill::Solid(swf::Color::from_rgb(0x0000ff, 255))),
            stroke: None,
        };
        // A clip with a mousepressed handler, placed on the root timeline.
        let clip = Clip {
            scripts: vec![Script {
                name: "mousepressed".to_string(),
                src: "stop();".to_string(),
            }],
            transform: Transform {
                x: 20.0,
                y: 20.0,
                scale_x: 1.0,
                scale_y: 1.0,
                rotation_deg: 0.0,
                skew_deg: 0.0,
                opacity: 1.0,
            },
            layers: vec![Layer {
                frames: vec![Frame {
                    start: 1,
                    end: 1,
                    contours: vec![dot],
                    clips: vec![],
                    tweens: vec![],
                    scripts: Vec::new(),
                }],
            }],
        };
        let doc = Document {
            width: 200.0,
            height: 200.0,
            framerate: 12.0,
            background: swf::Color::WHITE,
            layers: vec![Layer {
                frames: vec![Frame {
                    start: 1,
                    end: 1,
                    contours: vec![],
                    clips: vec![clip],
                    tweens: vec![],
                    scripts: Vec::new(),
                }],
            }],
            skipped: Default::default(),
        };

        let swf = compile_document(&doc).expect("compile");
        let buf = swf::decompress_swf(&swf[..]).expect("decompress");
        let parsed = swf::parse_swf(&buf).expect("parse");

        let (events, actions) = first_clip_action(&parsed);
        assert!(
            events.contains(ClipEventFlag::PRESS),
            "handler fires on PRESS"
        );
        assert_eq!(actions, vec![Action::Stop], "mousepressed stop() -> Stop");

        // The clip action rides on the sprite's initial Place, not a Modify.
        let placed_sprite = parsed.tags.iter().any(|t| {
            matches!(
                t,
                Tag::PlaceObject(po)
                    if po.clip_actions.is_some()
                        && matches!(po.action, PlaceObjectAction::Place(_))
            )
        });
        assert!(
            placed_sprite,
            "clip actions attach to the Place, not a Modify"
        );
    }

    /// Item 10 milestone B end-to-end: a real `.wick` whose placed clip carries a
    /// `mousepressed: stop();` handler emits a `PRESS` clip action decoding to `Stop`.
    #[test]
    fn compiles_clip_click_wick() {
        let bytes = include_bytes!("../fixtures/clip-click.wick");
        let swf = compile_wick(bytes).expect("compile clip-click.wick");
        let buf = swf::decompress_swf(&swf[..]).expect("decompress");
        let parsed = swf::parse_swf(&buf).expect("parse");

        assert_eq!(
            parsed
                .tags
                .iter()
                .filter(|t| matches!(t, Tag::PlaceObject(po) if po.clip_actions.is_some()))
                .count(),
            1,
            "one clip carries a click handler"
        );
        let (events, actions) = first_clip_action(&parsed);
        assert!(events.contains(ClipEventFlag::PRESS));
        assert_eq!(actions, vec![Action::Stop]);
    }
}
