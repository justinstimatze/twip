//! Read the shapes back out of an SWF.
//!
//! Deliberately one direction and one kind of thing: **artwork**. Timing, tween keys,
//! easing, layer structure and scripts are not recovered and are not attempted. A tween is
//! compiled down to a matrix per frame, and inferring "linear x 90 to 460, out-bounce, over
//! 24 frames" back out of a hundred matrices is curve fitting — a wrong fit reads as a real
//! answer, which is worse than no answer. What survives compilation exactly is the geometry,
//! so that is what comes back.
//!
//! The output is SVG rather than `.wick`, because the editor already ingests SVG
//! (`engine/src/base/asset/SVGAsset.js`, droppable onto the canvas) and writing a second
//! `.wick` serializer to reach the same place would be the larger and more fragile half.
//!
//! Shapes are returned in **stage** coordinates, which means walking the display list and
//! composing the placement matrix of every sprite on the way down. Real Flash defines a shape
//! once about its own origin and positions it with a matrix, often reusing it; twip's own
//! output authors in stage coordinates and places at identity, so it round-trips either way
//! and none of the fixtures can tell the difference. Ruffle's logo animation can: without the
//! matrices its 22 shapes all land in the top-left corner.
//!
//! The whole timeline is walked, not just the first frame, because an animation introduces
//! most of its drawings after frame 1 — the same logo has four shapes on screen when it
//! opens. Each character is taken once per depth it occupies, at the first matrix seen there,
//! so a tween contributes one copy at its starting position rather than one per frame.
//!
//! **Where this is approximate, and it is worth knowing before trusting it.** An SWF shape
//! is an edge stream with a fill on each side of every edge — `fill_style_0` to the left,
//! `fill_style_1` to the right — so two regions that touch share one run of edges and are
//! recovered by resolving those references into closed areas. This walks the pen instead,
//! taking each `move_to` as the start of a ring and each ring's declared right-hand fill as
//! its fill. For art drawn as separate closed shapes, which is most art, the two agree. For
//! shapes that share edges between differently-filled regions, the geometry is right and the
//! fills can be wrong.
//!
//! Measured against ruffle's regression corpus, 4,898 real SWFs: 4,891 open, 7 refuse and all
//! seven are files deliberately malformed to test error handling, and nothing panics.

use anyhow::{Context, Result};
use swf::{FillStyle, LineCapStyle, LineJoinStyle, LineStyle, ShapeRecord, Twips};

use crate::wick::{Contour, Stroke, StrokeCap, StrokeJoin};

/// One recovered ring: its points in pixels, and what it was painted with.
fn ring_to_contour(
    points: Vec<(f64, f64)>,
    fill: Option<swf::Color>,
    stroke: Option<Stroke>,
) -> Contour {
    Contour {
        points,
        holes: vec![],
        // Every ring in a fill is closed; a bare stroke may be an open path, but the record
        // stream does not say which, and closing an open stroke is the visible error while
        // leaving a fill open is not.
        closed: fill.is_some(),
        fill,
        stroke,
    }
}

/// How finely to chop a quadratic curve. SWF curves are quadratic beziers and `Contour`
/// holds straight segments, so they have to be sampled. Sixteen keeps a full circle's worth
/// of curves under a twip of error at the sizes a stage holds, and the editor can always
/// simplify afterwards.
const CURVE_STEPS: usize = 16;

/// Sample a quadratic bezier, skipping t=0 because the caller already has that point.
fn flatten_quadratic(
    from: (f64, f64),
    ctrl: (f64, f64),
    to: (f64, f64),
    out: &mut Vec<(f64, f64)>,
) {
    for step in 1..=CURVE_STEPS {
        let t = step as f64 / CURVE_STEPS as f64;
        let inv = 1.0 - t;
        out.push((
            inv * inv * from.0 + 2.0 * inv * t * ctrl.0 + t * t * to.0,
            inv * inv * from.1 + 2.0 * inv * t * ctrl.1 + t * t * to.1,
        ));
    }
}

/// Walk one shape's record stream into rings.
fn shape_to_contours(
    records: &[ShapeRecord],
    fills: &[FillStyle],
    lines: &[LineStyle],
) -> Vec<Contour> {
    let px = |t: Twips| t.to_pixels();
    // 1-based into the style tables, and 0 means "none" — the one indexing rule in the
    // format that silently produces a wrong colour rather than an error if you get it wrong.
    let fill_at = |idx: Option<u32>| -> Option<swf::Color> {
        let i = idx?;
        match fills.get(i.checked_sub(1)? as usize)? {
            FillStyle::Color(c) => Some(*c),
            // Gradients and bitmaps have no Contour equivalent; the ring keeps its geometry
            // and loses its paint rather than being dropped.
            _ => None,
        }
    };
    let line_at = |idx: Option<u32>| -> Option<Stroke> {
        let i = idx?;
        let ls = lines.get(i.checked_sub(1)? as usize)?;
        // A stroke can be painted with any fill style; only a flat colour has a `Stroke`
        // equivalent, so a gradient-stroked ring keeps its geometry and loses its stroke.
        let color = match ls.fill_style() {
            FillStyle::Color(c) => *c,
            _ => return None,
        };
        Some(Stroke {
            color,
            width: ls.width().to_pixels(),
            cap: match ls.start_cap() {
                LineCapStyle::Round => StrokeCap::Round,
                LineCapStyle::Square => StrokeCap::Square,
                LineCapStyle::None => StrokeCap::Butt,
            },
            join: match ls.join_style() {
                LineJoinStyle::Round => StrokeJoin::Round,
                LineJoinStyle::Bevel => StrokeJoin::Bevel,
                LineJoinStyle::Miter(_) => StrokeJoin::Miter,
            },
            miter_limit: match ls.join_style() {
                LineJoinStyle::Miter(limit) => limit.to_f64(),
                _ => 4.0,
            },
        })
    };

    let mut out = Vec::new();
    let mut pen = (0.0_f64, 0.0_f64);
    let mut ring: Vec<(f64, f64)> = Vec::new();
    // Style *indices*, resolved only when a ring is emitted. The record stream declares
    // indices and a later record can change them mid-ring, so the pair in force at the end
    // of a ring is the pair that painted it.
    let (mut fill_idx, mut line_idx) = (None, None);

    // A ring ends where the next one begins, and at the end of the stream. Anything with
    // fewer than two points drew nothing.
    let mut flush = |ring: &mut Vec<(f64, f64)>, f: Option<u32>, l: Option<u32>| {
        if ring.len() >= 2 {
            out.push(ring_to_contour(
                std::mem::take(ring),
                fill_at(f),
                line_at(l),
            ));
        } else {
            ring.clear();
        }
    };

    for record in records {
        match record {
            ShapeRecord::StyleChange(sc) => {
                if let Some(mv) = sc.move_to {
                    flush(&mut ring, fill_idx, line_idx);
                    pen = (px(mv.x), px(mv.y));
                    ring.push(pen);
                }
                if sc.fill_style_1.is_some() {
                    fill_idx = sc.fill_style_1;
                } else if sc.fill_style_0.is_some() {
                    // Only the left-hand fill was declared, so that is what this run paints.
                    fill_idx = sc.fill_style_0;
                }
                if sc.line_style.is_some() {
                    line_idx = sc.line_style;
                }
            }
            ShapeRecord::StraightEdge { delta } => {
                if ring.is_empty() {
                    ring.push(pen);
                }
                pen = (pen.0 + px(delta.dx), pen.1 + px(delta.dy));
                ring.push(pen);
            }
            ShapeRecord::CurvedEdge {
                control_delta,
                anchor_delta,
            } => {
                if ring.is_empty() {
                    ring.push(pen);
                }
                let ctrl = (pen.0 + px(control_delta.dx), pen.1 + px(control_delta.dy));
                let to = (ctrl.0 + px(anchor_delta.dx), ctrl.1 + px(anchor_delta.dy));
                flatten_quadratic(pen, ctrl, to, &mut ring);
                pen = to;
            }
        }
    }
    flush(&mut ring, fill_idx, line_idx);
    out
}

/// Every shape in an SWF, each as its own list of rings.
///
/// The grouping is load-bearing rather than tidiness. A shape with a hole is one shape
/// holding two rings, and SWF renders the hole empty because winding is evaluated across the
/// whole shape. Flatten the groups and the hole becomes a second, separately-painted ring
/// that fills itself in — a donut arrives as a disc.
/// A 2x3 affine in plain `f64`.
///
/// Composed rather than applied one at a time: a shape inside a sprite inside the root
/// carries every matrix on the way down, and doing that in `Fixed16` would round at each
/// step.
#[derive(Clone, Copy)]
struct Affine {
    a: f64,
    b: f64,
    c: f64,
    d: f64,
    tx: f64,
    ty: f64,
}

impl Affine {
    const IDENTITY: Self = Self {
        a: 1.0,
        b: 0.0,
        c: 0.0,
        d: 1.0,
        tx: 0.0,
        ty: 0.0,
    };

    fn from_swf(m: &swf::Matrix) -> Self {
        Self {
            a: m.a.to_f64(),
            b: m.b.to_f64(),
            c: m.c.to_f64(),
            d: m.d.to_f64(),
            tx: m.tx.to_pixels(),
            ty: m.ty.to_pixels(),
        }
    }

    /// `self` first, then `outer`.
    fn then(self, outer: Self) -> Self {
        Self {
            a: self.a * outer.a + self.b * outer.c,
            b: self.a * outer.b + self.b * outer.d,
            c: self.c * outer.a + self.d * outer.c,
            d: self.c * outer.b + self.d * outer.d,
            tx: self.tx * outer.a + self.ty * outer.c + outer.tx,
            ty: self.tx * outer.b + self.ty * outer.d + outer.ty,
        }
    }

    fn apply(&self, (x, y): (f64, f64)) -> (f64, f64) {
        (
            self.a * x + self.c * y + self.tx,
            self.b * x + self.d * y + self.ty,
        )
    }
}

/// What a character id refers to.
enum Character<'a> {
    Shape(Vec<Contour>),
    Sprite(Vec<swf::Tag<'a>>),
}

/// Everything the display list can place, plus the root's own placements.
struct Library<'a> {
    characters: std::collections::BTreeMap<u16, Character<'a>>,
    root: Vec<swf::Tag<'a>>,
}

/// Every character a tag list ever places, as (id, matrix), each one once.
///
/// The whole timeline rather than the first frame, because the job is recovering *art* and
/// an animation introduces most of its drawings after frame 1. Ruffle's own logo is the case
/// that settled it: 22 shapes in the file, four of them on screen when it opens.
///
/// Keyed by depth and id together, so a character placed at two depths comes back twice —
/// it is two things on the stage — while a tween re-placing one character across a hundred
/// frames still comes back once. The matrix kept is the first seen for that pair, which for
/// a tween is where it starts rather than where it ends.
fn placements(tags: &[swf::Tag]) -> Vec<(u16, Affine)> {
    let mut seen: std::collections::BTreeMap<(u16, u16), Affine> = Default::default();
    let mut live: std::collections::BTreeMap<u16, u16> = Default::default();
    for tag in tags {
        match tag {
            swf::Tag::PlaceObject(po) => {
                let matrix = po.matrix.as_ref().map(Affine::from_swf);
                match po.action {
                    swf::PlaceObjectAction::Place(id) | swf::PlaceObjectAction::Replace(id) => {
                        live.insert(po.depth, id);
                        seen.entry((po.depth, id))
                            .or_insert_with(|| matrix.unwrap_or(Affine::IDENTITY));
                    }
                    swf::PlaceObjectAction::Modify => {
                        // A Modify names no character; it edits whatever holds that depth.
                        if let (Some(&id), Some(m)) = (live.get(&po.depth), matrix) {
                            seen.entry((po.depth, id)).or_insert(m);
                        }
                    }
                }
            }
            swf::Tag::RemoveObject(ro) => {
                live.remove(&ro.depth);
            }
            _ => {}
        }
    }
    seen.into_iter().map(|((_, id), m)| (id, m)).collect()
}

/// Walk a display list, following sprites, and hand back every shape in stage coordinates.
fn draw(library: &Library, tags: &[swf::Tag], at: Affine, depth: u32, out: &mut Vec<Vec<Contour>>) {
    // Sprites can reference each other; a cap is cheaper than cycle detection and no real
    // document nests anywhere near this deep.
    if depth > 8 {
        return;
    }
    for (id, matrix) in placements(tags) {
        let here = matrix.then(at);
        match library.characters.get(&id) {
            Some(Character::Shape(rings)) => {
                let placed: Vec<Contour> = rings
                    .iter()
                    .map(|ring| Contour {
                        points: ring.points.iter().map(|&p| here.apply(p)).collect(),
                        holes: vec![],
                        closed: ring.closed,
                        fill: ring.fill,
                        stroke: ring.stroke.as_ref().map(|s| Stroke {
                            color: s.color,
                            // Stroke width scales with the placement, near enough for a
                            // uniform scale and the common case.
                            width: s.width * ((here.a.hypot(here.b) + here.c.hypot(here.d)) / 2.0),
                            cap: s.cap,
                            join: s.join,
                            miter_limit: s.miter_limit,
                        }),
                    })
                    .collect();
                if !placed.is_empty() {
                    out.push(placed);
                }
            }
            Some(Character::Sprite(inner)) => draw(library, inner, here, depth + 1, out),
            None => {}
        }
    }
}

pub fn shape_groups_from_swf(swf_bytes: &[u8]) -> Result<Vec<Vec<Contour>>> {
    let buf = swf::decompress_swf(swf_bytes).context("decompress swf")?;

    // Walk the tag stream and parse only the shapes, rather than asking for the whole file
    // as a tag list. `parse_swf` is all-or-nothing: one tag it cannot read fails the parse,
    // and the artwork goes with it. Measured against ruffle's corpus of 4,898 real SWFs,
    // 118 refused to open that way — 80 of them on a malformed `DefineSprite` and exactly
    // one on a shape. Refusing to recover a drawing because a sprite elsewhere in the file
    // is broken is the wrong answer for a tool whose whole job is old, damaged Flash.
    //
    // Skipping a tag needs only its length, which the header carries, so an unreadable tag
    // costs that tag and nothing after it. Shapes are defined at the root — SWF requires
    // definitions there — so nothing is hidden inside the sprites being stepped over.
    let version = buf.header.version();
    let mut reader = swf::read::Reader::new(&buf.data, version);
    let mut library = Library {
        characters: Default::default(),
        root: Vec::new(),
    };

    loop {
        let Ok((code, length)) = reader.read_tag_code_and_length() else {
            break;
        };
        if code == 0 {
            break; // End tag.
        }
        let data = reader.get_mut();
        if data.len() < length {
            break; // Truncated file; keep whatever came before.
        }
        let (body, rest) = data.split_at(length);
        *data = rest;
        let mut tag = swf::read::Reader::new(body, version);

        match code {
            // DefineShape 1/2/3/4.
            2 | 22 | 32 | 83 => {
                let shape_version = match code {
                    2 => 1,
                    22 => 2,
                    32 => 3,
                    _ => 4,
                };
                if let Ok(shape) = tag.read_define_shape(shape_version) {
                    let rings = shape_to_contours(
                        &shape.shape,
                        &shape.styles.fill_styles,
                        &shape.styles.line_styles,
                    );
                    if !rings.is_empty() {
                        library.characters.insert(shape.id, Character::Shape(rings));
                    }
                }
            }
            // DefineSprite. Losing one to a parse error costs its contents and nothing else.
            39 => {
                if let Ok(sprite) = tag.read_define_sprite() {
                    library
                        .characters
                        .insert(sprite.id, Character::Sprite(sprite.tags));
                }
            }
            // The root display list: PlaceObject 1/2/3, RemoveObject 1/2, ShowFrame.
            4 => {
                if let Ok(po) = tag.read_place_object() {
                    library.root.push(swf::Tag::PlaceObject(Box::new(po)));
                }
            }
            26 | 70 => {
                let v = if code == 26 { 2 } else { 3 };
                if let Ok(po) = tag.read_place_object_2_or_3(v) {
                    library.root.push(swf::Tag::PlaceObject(Box::new(po)));
                }
            }
            5 => {
                if let Ok(ro) = tag.read_remove_object_1() {
                    library.root.push(swf::Tag::RemoveObject(ro));
                }
            }
            28 => {
                if let Ok(ro) = tag.read_remove_object_2() {
                    library.root.push(swf::Tag::RemoveObject(ro));
                }
            }
            1 => library.root.push(swf::Tag::ShowFrame),
            _ => {}
        }
    }

    let mut out = Vec::new();
    draw(&library, &library.root, Affine::IDENTITY, 0, &mut out);

    // A file whose display list places nothing — or whose placements all failed to parse —
    // still has its drawings, and handing back an empty SVG when the shapes are right there
    // would be the wrong kind of correct. Fall back to the definitions, unplaced.
    if out.is_empty() {
        for character in library.characters.into_values() {
            if let Character::Shape(rings) = character {
                out.push(rings);
            }
        }
    }
    Ok(out)
}

/// Every ring in an SWF, in the order its shapes were defined, with the grouping dropped.
/// For counting and measuring; use `shape_groups_from_swf` to draw them.
pub fn shapes_from_swf(swf_bytes: &[u8]) -> Result<Vec<Contour>> {
    Ok(shape_groups_from_swf(swf_bytes)?
        .into_iter()
        .flatten()
        .collect())
}

/// The stage size an SWF declares, in pixels.
///
/// Read off the header, never from the tag list. This called `parse_swf` once, which quietly
/// undid the lenient walk above: the shapes came back fine and then the stage size demanded
/// the whole file parse anyway, so a broken sprite still sank the import.
pub fn stage_size(swf_bytes: &[u8]) -> Result<(f64, f64)> {
    let buf = swf::decompress_swf(swf_bytes).context("decompress swf")?;
    let r = buf.header.stage_size();
    Ok((
        (r.x_max - r.x_min).to_pixels(),
        (r.y_max - r.y_min).to_pixels(),
    ))
}

fn svg_color(c: &swf::Color) -> String {
    format!("#{:02x}{:02x}{:02x}", c.r, c.g, c.b)
}

/// Render recovered shapes as a standalone SVG.
///
/// One `<path>` per *shape*, with a subpath per ring, so `fill-rule="nonzero"` decides the
/// interior the same way SWF's winding does and a hole stays a hole. Opacity rides on
/// `fill-opacity` rather than in the colour, since the editor reads the two separately.
pub fn contours_to_svg(groups: &[Vec<Contour>], width: f64, height: f64) -> String {
    let mut svg = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{width}\" height=\"{height}\" \
         viewBox=\"0 0 {width} {height}\">\n"
    );
    for rings in groups {
        let drawn: Vec<&Contour> = rings.iter().filter(|c| !c.points.is_empty()).collect();
        let Some(first) = drawn.first() else { continue };

        let mut d = String::new();
        for ring in &drawn {
            for (i, &(x, y)) in ring.points.iter().enumerate() {
                if !d.is_empty() {
                    d.push(' ');
                }
                d.push_str(&format!("{}{x:.3} {y:.3}", if i == 0 { "M" } else { "L" }));
            }
            if ring.closed {
                d.push_str(" Z");
            }
        }

        // The rings of one shape share its paint; the first ring's is the shape's.
        let fill = match &first.fill {
            Some(c) => format!(
                " fill=\"{}\" fill-opacity=\"{:.3}\" fill-rule=\"nonzero\"",
                svg_color(c),
                f64::from(c.a) / 255.0
            ),
            None => " fill=\"none\"".to_string(),
        };
        let stroke = match &first.stroke {
            Some(s) => format!(
                " stroke=\"{}\" stroke-opacity=\"{:.3}\" stroke-width=\"{:.3}\"",
                svg_color(&s.color),
                f64::from(s.color.a) / 255.0,
                s.width
            ),
            None => String::new(),
        };
        svg.push_str(&format!("  <path d=\"{d}\"{fill}{stroke}/>\n"));
    }
    svg.push_str("</svg>\n");
    svg
}

/// `.swf` bytes in, SVG text out.
pub fn swf_to_svg(swf_bytes: &[u8]) -> Result<String> {
    let (width, height) = stage_size(swf_bytes)?;
    let groups = shape_groups_from_swf(swf_bytes)?;
    Ok(contours_to_svg(&groups, width, height))
}
